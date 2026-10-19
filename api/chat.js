const SOURCES = {
  windsor:  { url: 'https://mcp.windsor.ai',                 name: 'windsor',      tokenEnv: 'WINDSOR_MCP_TOKEN' },
  gdrive:   { url: 'https://drivemcp.googleapis.com/mcp/v1', name: 'gdrive',       tokenEnv: 'GDRIVE_MCP_TOKEN' },
  make:     { url: 'https://mcp.make.com',                   name: 'make',         tokenEnv: 'MAKE_MCP_TOKEN' },
  facebook: { url: 'https://mcp.facebook.com/ads',           name: 'facebook-ads', tokenEnv: 'FACEBOOK_MCP_TOKEN' },
  canva:    { url: 'https://mcp.canva.com/mcp',              name: 'canva',        tokenEnv: 'CANVA_MCP_TOKEN' }
};

let db = null;
try { db = require('../lib/supabase'); } catch(e) { console.warn('[nexus] supabase não disponível:', e.message); }

/* ---- helpers de rotinas (acesso direto ao Supabase de memória) ---- */
function sbHeaders() {
  return {
    'apikey': (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY),
    'authorization': `Bearer ${(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)}`,
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
/* ---- Consulta aos negócios (financeiro, opera, peritos) ---- */
let negocios = null;
try { negocios = require('../lib/negocios'); } catch (e) { console.warn('[nexus] negocios não disponível:', e.message); }
let acoes = null, financeiroApp = null, cerebro = null;
try { acoes = require('../lib/acoes'); financeiroApp = require('../lib/financeiro-app'); } catch (e) { console.warn('[nexus] ações/financeiro-app não disponível:', e.message); }
try { cerebro = require('../lib/cerebro'); } catch (e) { console.warn('[nexus] cérebro não disponível:', e.message); }
let escritas = null, panoramas = null;
try { escritas = require('../lib/escritas'); } catch (e) { console.warn('[nexus] escritas não disponível:', e.message); }
try { panoramas = require('../lib/panoramas'); } catch (e) { console.warn('[nexus] panoramas não disponível:', e.message); }
let trafego = null, emails = null, googleAds = null;
try { trafego = require('../lib/trafego'); } catch (e) { console.warn('[nexus] tráfego não disponível:', e.message); }
try { googleAds = require('../lib/google-ads'); } catch (e) { console.warn('[nexus] google ads não disponível:', e.message); }
try { emails = require('../lib/emails'); } catch (e) { console.warn('[nexus] emails não disponível:', e.message); }
let academyApp = null, tarefas = null;
try { academyApp = require('../lib/academy-app'); } catch (e) { console.warn('[nexus] academy-app não disponível:', e.message); }
try { tarefas = require('../lib/tarefas'); } catch (e) { console.warn('[nexus] tarefas não disponível:', e.message); }

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
      // `interno`: o handler cru. A rota HTTP exige a sessão do dono, e esta
      // chamada já acontece dentro de uma conversa autenticada.
      sp.interno(req, res).catch(e => resolve({ erro: String(e.message || e) }));
    });
  } catch (e) { return { erro: String(e.message || e) }; }
}

/* Teto do que uma ferramenta devolve ao modelo (19/10/2026). Tudo que entra
   aqui é relido pelo modelo na volta seguinte, e um resultado gigante foi a
   fala mais lenta medida (dezessete mil palavras-código para responder
   "ontem"). Acima do teto, corta e AVISA, para ele não tratar o corte como
   o todo. As ferramentas grandes devem resumir na origem; isto é a rede. */
const TETO_SAIDA = Number(process.env.NEXUS_TETO_FERRAMENTA || 14000);
function limitarSaida(nome, saida) {
  const t = JSON.stringify(saida);
  if (!t || t.length <= TETO_SAIDA) return t;
  console.warn(`[nexus] ${nome} devolveu ${t.length} caracteres; cortado em ${TETO_SAIDA}`);
  return t.slice(0, TETO_SAIDA) + `…(CORTADO: a resposta de ${nome} tinha ${t.length} caracteres. Diga que é parcial, ou consulte de novo com um filtro menor.)`;
}

