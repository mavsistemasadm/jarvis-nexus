const SOURCES = {
  windsor:  { url: 'https://mcp.windsor.ai',                 name: 'windsor',      tokenEnv: 'WINDSOR_MCP_TOKEN' },
  gdrive:   { url: 'https://drivemcp.googleapis.com/mcp/v1', name: 'gdrive',       tokenEnv: 'GDRIVE_MCP_TOKEN' },
  make:     { url: 'https://mcp.make.com',                   name: 'make',         tokenEnv: 'MAKE_MCP_TOKEN' },
  facebook: { url: 'https://mcp.facebook.com/ads',           name: 'facebook-ads', tokenEnv: 'FACEBOOK_MCP_TOKEN' },
  canva:    { url: 'https://mcp.canva.com/mcp',              name: 'canva',        tokenEnv: 'CANVA_MCP_TOKEN' }
};

let db = null;
try { db = require('./supabase'); } catch(e) { console.warn('[nexus] supabase não disponível:', e.message); }

/* ---- helpers de rotinas (acesso direto ao Supabase de memória) ---- */
function sbHeaders() {
  return {
    'apikey': process.env.SUPABASE_ANON_KEY,
    'authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
    'content-type': 'application/json',
    'prefer': 'return=representation'
  };
}
async function getAllRoutines(userId) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/routines?user_id=eq.${userId}&active=eq.true&select=id,trigger_type,action`, { headers: sbHeaders() });
  return r.json();
}
async function createRoutine(userId, triggerType, action) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/routines`, {
    method: 'POST', headers: sbHeaders(),
    body: JSON.stringify({ user_id: userId, trigger_type: triggerType, action, active: true })
  });
  return r.json();
}
async function deactivateRoutine(userId, searchText) {
  const q = encodeURIComponent(`%${searchText}%`);
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/routines?user_id=eq.${userId}&active=eq.true&action=ilike.${q}`, {
    method: 'PATCH', headers: sbHeaders(),
    body: JSON.stringify({ active: false })
  });
  return r.json();
}

/* ---- lançamento de despesa/receita no Financeiro MH ---- */
async function lancarMovimentacao(l) {
  const FIN_URL = process.env.FIN_TEST_URL || process.env.FINANCEIRO_SUPABASE_URL;
  const FIN_KEY = process.env.FINANCEIRO_SUPABASE_KEY;
  const FIN_EMAIL = process.env.FINANCEIRO_USER_EMAIL;
  if (!FIN_URL || !FIN_KEY || !FIN_EMAIL) return { erro: 'financeiro não configurado' };
  const r = await fetch(`${FIN_URL}/rest/v1/rpc/lancar_movimentacao`, {
    method: 'POST',
    headers: { 'apikey': FIN_KEY, 'authorization': `Bearer ${FIN_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_email: FIN_EMAIL,
      p_tipo: l.tipo || 'Despesa',
      p_empresa: l.empresa,
      p_descricao: l.descricao,
      p_valor: l.valor,
      p_data: l.data || null,
      p_vencimento: l.vencimento || null,
      p_categoria: l.categoria || null,
      p_centro: l.centro || null,
      p_produto: l.produto || null,
      p_pago: !!l.pago,
      p_data_pagamento: l.data_pagamento || null,
      p_banco: l.banco || null,
      p_forma: l.forma_pagamento || null
    })
  });
  return r.json();
}

/* ---- Consulta aos negócios (financeiro, opera, peritos) ---- */
let negocios = null;
try { negocios = require('./negocios'); } catch (e) { console.warn('[nexus] negocios não disponível:', e.message); }

/* ---- Make: automações por voz ---- */
const makeMod = require('./make');
function makeHooksBlock() {
  const hs = makeMod.hooks();
  if (!hs.length) return '';
  return '\n\n== AUTOMAÇÕES DISPONÍVEIS (MAKE) ==\n'
    + hs.map(h => `- ${h.nome}: ${h.descricao}`).join('\n')
    + '\nQuando o usuário pedir uma dessas ações, confirme naturalmente E adicione o bloco invisível:\n<make_disparar>\n{"nome":"nomedaacao","dados":{"campo":"valor"}}\n</make_disparar>\nPreencha "dados" com as informações que ele ditou (nomes de campos simples em minúsculas). Se faltar informação essencial, pergunte antes.';
}

