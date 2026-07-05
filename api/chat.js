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

    const enrichedSystem = system
      + memoryBlock
      + routineBlock
      + briefingBlock
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

== INSTRUÇÕES DE MÚSICA (SPOTIFY) ==
O usuário pode controlar o Spotify por voz. Quando ele pedir uma música/artista/banda (ex.: "toca AC/DC", "coloca uma do Metallica", ou responder a rotina da manhã com o nome de uma música), confirme naturalmente E adicione o bloco invisível:
<spotify_play>nome do artista ou música</spotify_play>
Para pausar: <spotify_ctrl>pause</spotify_ctrl> | continuar: <spotify_ctrl>play</spotify_ctrl> | próxima: <spotify_ctrl>next</spotify_ctrl> | anterior: <spotify_ctrl>previous</spotify_ctrl>
Se o resultado indicar erro (sem aparelho ativo, sem Premium, não configurado), o servidor avisa o usuário — você não precisa tratar.`;

    const mcp_servers = [];
    for (const key of sources) {
      const s = SOURCES[key];
      if (!s) continue;
      const token = process.env[s.tokenEnv];
      if (!token) continue;
      mcp_servers.push({ type: 'url', url: s.url, name: s.name, authorization_token: token });
    }

    const payload = { model: process.env.NEXUS_MODEL || 'claude-sonnet-4-6', max_tokens: 1000, system: enrichedSystem, messages };
    if (mcp_servers.length) payload.mcp_servers = mcp_servers;
    if (webSearch) payload.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

    const headers = { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' };
    if (mcp_servers.length) headers['anthropic-beta'] = 'mcp-client-2025-04-04';

    const r = await fetch(process.env.ANTHROPIC_TEST_URL || 'https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await r.json();

    if (data.content) {
      const fullAnswer = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

      /* 1º: extrair os comandos invisíveis */
      const mems = [...fullAnswer.matchAll(/<memory_extract>\s*categoria:\s*(.+?)\s*conteúdo:\s*(.+?)\s*<\/memory_extract>/gs)];
      const rcs  = [...fullAnswer.matchAll(/<routine_create>\s*trigger:\s*(.+?)\s*ação:\s*(.+?)\s*<\/routine_create>/gs)];
      const rds  = [...fullAnswer.matchAll(/<routine_delete>\s*(.+?)\s*<\/routine_delete>/gs)];
      const lans = [...fullAnswer.matchAll(/<lancamento_criar>\s*([\s\S]+?)\s*<\/lancamento_criar>/g)];
      const spls = [...fullAnswer.matchAll(/<spotify_play>\s*(.+?)\s*<\/spotify_play>/gs)];
      const spcs = [...fullAnswer.matchAll(/<spotify_ctrl>\s*(.+?)\s*<\/spotify_ctrl>/gs)];

      /* 2º: limpar a resposta SEMPRE, antes de qualquer efeito no banco */
      const cleanAnswer = fullAnswer
        .replace(/<memory_extract>[\s\S]*?<\/memory_extract>/g, '')
        .replace(/<routine_create>[\s\S]*?<\/routine_create>/g, '')
        .replace(/<routine_delete>[\s\S]*?<\/routine_delete>/g, '')
        .replace(/<lancamento_criar>[\s\S]*?<\/lancamento_criar>/g, '')
        .replace(/<spotify_play>[\s\S]*?<\/spotify_play>/g, '')
        .replace(/<spotify_ctrl>[\s\S]*?<\/spotify_ctrl>/g, '')
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

      /* Spotify */
      for (const m of spls) {
        const r = await spotifyAcao('tocar', m[1].trim());
        if (r && r.erro) data.content = [{ type: 'text', text: 'Não consegui tocar: ' + r.erro }];
        else if (r && r.tocando) console.log('[nexus] tocando:', r.tocando);
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