/* ---- chamada ao modelo: inteira ou em fluxo (19/10/2026) ---- */
async function chamarInteiro(url, headers, payload) {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { r, data: await r.json() };
}

/* Remonta a mensagem a partir dos eventos do fluxo, com os blocos que o laço
   de ferramentas precisa devolver intactos (pensamento com assinatura,
   pedido de ferramenta com o input completo). Texto sai em `aoTexto` assim
   que chega. Erro no meio do fluxo vira `data.type === 'error'`, como na
   chamada inteira. */
async function chamarEmFluxo(url, headers, payload, aoTexto) {
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...payload, stream: true }) });
  if (!r.ok || !r.body) return { r, data: await r.json().catch(() => ({ type: 'error', error: { message: `HTTP ${r.status}` } })) };
  const msg = { content: [], stop_reason: null, usage: {} };
  const jsonParcial = {};
  const leitor = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const tratar = (ev) => {
    switch (ev.type) {
      case 'message_start': Object.assign(msg, { id: ev.message.id, model: ev.message.model, usage: ev.message.usage || {} }); break;
      case 'content_block_start': msg.content[ev.index] = { ...ev.content_block }; break;
      case 'content_block_delta': {
        const b = msg.content[ev.index]; const d = ev.delta;
        if (!b) break;
        if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; aoTexto(d.text); }
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
        else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
        else if (d.type === 'input_json_delta') jsonParcial[ev.index] = (jsonParcial[ev.index] || '') + d.partial_json;
        else if (d.type === 'citations_delta') (b.citations = b.citations || []).push(d.citation);
        break;
      }
      case 'content_block_stop':
        if (jsonParcial[ev.index] !== undefined) {
          try { msg.content[ev.index].input = JSON.parse(jsonParcial[ev.index] || '{}'); } catch { msg.content[ev.index].input = {}; }
        }
        break;
      case 'message_delta':
        if (ev.delta && ev.delta.stop_reason) msg.stop_reason = ev.delta.stop_reason;
        if (ev.usage) msg.usage = { ...msg.usage, ...ev.usage };
        break;
      case 'error': msg.erroDoFluxo = ev.error; break;
    }
  };
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
      const linha = bloco.split('\n').find(l => l.startsWith('data: '));
      if (!linha) continue;
      try { tratar(JSON.parse(linha.slice(6))); } catch (_) {}
    }
  }
  if (msg.erroDoFluxo) return { r, data: { type: 'error', error: msg.erroDoFluxo } };
  msg.content = msg.content.filter(Boolean);
  return { r, data: msg };
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