/* ---- Spotify por voz ---- */
async function spotifyAcao(acao, busca) {
  try {
    const sp = require('./spotify');
    /* chama o próprio handler internamente */
    return await new Promise((resolve) => {
      const req = { method: 'POST', url: '/api/spotify', body: { acao, busca } };
      const res = { statusCode: 200, status(c){this.statusCode=c;return this;}, setHeader(){}, json(o){resolve(o);}, end(){resolve({});} };
      sp(req, res).catch(e => resolve({ erro: String(e.message || e) }));
    });
  } catch (e) { return { erro: String(e.message || e) }; }
}

/* ---- contexto temporal: o modelo não tem relógio ----
   Sem isso ele chuta "bom dia" às onze da noite. O período vem calculado
   daqui, no fuso de Brasília, não inferido de um timestamp cru. */
function contextoTemporal() {
  const agora = new Date();
  const emSP = (opt) => agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opt });
  const hora = Number(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })) % 24;
  const periodo = hora < 12 ? 'manhã' : hora < 18 ? 'tarde' : 'noite';
  return {
    hora,
    periodo,
    saudacao: hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite',
    data: emSP({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    relogio: emSP({ hour: '2-digit', minute: '2-digit' })
  };
}

/* ---- briefing do dia: puxa os números direto do Financeiro MH ---- */
async function buildBriefing() {
  const FIN_URL = process.env.FIN_TEST_URL || process.env.FINANCEIRO_SUPABASE_URL;
  const FIN_KEY = process.env.FINANCEIRO_SUPABASE_KEY;
  const FIN_EMAIL = process.env.FINANCEIRO_USER_EMAIL;
  if (!FIN_URL || !FIN_KEY || !FIN_EMAIL) return '';
  const call = async (fn, extra = {}) => {
    try {
      const r = await fetch(`${FIN_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'apikey': FIN_KEY, 'authorization': `Bearer ${FIN_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_email: FIN_EMAIL, ...extra })
      });
      return await r.json();
    } catch (e) { return null; }
  };
  const [resumo, vencer, meta] = await Promise.all([
    call('resumo_mensal'),
    call('contas_a_vencer', { p_dias: 3 }),
    call('faturamento_vs_meta')
  ]);
  let out = '';
  if (resumo && resumo.length) out += '\nResumo do mês: ' + JSON.stringify(resumo);
  if (vencer && vencer.length) out += '\nContas vencendo nos próximos 3 dias: ' + JSON.stringify(vencer);
  if (meta && meta.length) out += '\nFaturamento vs meta: ' + JSON.stringify(meta);
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'use POST' } });

  const { system, messages, sources = [], webSearch = false, userName = 'Marlos' } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages vazio' } });
  }

  try {
    let memoryBlock = '';
    let routineBlock = '';
    let briefingBlock = '';
    let savedUserMsg = null;
    let session = null;
    let userId = null;

    if (db && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const user = await db.getOrCreateUser(userName);
        if (user && user.id) {
          userId = user.id;
          session = await db.getOrCreateSession(user.id);

          const memories = await db.getMemories(user.id);
          if (memories && memories.length) {
            memoryBlock = '\n\n== MEMÓRIAS SOBRE O USUÁRIO (use naturalmente, sem citar que tem memórias) ==\n'
              + memories.map(m => `- [${m.category}] ${m.content}`).join('\n');
          }

          /* rotinas: sempre no contexto, pra listar/remover por voz */
          const routines = await getAllRoutines(user.id);
          if (routines && routines.length) {
            routineBlock = '\n\n== ROTINAS ATIVAS DO USUÁRIO ==\n'
              + routines.map(r => `- [${r.trigger_type}] ${r.action}`).join('\n');
          }

          /* primeira conversa do dia: briefing + executar rotinas first_of_day */
          const firstOfDay = process.env.NEXUS_TEST_FIRSTDAY === '1' ? true : await db.isFirstOfDay(user.id);
          if (firstOfDay) {
            const dados = await buildBriefing();
            briefingBlock = '\n\n== PRIMEIRA CONVERSA DO DIA ==\n'
              + 'Esta é a primeira interação de hoje. Comece a resposta com um briefing executivo CURTO (2-3 frases): situação do mês, contas vencendo em breve se houver, e como está a meta. Dados reais abaixo. Depois responda o que foi perguntado e execute as rotinas marcadas como first_of_day (ex.: se houver rotina de perguntar a música, pergunte ao final).'
              + (dados || '\n(Financeiro indisponível agora — faça o briefing sem números.)');
          }

          if (session && session.id) {
            const lastUserMsg = messages[messages.length - 1];
            savedUserMsg = await db.saveMessage(session.id, 'user', lastUserMsg.content);
          }
        }
      } catch (dbErr) {
        console.warn('[nexus] Supabase falhou, seguindo sem memória:', dbErr.message);
      }
    }

    /* Saudação de abertura: só na PRIMEIRA fala da sessão.
       `messages` vem do front com o histórico inteiro, então tamanho 1
       significa que a conversa está começando agora. Fora do bloco do
       Supabase de propósito — o cumprimento não pode depender da memória
       estar configurada. */
    const t = contextoTemporal();
    let saudacaoBlock = `\n\n== AGORA ==\nSão ${t.relogio} de ${t.data} (período da ${t.periodo}), horário de Brasília.`;

    if (messages.length === 1) {
      /* O mordomo entra já sabendo o que pega fogo, em vez de esperar ser
         perguntado. Roda só na abertura — não a cada frase — e se falhar,
         a conversa começa normalmente sem ele. */
      let vigiaBlock = '';
      if (negocios && process.env.NEXUS_VIGIA_NA_ABERTURA !== '0') {
        try {
          const vigia = require('./vigia');
          const r = await vigia.avaliar();
          if (r.alertas.length) {
            const urgentes = r.alertas.filter(a => a.severidade === 'urgente');
            vigiaBlock = `\n\nO que está pedindo atenção neste momento (você levantou isso sozinho, não foi pedido):\n${vigia.resumir(r)}\n`
              + (urgentes.length
                ? 'Mencione o(s) ponto(s) urgente(s) logo na abertura, em UMA frase, do jeito que um mordomo avisaria — sem alarde e sem listar tudo. O resto só se ele perguntar.'
                : 'Nada urgente. NÃO despeje esses itens na abertura; guarde para quando ele perguntar.');
          }
        } catch (e) { console.warn('[nexus] vigia indisponível na abertura:', e.message); }
      }

      saudacaoBlock += vigiaBlock + `\n\n== ABERTURA DA SESSÃO ==
Esta é a primeira fala desta sessão. Antes de responder o que ele pediu, abra como o mordomo que você é, nesta ordem e em poucas frases:
1) Cumprimente com "${t.saudacao}" e o nome dele. Varie o jeito a cada sessão — nunca repita a mesma fórmula duas vezes seguidas.
2) Pergunte se está tudo certo com ele.
3) Pergunte qual música ele quer para ${t.periodo === 'manhã' ? 'começar o dia' : t.periodo === 'tarde' ? 'embalar a tarde' : 'fechar a noite'}.
Se ele responder com um artista ou música, use a tag do Spotify normalmente.
Só depois disso responda o que ele perguntou. Tudo junto, natural, sem soar protocolar nem virar lista — é uma pessoa falando.`;
    }

    const enrichedSystem = system
      + makeHooksBlock()
      + memoryBlock
      + routineBlock
      + briefingBlock
      + saudacaoBlock
      + `\n\n== INSTRUÇÕES DE MEMÓRIA ==
Se o usuário compartilhar informações pessoais importantes (preferências, dados da empresa, metas, gostos, rotinas), responda normalmente E adicione ao final da sua resposta, invisível ao usuário, um bloco:
<memory_extract>
categoria: preferência|empresa|meta|gosto|rotina|pessoal
conteúdo: frase curta descrevendo o fato
</memory_extract>
Pode adicionar múltiplos blocos. Só extraia fatos claros e relevantes, não extraia a cada mensagem.

== INSTRUÇÕES DE ROTINAS ==
O usuário pode criar e remover rotinas por voz. Quando ele pedir para você fazer algo recorrente (ex.: "toda manhã me pergunte qual música quero ouvir", "sempre que eu falar contigo pela primeira vez no dia, me dê o resumo das contas"), confirme naturalmente na resposta E adicione ao final um bloco invisível:
<routine_create>
trigger: first_of_day
ação: descrição curta do que fazer
</routine_create>
Por enquanto o único trigger suportado é first_of_day (primeira conversa do dia).
Quando ele pedir para remover/cancelar uma rotina, confirme E adicione:
<routine_delete>palavra-chave da rotina a remover</routine_delete>
Se ele perguntar quais rotinas tem, responda com base na lista de ROTINAS ATIVAS acima.

== INSTRUÇÕES DE LANÇAMENTO FINANCEIRO ==
O usuário pode lançar despesas e receitas por voz (ex.: "lança 200 reais de almoço na MH Cálculos").
Campos: tipo (Despesa/Receita), empresa (MH Cálculos, Peritos Academy ou AnyCalc), descricao, valor, categoria, data (padrão hoje), vencimento (padrão = data), centro de custo e produto (opcionais), pago (se já foi pago: data_pagamento, banco, forma_pagamento).
Fluxo OBRIGATÓRIO em duas etapas:
1) Quando ele ditar um lançamento, colete o que falta perguntando de forma natural (pergunte pelo menos categoria se não disse, e se já foi pago). Depois REPITA o resumo completo e pergunte "Confirma?". NUNCA emita a tag nesta etapa.
2) SOMENTE quando ele confirmar explicitamente (sim/confirma/pode lançar), responda confirmando E adicione o bloco invisível:
<lancamento_criar>
{"tipo":"Despesa","empresa":"MH Cálculos","descricao":"Almoço","valor":200,"data":"2026-07-05","vencimento":"2026-07-05","categoria":"Alimentação","centro":"","produto":"","pago":true,"data_pagamento":"2026-07-05","banco":"Nubank","forma_pagamento":"Pix"}
</lancamento_criar>
Use a data de hoje quando ele disser "hoje". Valores sempre numéricos (200, não "duzentos").
Se ele pedir lançamento RECORRENTE, avise que recorrentes chegam na próxima versão e ofereça lançar avulso.

== INSTRUÇÕES DE CONFIRMAÇÃO DE PAGAMENTO ==
O usuário pode dar baixa numa conta por voz ("paga o Supabase", "marca a Vercel como paga").
Fluxo OBRIGATÓRIO em duas etapas, igual ao lançamento:
1) Consulte financeiro_contas para achar a conta e CONFIRA em voz alta descrição, empresa, valor e vencimento. Pergunte "Confirma a baixa?". NUNCA emita a tag nesta etapa.
2) Só depois do sim explícito, responda confirmando E adicione o bloco invisível:
<pagamento_confirmar>
{"descricao":"Supabase","valor":150.21,"data_pagamento":"2026-08-15","banco":"Nubank","forma_pagamento":"Pix"}
</pagamento_confirmar>
A "descricao" precisa bater com UMA única conta em aberto. Se o servidor responder que mais de uma bateu, peça o valor exato e tente de novo. Data de pagamento padrão é hoje.

== INSTRUÇÕES DE AGENDA (OPERA) ==
O usuário pode marcar compromissos por voz ("marca audiência dia 22 às 14h", "põe na agenda a entrega do laudo do Pedro dia 20").
Campos: titulo e data (AAAA-MM-DD) são obrigatórios; hora (HH:MM, omita se for o dia todo), local, alerta_dias (avisar N dias antes) e tipo.
Tipos válidos: entrega_laudo, entrega_quesitos, prazo_fatal, audiencia, reuniao, diligencia, prazo_processo, followup, outro.
Colete o que faltar, repita o resumo, pergunte "Confirma?" e SÓ depois do sim adicione:
<agenda_criar>
{"tipo":"audiencia","titulo":"Audiência processo Pedro Bernardo","data":"2026-08-22","hora":"14:00","local":"Fórum de Joinville","alerta_dias":2}
</agenda_criar>

== INSTRUÇÕES DE CÁLCULO JUDICIAL (OPERA) ==
O usuário pode abrir um processo/cálculo por voz. Siga a MESMA ordem das três etapas da tela, uma pergunta de cada vez:
1) Atuação: ele é perito do juízo ou perito contratado? (esta é sempre a primeira pergunta — ela define todo o resto)
2) Dados: tipo de cálculo, número do processo (se não tiver, vira pré-judicial), vara, tribunal, comarca, valor da causa, e o cliente/contato.
3) Prazos e honorários: prazo de entrega, data de nomeação, tipo de honorário (fixo, hora, exito ou misto), valor, e se tem depósito judicial.
Tipos de cálculo: Cálculos Cíveis, Bancários, Trabalhistas, Previdenciários, Tributários, Contábeis, Atuariais.
Só atuação e tipo_acao são obrigatórios — o resto ele pode completar depois na tela; não trave a conversa por um campo opcional.
NUNCA pergunte o status: ele é derivado da atuação automaticamente.
Repita o resumo, pergunte "Confirma?" e só depois do sim adicione:
<processo_criar>
{"atuacao":"perito_contratado","tipo_acao":"Cálculos Trabalhistas","titulo":"Cálculo Maria Silva","numero":"","vara":"","comarca":"","valor_causa":null,"prazo_entrega":"2026-09-10","honorario_tipo":"fixo","honorario_valor":1500,"deposito_judicial":false,"contato_nome":"Maria Silva","contato_telefone":"","observacoes":""}
</processo_criar>

== INSTRUÇÕES DE MÚSICA (SPOTIFY) ==
O usuário pode controlar o Spotify por voz. Quando ele pedir uma música/artista/banda (ex.: "toca AC/DC", "coloca uma do Metallica", ou responder a rotina da manhã com o nome de uma música), confirme naturalmente E adicione o bloco invisível:
<spotify_play>nome do artista ou música</spotify_play>
Para pausar: <spotify_ctrl>pause</spotify_ctrl> | continuar: <spotify_ctrl>play</spotify_ctrl> | próxima: <spotify_ctrl>next</spotify_ctrl> | anterior: <spotify_ctrl>previous</spotify_ctrl>
Se o resultado indicar erro (sem aparelho ativo, sem Premium, não configurado), o servidor avisa o usuário — você não precisa tratar.

== DADOS DO NEGÓCIO ==
Você tem ferramentas que leem os sistemas reais do Grupo MH: financeiro (grupo-mh-financeiro), Opera/mh-gestao (processos, agenda, WhatsApp, comercial) e a plataforma Nexus/Peritos Academy (assinaturas).
Marlos é o gestor do grupo — quando ele perguntar sobre números, prazos, clientes ou contas, CONSULTE a ferramenta em vez de responder de memória. Prefira uma consulta a mais do que um palpite.
Regras que não se quebram:
- Nunca invente ou estime um número de negócio. Se a ferramenta devolver um campo "erro", diga que a fonte falhou e o que você não conseguiu ler — não preencha a lacuna.
- Se a ferramenta trouxer um campo "aviso" ou "nota", respeite-o: ele existe porque aquele dado engana.
- Você está respondendo por voz. Traga os números que decidem, não a tabela inteira: dois ou três itens e o total, não a lista completa. Valores em reais falados por extenso e arredondados quando não mudar a decisão.`;

    const mcp_servers = [];
    for (const key of sources) {
      const s = SOURCES[key];
      if (!s) continue;
      const token = process.env[s.tokenEnv];
      if (!token) continue;
      mcp_servers.push({ type: 'url', url: s.url, name: s.name, authorization_token: token });
    }

    /* ferramentas de negócio: só entram as fontes que estão realmente
       configuradas (ver api/negocios.js) */
    const toolDefs = negocios ? negocios.ferramentasDisponiveis() : [];
    const tools = [...toolDefs];
    if (webSearch) tools.push({ type: 'web_search_20250305', name: 'web_search' });

    const headers = { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' };
    if (mcp_servers.length) headers['anthropic-beta'] = 'mcp-client-2025-04-04';

    const url = process.env.ANTHROPIC_TEST_URL || 'https://api.anthropic.com/v1/messages';
    const conversa = messages.slice();
    let r, data;

    /* Loop de tool use: o modelo pede o dado, o servidor busca, o modelo
       responde. Sem isso o NEXUS só consegue ser mandado, nunca perguntado.
       O teto de voltas evita que uma ferramenta em erro vire loop infinito. */
    for (let volta = 0; volta < 6; volta++) {
      const payload = {
        model: process.env.NEXUS_MODEL || 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: enrichedSystem,
        messages: conversa
      };
      if (mcp_servers.length) payload.mcp_servers = mcp_servers;
      if (tools.length) payload.tools = tools;

      r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      data = await r.json();
      if (!data || !Array.isArray(data.content)) break;

      /* web_search estourou as iterações do servidor: devolve o turno e segue */
      if (data.stop_reason === 'pause_turn') {
        conversa.push({ role: 'assistant', content: data.content });
        continue;
      }
      if (data.stop_reason !== 'tool_use') break;

      const pedidos = data.content.filter(b => b.type === 'tool_use');
      if (!pedidos.length) break;

      /* executa em paralelo e devolve TODOS os resultados numa única
         mensagem de usuário — dividir em várias ensina o modelo a parar
         de pedir ferramentas em paralelo */
      const resultados = await Promise.all(pedidos.map(async (p) => {
        const saida = await negocios.executar(p.name, p.input);
        console.log('[nexus] consulta:', p.name, JSON.stringify(p.input || {}));
        return {
          type: 'tool_result',
          tool_use_id: p.id,
          content: JSON.stringify(saida),
          ...(saida && saida.erro ? { is_error: true } : {})
        };
      }));

      conversa.push({ role: 'assistant', content: data.content });
      conversa.push({ role: 'user', content: resultados });
    }

    if (data.content) {
      const fullAnswer = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

      /* 1º: extrair os comandos invisíveis */
      const mems = [...fullAnswer.matchAll(/<memory_extract>\s*categoria:\s*(.+?)\s*conteúdo:\s*(.+?)\s*<\/memory_extract>/gs)];
      const rcs  = [...fullAnswer.matchAll(/<routine_create>\s*trigger:\s*(.+?)\s*ação:\s*(.+?)\s*<\/routine_create>/gs)];
      const rds  = [...fullAnswer.matchAll(/<routine_delete>\s*(.+?)\s*<\/routine_delete>/gs)];
      const lans = [...fullAnswer.matchAll(/<lancamento_criar>\s*([\s\S]+?)\s*<\/lancamento_criar>/g)];
      const spls = [...fullAnswer.matchAll(/<spotify_play>\s*(.+?)\s*<\/spotify_play>/gs)];
      const spcs = [...fullAnswer.matchAll(/<spotify_ctrl>\s*(.+?)\s*<\/spotify_ctrl>/gs)];
      const mks  = [...fullAnswer.matchAll(/<make_disparar>\s*([\s\S]+?)\s*<\/make_disparar>/g)];
      const pags = [...fullAnswer.matchAll(/<pagamento_confirmar>\s*([\s\S]+?)\s*<\/pagamento_confirmar>/g)];
      const ags  = [...fullAnswer.matchAll(/<agenda_criar>\s*([\s\S]+?)\s*<\/agenda_criar>/g)];
      const prcs = [...fullAnswer.matchAll(/<processo_criar>\s*([\s\S]+?)\s*<\/processo_criar>/g)];

      /* 2º: limpar a resposta SEMPRE, antes de qualquer efeito no banco */
      const cleanAnswer = fullAnswer
        .replace(/<memory_extract>[\s\S]*?<\/memory_extract>/g, '')
        .replace(/<routine_create>[\s\S]*?<\/routine_create>/g, '')
        .replace(/<routine_delete>[\s\S]*?<\/routine_delete>/g, '')
        .replace(/<lancamento_criar>[\s\S]*?<\/lancamento_criar>/g, '')
        .replace(/<spotify_play>[\s\S]*?<\/spotify_play>/g, '')
        .replace(/<spotify_ctrl>[\s\S]*?<\/spotify_ctrl>/g, '')
        .replace(/<make_disparar>[\s\S]*?<\/make_disparar>/g, '')
        .replace(/<pagamento_confirmar>[\s\S]*?<\/pagamento_confirmar>/g, '')
        .replace(/<agenda_criar>[\s\S]*?<\/agenda_criar>/g, '')
        .replace(/<processo_criar>[\s\S]*?<\/processo_criar>/g, '')
        .trim();
      data.content = [{ type: 'text', text: cleanAnswer }];

      /* 3º: efeitos no banco (se falharem, a resposta já está limpa) */
      if (userId) {
        for (const m of mems) {
          try { await db.addMemory(userId, m[1].trim(), m[2].trim(), savedUserMsg?.id); }
          catch (e) { console.warn('[nexus] memória não salva:', e.message); }
        }
        for (const m of rcs) {
          try { await createRoutine(userId, m[1].trim(), m[2].trim()); console.log('[nexus] rotina criada:', m[2].trim()); }
          catch (e) { console.warn('[nexus] rotina não criada:', e.message); }
        }
        for (const m of rds) {
          try { const rem = await deactivateRoutine(userId, m[1].trim()); console.log('[nexus] rotinas desativadas:', Array.isArray(rem) ? rem.length : 0); }
          catch (e) { console.warn('[nexus] rotina não removida:', e.message); }
        }
      }
      /* lançamentos financeiros confirmados */
      for (const m of lans) {
        try {
          const l = JSON.parse(m[1]);
          const result = await lancarMovimentacao(l);
          if (result && result.erro) throw new Error(result.erro);
          if (result && result.message) throw new Error(result.message);
          console.log('[nexus] lançamento gravado:', l.descricao, l.valor);
        } catch (e) {
          console.error('[nexus] lançamento FALHOU:', e.message);
          data.content = [{ type: 'text', text: 'Atenção: não consegui gravar o lançamento no financeiro. Erro: ' + e.message + '. Nada foi salvo — tenta de novo ou lança manualmente.' }];
        }
      }

      /* Make: dispara automações confirmadas */
      for (const m of mks) {
        try {
          const cmd = JSON.parse(m[1]);
          const r = await makeMod.disparar(cmd.nome, cmd.dados || {});
          if (r && r.erro) throw new Error(r.erro);
          console.log('[nexus] automação disparada:', cmd.nome);
        } catch (e) {
          console.error('[nexus] automação FALHOU:', e.message);
          data.content = [{ type: 'text', text: 'Não consegui disparar a automação: ' + e.message }];
        }
      }

      /* Escritas confirmadas (baixa de conta, agenda, processo).
         Mesmo contrato do lançamento: se falhar, a resposta vira o aviso —
         é pior o Marlos achar que gravou do que ouvir que não gravou. */
      const gravar = async (matches, rotulo, fn) => {
        for (const m of matches) {
          try {
            const dados = JSON.parse(m[1]);
            const r = await fn(dados);
            console.log(`[nexus] ${rotulo} gravado:`, JSON.stringify(r).slice(0, 160));
          } catch (e) {
            console.error(`[nexus] ${rotulo} FALHOU:`, e.message);
            data.content = [{ type: 'text', text: `Atenção: não consegui ${rotulo}. ${e.message}. Nada foi salvo.` }];
          }
        }
      };
      if (negocios) {
        await gravar(pags, 'dar baixa na conta', d => negocios.escrever.confirmarPagamento(d));
        await gravar(ags, 'marcar o compromisso', d => negocios.escrever.criarEvento(d));
        await gravar(prcs, 'abrir o processo', d => negocios.escrever.criarProcesso(d));
      }

      /* Spotify */
      for (const m of spls) {
        const r = await spotifyAcao('tocar', m[1].trim());
        if (r && r.erro) data.content = [{ type: 'text', text: 'Não consegui tocar: ' + r.erro }];
        else if (r && r.tocando) { console.log('[nexus] tocando:', r.tocando); data.musica = true; }
      }
      for (const m of spcs) {
        const r = await spotifyAcao(m[1].trim());
        if (r && r.erro) data.content = [{ type: 'text', text: 'Spotify: ' + r.erro }];
      }

      if (session && session.id) {
        try { await db.saveMessage(session.id, 'assistant', data.content[0].text); }
        catch (e) { console.warn('[nexus] histórico não salvo:', e.message); }
      }
    }

    res.status(r.status).json(data);
  } catch (e) {
    console.error('[nexus] erro no /api/chat:', e);
    res.status(500).json({ error: { message: String(e) } });
  }
};