async function atender(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'use POST' } });
  /* O instante em que esta requisição começou: lib/acoes.js recusa confirmar
     uma ação criada depois dele, ou seja, proposta nesta mesma resposta. */
  const inicioRequisicao = Date.now();

  const { system, messages, sources = [], webSearch = false, userName = 'Marlos', stream = false } = req.body || {};
  /* Modo progresso (17/10/2026): com `stream: true`, a resposta vira um fluxo
     de eventos. A tela mostra o que o Jarvis está consultando enquanto espera
     ("consultando o financeiro…") e recebe a resposta final no evento `fim`.
     Quase todo o tempo é ferramenta, não texto: mostrar o passo é o que tira
     a sensação de travado. Sem `stream`, tudo como antes (o WhatsApp usa assim). */
  const emStream = !!stream && typeof res.write === 'function';
  const emitir = (o) => { if (emStream) { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch (_) {} } };
  if (emStream) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    emitir({ tipo: 'inicio' });
  }
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

    if (db && process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
      try {
        const user = await db.getOrCreateUser(userName);
        if (user && user.id) {
          userId = user.id;
          /* Em paralelo (19/10/2026): eram cinco idas ao banco em fila antes
             de o modelo ser chamado, cada uma esperando a anterior, em toda
             fala. Nenhuma depende da outra; só a gravação da fala precisa da
             sessão, e vai logo depois. */
          const [sessao, memories, routines, firstOfDay] = await Promise.all([
            db.getOrCreateSession(user.id),
            db.getMemories(user.id).catch(() => []),
            getAllRoutines(user.id).catch(() => []),
            process.env.NEXUS_TEST_FIRSTDAY === '1' ? true : db.isFirstOfDay(user.id).catch(() => false),
          ]);
          session = sessao;

          if (memories && memories.length) {
            memoryBlock = '\n\n== MEMÓRIAS SOBRE O USUÁRIO (use naturalmente, sem citar que tem memórias) ==\n'
              + memories.map(m => `- [${m.category}] ${m.content}`).join('\n');
          }

          /* rotinas: sempre no contexto, pra listar/remover por voz */
          if (routines && routines.length) {
            routineBlock = '\n\n== ROTINAS ATIVAS DO USUÁRIO ==\n'
              + routines.map(r => `- [${r.trigger_type}] ${r.action}`).join('\n');
          }

          const lastUserMsg = messages[messages.length - 1];
          const gravarFala = session && session.id
            ? db.saveMessage(session.id, 'user', lastUserMsg.content).catch(e => { console.warn('[nexus] fala não gravada:', e.message); return null; })
            : Promise.resolve(null);

          /* primeira conversa do dia: briefing + executar rotinas first_of_day */
          if (firstOfDay) {
            /* O bom dia completo (lib/briefing.js, formato aprovado em
               18/10/2026): o que precisa dele hoje, o dinheiro de ontem,
               tráfego, Academy e Opera se houver novidade, e a recomendação. */
            emitir({ tipo: 'ferramenta', nome: 'bom_dia' });
            try { briefingBlock = await require('../lib/briefing').blocoParaChat(); }
            catch (e) {
              console.warn('[nexus] bom dia indisponível:', e.message);
              const dados = await buildBriefing();
              briefingBlock = '\n\n== PRIMEIRA CONVERSA DO DIA ==\nO bom dia completo falhou agora. Faça um briefing curto com o que houver abaixo e diga que o resto não deu para verificar.' + (dados || '');
            }
          }
          savedUserMsg = await gravarFala;
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
          const vigia = require('../lib/vigia');
          /* Na Vercel a função tem teto de tempo, e a saudação é o pior lugar
             para gastá-lo: sem esse limite, uma base lenta atrasa a abertura
             inteira e a resposta é cortada. Melhor abrir sem os alertas do que
             não abrir. */
          const r = await Promise.race([
            vigia.avaliar(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('vigia demorou demais')), Number(process.env.NEXUS_VIGIA_TIMEOUT_MS || 4000)))
          ]);
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

    let pendentesBlock = '';
    if (acoes && acoes.disponivel()) {
      try {
        const pend = await acoes.pendentesRecentes();
        if (pend.length) {
          pendentesBlock = '\n\n== AÇÕES ESPERANDO A CONFIRMAÇÃO DO MARLOS ==\n'
            + pend.map(p => `- acao_id ${p.id}: ${p.resumo}`).join('\n')
            + '\nSe a fala dele agora confirma uma delas, chame confirmar_acao com o acao_id. Se ele recusou ou mudou de ideia, cancelar_acao.';
        }
      } catch (e) { console.warn('[nexus] pendentes indisponíveis:', e.message); }
    }

    /* O SISTEMA EM DUAS PARTES (19/10/2026). A primeira não muda entre uma
       fala e outra (a personalidade que vem da tela e as instruções abaixo) e
       fica guardada no cache do modelo junto com as ferramentas: era reenviada
       e relida inteira a cada chamada, com zero reaproveitamento medido. A
       segunda muda (a hora, as memórias, as ações pendentes, o bom dia) e vem
       DEPOIS, para não quebrar o que está guardado. */
    const sistemaDoMomento = makeHooksBlock()
      + pendentesBlock
      + memoryBlock
      + routineBlock
      + briefingBlock
      + saudacaoBlock;
    const sistemaFixo = system
      + `\n\n== MEMÓRIA ==
Quando ele contar algo duradouro (preferência, pessoa, empresa, um jeito de classificar ou de decidir), guarde com memoria_guardar, sem anunciar. Ele vê e apaga tudo na tela de memórias.

== ESCRITAS (FINANCEIRO E OPERA) ==
Lançamento manual: financeiro_lancar. Baixa de conta: consulte financeiro_contas e use financeiro_dar_baixa. Compromisso: opera_agendar. Processo/cálculo: opera_criar_processo (atuação primeiro, um passo de cada vez, nunca pergunte o status).
Colete o que faltar de forma natural antes de propor. Todas seguem as AÇÕES COM CONFIRMAÇÃO abaixo.
Lançamento RECORRENTE ainda não existe por voz: ofereça lançar avulso.

== INSTRUÇÕES DE MÚSICA (SPOTIFY) ==
O usuário pode controlar o Spotify por voz. Quando ele pedir uma música/artista/banda (ex.: "toca AC/DC", "coloca uma do Metallica", ou responder a rotina da manhã com o nome de uma música), confirme naturalmente E adicione o bloco invisível:
<spotify_play>nome do artista ou música</spotify_play>
Para pausar: <spotify_ctrl>pause</spotify_ctrl> | continuar: <spotify_ctrl>play</spotify_ctrl> | próxima: <spotify_ctrl>next</spotify_ctrl> | anterior: <spotify_ctrl>previous</spotify_ctrl>
Se o resultado indicar erro (sem aparelho ativo, sem Premium, não configurado), o servidor avisa o usuário — você não precisa tratar.

== DADOS DO NEGÓCIO ==
Você tem ferramentas que leem os sistemas reais do Grupo MH:
- Nexus, o negócio: nexus_panorama (vendas, cancelamentos, inadimplência, checkout abandonado, esteiras, email, contatos, indicações; o MRR certo é o do Asaas, não daqui).
- Peritos Academy: academy_panorama (alunos ativos e parados, aprendizado, dúvidas e desafios esperando o Marlos, próximas lives), academy_cursos, academy_eventos.
- Live de tira-dúvidas: ao criar com academy_criar_live, se ele disser que a live é para responder dúvidas, use tiraDuvidas=true (a página recebe a dúvida antes, com anexo de até 20 MB, e convite e lembretes chamam para mandar). "Quantas dúvidas chegaram?": academy_duvidas_da_live; ele responde e dá baixa na página que a ferramenta devolve.
- Tráfego pago: trafego_meta (campanhas do Meta pelo pixel; nivel="conjunto" mostra cada conjunto, que no teste ABO de criativos é cada criativo, e nivel="anuncio" cada anúncio). O pixel subconta venda: compare com nexus_panorama antes de dizer que um anúncio não vende. Ele pode pausar, ativar e mudar orçamento diário de campanha ou de conjunto (trafego_pausar, trafego_ativar, trafego_orcamento; conjuntoId para conjunto, que é onde mora o orçamento no ABO), sempre com confirmação. Antes de sugerir pausar, olhe o período certo: campanha nova precisa de dias para aprender.
- ANÁLISE DE GESTOR DE TRÁFEGO (quando ele pedir para analisar campanha, conjunto ou criativo, ou perguntar o que fazer). Vá fundo antes de opinar, em chamadas paralelas: trafego_meta no nível pedido nos últimos 7 dias E nos 7 anteriores (tendência), quebra="posicionamento" no mesmo recorte, nivel="anuncio" com criativo=true para ler a mensagem, nexus_panorama para a venda real, e cerebro_buscar em "trafego padroes" para o que já foi aprendido. Leia nesta ordem: (1) entrega: gastou o orçamento? CPM subindo é leilão caro ou público pequeno; (2) criativo: gancho abaixo de 25% o começo do vídeo não segura, retenção baixa o meio cansa, CTR abaixo de 1% a mensagem não chama; (3) cansaço: frequência acima de 2,5 com CTR caindo é público saturado, pede criativo novo e não mais verba; (4) funil: clique sem início de checkout é página ou oferta, checkout sem compra é preço ou pagamento; (5) onde cortar: posicionamento ou idade que gasta e não converte. Responda como gestor: o diagnóstico em duas frases, o número que prova, e no máximo três ações em ordem de impacto, cada uma dizendo se é algo que você faz (pausar anúncio, pausar ou duplicar conjunto, orçamento, tirar posicionamento) ou algo para ele e o Claude Code fazerem (trocar criativo, texto, público, evento de otimização). Nunca conclua com menos de 3 dias ou menos de uns R$ 50 gastos no recorte: diga que ainda é cedo e quando olhar de novo.
- ESCALAR: quando um conjunto ou campanha vende, DIGA que dá para aumentar a verba, sem esperar ele perguntar. Critério: 3 compras ou mais em 7 dias (pixel, conferindo que o nexus_panorama mostra vendas no período), CPA até R$ 135 (o histórico da assinatura; acima disso não é vantagem), frequência abaixo de 2,5, e estável há 3 dias. Como: subir uns 20% de cada vez, no máximo a cada 48 horas (mais que isso joga o conjunto de volta no aprendizado), com trafego_orcamento no conjunto (ABO) ou na campanha (CBO). Para crescer mais rápido sem mexer no que funciona, trafego_duplicar o conjunto vencedor (nasce pausado; depois trafego_ativar). Fale o valor de hoje, o novo e quanto isso deve trazer a mais no CPA atual. Se o critério não fecha, diga o que falta (ex.: "mais 2 vendas e eu sugiro subir").
- Google Ads: trafego_google (contas Nexus Pericial e MH Cálculos; nivel campanha, grupo, anuncio, palavra ou termo de pesquisa). As conversões do Google ainda não são confiáveis: julgue por gasto, cliques, CTR e CPC, e venda real é nexus_panorama. "termo" mostra o que as pessoas digitaram, e é onde aparece palavra negativa a sugerir. Pode pausar, ativar (campanha ou grupo) e mudar orçamento diário de campanha (trafego_google_pausar, trafego_google_ativar, trafego_google_orcamento), sempre com confirmação. Se pedir "o tráfego" sem dizer onde, olhe Meta e Google.
- Opera: opera_panorama (cobranças a receber e vencidas, comercial, conversas esperando ele, prazos de processo, honorários, terceirização), além das consultas antigas de agenda e pipeline.
- Financeiro (grupo-mh-financeiro), como antes.
O que ele pode mandar fazer, sempre com confirmação: lançamentos e conferência no Financeiro, agenda e processo no Opera, email pelo compositor do Nexus (escrever rascunho e mandar teste não precisam de confirmação; disparar precisa, e o resumo mostra quantas pessoas recebem), matrícula e anúncio de live na Academy, e tarefa de código para o Claude Code quando existir a ferramenta.
Marlos é o gestor do grupo — quando ele perguntar sobre números, prazos, clientes ou contas, CONSULTE a ferramenta em vez de responder de memória. Prefira uma consulta a mais do que um palpite.
Regras que não se quebram:
- Nunca invente ou estime um número de negócio. Se a ferramenta devolver um campo "erro", diga que a fonte falhou e o que você não conseguiu ler — não preencha a lacuna.
- Se a ferramenta trouxer um campo "aviso" ou "nota", respeite-o: ele existe porque aquele dado engana.
- Você está respondendo por voz. Traga os números que decidem, não a tabela inteira: dois ou três itens e o total, não a lista completa. Valores em reais falados por extenso e arredondados quando não mudar a decisão.

== O CÉREBRO DOS PROJETOS ==
Você tem acesso aos documentos de orientação de todos os projetos do grupo: o AGENTS.md e os docs do Nexus (negócio, marketing, tráfego pago, cobrança, emails, lançamentos), o CLAUDE.md da Academy, os cérebros de vendas do Opera, os manuais de cada app.
- Pergunta sobre como algo funciona, por que algo é assim, qual a regra, o que foi decidido, qual a estratégia: use cerebro_buscar ANTES de responder, e cerebro_ler na seção que responde. Não responda de memória.
- Diga de onde veio ("pelo AGENTS.md do Nexus, na parte da régua de inadimplência..."), em uma frase.
- Se a busca não achar, diga que não está documentado, em vez de supor.

== AÇÕES COM CONFIRMAÇÃO ==
As ferramentas cuja descrição começa com "PROPÕE" NÃO gravam nada: devolvem um resumo e um acao_id. Leia o resumo e pergunte "Confirma?".
Só na fala SEGUINTE, se ele disser que sim, chame confirmar_acao. O servidor recusa confirmação na mesma resposta da proposta e recusa se a fala dele não for um sim.
Nunca diga que gravou antes de confirmar_acao devolver estado "executada". Se devolver "falhou", diga o erro.

== CONFERÊNCIA DO FINANCEIRO ==
Lançamentos do Asaas, da Conta Simples e do Opera chegam sozinhos e esperam o Marlos dizer empresa, centro de custo, categoria e produto.
- "O que tem para conferir?": consulte financeiro_conferencia, diga quantos são, e vá UM de cada vez: favorecido, valor e data. Se houver sugestão, ofereça ("da última vez foi Pró-Labore, Gastos Pessoais, Farmácia. Pode ser?").
- Quando ele responder, use financeiro_classificar. Pode juntar vários num pedido só se ele classificar em sequência. Por padrão a memória do favorecido é gravada (concluir sozinho); "lembra mas me pergunta" é lembrar="sugerir"; "só desta vez" é lembrar=false.
- ja_preenchido=true: uma memória já deixou pronto. Diga a classificação e pergunte só se confirma.
- "Sempre que vier X, é Y" ou "lembra que X é Y": financeiro_ensinar_regra (é a MEMÓRIA do Financeiro, a mesma da tela Conferência → Memórias). Nome parcial ("Bistek") é comparacao=contem. Se ele disser que depende do valor, use valor_min/valor_max.
- "O que você lembra de X?", "muda/pausa/apaga a memória de X": financeiro_memorias para achar o id, depois financeiro_editar_memoria ou financeiro_apagar_memoria.
- Se o nome não existir, a ferramenta devolve as opções. Pergunte qual delas, ou ofereça criar com financeiro_criar_cadastro.
- Use o que você sabe dele (suas memórias pessoais) para sugerir, mas quem decide é ele.`;

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
    /* Escrita com confirmação no servidor (lib/acoes.js) e a conferência do
       Financeiro pela porta dele (lib/financeiro-app.js). */
    const extras = [];
    if (cerebro && cerebro.disponivel()) extras.push(...cerebro.FERRAMENTAS);
    if (panoramas && panoramas.disponivel()) extras.push(...panoramas.FERRAMENTAS);
    if (trafego && trafego.disponivel()) extras.push(...trafego.FERRAMENTAS);
    if (googleAds && googleAds.disponivel()) extras.push(...googleAds.FERRAMENTAS);
    if (acoes && acoes.disponivel()) {
      extras.push(...acoes.FERRAMENTAS);
      if (escritas) extras.push(...escritas.FERRAMENTAS);
      if (emails && emails.disponivel()) extras.push(...emails.FERRAMENTAS);
      if (academyApp && academyApp.disponivel()) extras.push(...academyApp.FERRAMENTAS);
      if (tarefas && tarefas.disponivel()) extras.push(...tarefas.FERRAMENTAS);
      if (financeiroApp && financeiroApp.configurado()) extras.push(...financeiroApp.FERRAMENTAS);
    }
    const tools = [...toolDefs, ...extras.map(f => f.def)];
    const ultimaMsg = messages[messages.length - 1] || {};
    const ctxAcao = {
      inicio: inicioRequisicao,
      ultimaFala: typeof ultimaMsg.content === 'string' ? ultimaMsg.content
        : Array.isArray(ultimaMsg.content) ? ultimaMsg.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '',
      origem: (req.body && req.body.origem) || 'tela',
      userId,
    };
    const executarFerramenta = async (nome, input) => {
      const extra = extras.find(f => f.def.name === nome);
      if (!extra) return negocios.executar(nome, input);
      try { return await extra.run(input || {}, ctxAcao); }
      catch (e) { console.error(`[nexus] ferramenta ${nome} falhou:`, e.message); return { erro: String(e.message || e) }; }
    };
    if (webSearch) tools.push({ type: 'web_search_20260209', name: 'web_search' });
    /* O conector MCP precisa das duas metades: o servidor em mcp_servers e o
       mcp_toolset em tools. Só o servidor é recusado no modelo atual. */
    for (const m of mcp_servers) tools.push({ type: 'mcp_toolset', mcp_server_name: m.name });

    const headers = { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' };
    /* Modelo de reserva quando o principal recusa (`fallbacks: "default"`). */
    const betas = ['server-side-fallback-2026-07-01'];
    if (mcp_servers.length) betas.push('mcp-client-2025-11-20');
    headers['anthropic-beta'] = betas.join(',');

    const url = process.env.ANTHROPIC_TEST_URL || 'https://api.anthropic.com/v1/messages';
    const conversa = messages.slice();
    let r, data;

    /* Loop de tool use: o modelo pede o dado, o servidor busca, o modelo
       responde. Sem isso o NEXUS só consegue ser mandado, nunca perguntado.
       O teto de voltas evita que uma ferramenta em erro vire loop infinito. */
    for (let volta = 0; volta < 6; volta++) {
      const payload = {
        /* Claude Opus 5.5 desde 17/10/2026. O raciocínio não se desliga nele:
           quem controla a latência da voz é o esforço, `low` por padrão
           (NEXUS_EFFORT troca sem deploy de código). max_tokens maior que o
           antigo 1500 porque o raciocínio também gasta tokens. */
        model: process.env.NEXUS_MODEL || 'claude-opus-5-5',
        max_tokens: 4096,
        output_config: { effort: process.env.NEXUS_EFFORT || 'low' },
        fallbacks: 'default',
        /* Ferramentas + parte fixa ficam no cache por 1 hora (o marcador no
           fim da parte fixa cobre as duas, que vêm antes). O cache automático
           do topo guarda o resto da conversa: dentro da mesma fala, a segunda
           chamada (depois da ferramenta) relê tudo do cache. */
        system: [
          { type: 'text', text: sistemaFixo, cache_control: { type: 'ephemeral', ttl: '1h' } },
          ...(sistemaDoMomento.trim() ? [{ type: 'text', text: sistemaDoMomento.trim() }] : []),
        ],
        cache_control: { type: 'ephemeral' },
        messages: conversa
      };
      if (mcp_servers.length) payload.mcp_servers = mcp_servers;
      if (tools.length) payload.tools = tools;

      /* Na tela (emStream), a resposta chega em pedaços e cada pedaço de texto
         vai na hora para o navegador, que começa a falar na primeira frase
         pronta, em vez de esperar o texto inteiro e depois o áudio inteiro.
         WhatsApp e bom dia seguem pedindo a resposta inteira. */
      ({ r, data } = emStream
        ? await chamarEmFluxo(url, headers, payload, (delta) => emitir({ tipo: 'texto', volta, delta }))
        : await chamarInteiro(url, headers, payload));
      if (data && data.usage) console.log('[nexus] uso:', JSON.stringify({ volta, entrada: data.usage.input_tokens, cache_lido: data.usage.cache_read_input_tokens, cache_gravado: data.usage.cache_creation_input_tokens, saida: data.usage.output_tokens }));
      if (!data || !Array.isArray(data.content)) break;

      /* web_search estourou as iterações do servidor: devolve o turno e segue */
      if (data.stop_reason === 'pause_turn') {
        conversa.push({ role: 'assistant', content: data.content });
        continue;
      }
      if (data.stop_reason === 'refusal') {
        data.content = [{ type: 'text', text: 'Essa eu não consigo responder. Pode reformular?' }];
        data.substituida = true;
        break;
      }
      if (data.stop_reason !== 'tool_use') break;

      const pedidos = data.content.filter(b => b.type === 'tool_use');
      if (!pedidos.length) break;

      /* executa em paralelo e devolve TODOS os resultados numa única
         mensagem de usuário — dividir em várias ensina o modelo a parar
         de pedir ferramentas em paralelo */
      const resultados = await Promise.all(pedidos.map(async (p) => {
        emitir({ tipo: 'ferramenta', nome: p.name });
        const saida = await executarFerramenta(p.name, p.input);
        console.log('[nexus] consulta:', p.name, JSON.stringify(p.input || {}));
        return {
          type: 'tool_result',
          tool_use_id: p.id,
          content: limitarSaida(p.name, saida),
          ...(saida && saida.erro ? { is_error: true } : {})
        };
      }));

      conversa.push({ role: 'assistant', content: data.content });
      conversa.push({ role: 'user', content: resultados });
    }

    if (data.content) {
      const fullAnswer = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

      /* 1º: extrair os comandos invisíveis */
      const rcs  = [...fullAnswer.matchAll(/<routine_create>\s*trigger:\s*(.+?)\s*ação:\s*(.+?)\s*<\/routine_create>/gs)];
      const rds  = [...fullAnswer.matchAll(/<routine_delete>\s*(.+?)\s*<\/routine_delete>/gs)];
      const spls = [...fullAnswer.matchAll(/<spotify_play>\s*(.+?)\s*<\/spotify_play>/gs)];
      const spcs = [...fullAnswer.matchAll(/<spotify_ctrl>\s*(.+?)\s*<\/spotify_ctrl>/gs)];
      const mks  = [...fullAnswer.matchAll(/<make_disparar>\s*([\s\S]+?)\s*<\/make_disparar>/g)];

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
        /* A resposta vira voz: negrito e título viram asterisco e cerquilha lidos em voz alta. */
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .trim();
      data.content = [{ type: 'text', text: cleanAnswer }];

      /* 3º: efeitos no banco (se falharem, a resposta já está limpa) */
      if (userId) {
        for (const m of rcs) {
          try { await createRoutine(userId, m[1].trim(), m[2].trim()); console.log('[nexus] rotina criada:', m[2].trim()); }
          catch (e) { console.warn('[nexus] rotina não criada:', e.message); }
        }
        for (const m of rds) {
          try { const rem = await deactivateRoutine(userId, m[1].trim()); console.log('[nexus] rotinas desativadas:', Array.isArray(rem) ? rem.length : 0); }
          catch (e) { console.warn('[nexus] rotina não removida:', e.message); }
        }
      }
      /* Lançamento, baixa, agenda e processo saíram daqui em 17/10/2026: viraram
         ferramentas que propõem e esperam confirmação no servidor
         (lib/escritas.js, lib/acoes.js). As etiquetas antigas ainda são
         limpas do texto acima, mas NÃO executam mais nada. */

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
          data.substituida = true;
        }
      }

      /* Spotify */
      for (const m of spls) {
        const r = await spotifyAcao('tocar', m[1].trim());
        if (r && r.erro) { data.content = [{ type: 'text', text: 'Não consegui tocar: ' + r.erro }]; data.substituida = true; }
        else if (r && r.tocando) { console.log('[nexus] tocando:', r.tocando); data.musica = true; }
      }
      for (const m of spcs) {
        const r = await spotifyAcao(m[1].trim());
        if (r && r.erro) { data.content = [{ type: 'text', text: 'Spotify: ' + r.erro }]; data.substituida = true; }
      }

      if (session && session.id) {
        try { await db.saveMessage(session.id, 'assistant', data.content[0].text); }
        catch (e) { console.warn('[nexus] histórico não salvo:', e.message); }
      }
    }

    if (emStream) { emitir({ tipo: 'fim', ...data }); return res.end(); }
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[nexus] erro no /api/chat:', e);
    if (emStream) { emitir({ tipo: 'fim', error: { message: String(e) } }); return res.end(); }
    res.status(500).json({ error: { message: String(e) } });
  }
};

/* Só o dono, pela sessão do Nexus (lib/sessao.js). `interno` é o handler cru,
   para quem chama por dentro já autenticado por outro caminho (o WhatsApp). */
const { comSessao } = require('../lib/sessao');
// O que o arquivo já exportava além da rota (ex.: make.hooks, usado pelo
// chat) continua exportado: trocar module.exports apagava essas funções.
const exportadosAntes = { ...module.exports };
module.exports = Object.assign(comSessao(atender), exportadosAntes);
module.exports.interno = atender;
