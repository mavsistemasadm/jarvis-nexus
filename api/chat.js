const SOURCES = {
  windsor:  { url: 'https://mcp.windsor.ai',                 name: 'windsor',      tokenEnv: 'WINDSOR_MCP_TOKEN' },
  gdrive:   { url: 'https://drivemcp.googleapis.com/mcp/v1', name: 'gdrive',       tokenEnv: 'GDRIVE_MCP_TOKEN' },
  make:     { url: 'https://mcp.make.com',                   name: 'make',         tokenEnv: 'MAKE_MCP_TOKEN' },
  facebook: { url: 'https://mcp.facebook.com/ads',           name: 'facebook-ads', tokenEnv: 'FACEBOOK_MCP_TOKEN' },
  canva:    { url: 'https://mcp.canva.com/mcp',              name: 'canva',        tokenEnv: 'CANVA_MCP_TOKEN' }
};

/* Supabase — carrega só se configurado */
let db = null;
try { db = require('./supabase'); } catch(e) { console.warn('[nexus] supabase não disponível:', e.message); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'use POST' } });

  const { system, messages, sources = [], webSearch = false, userName = 'Marlos' } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages vazio' } });
  }

  try {
    /* ---- Supabase: memória e histórico (opcional, não bloqueia se falhar) ---- */
    let memoryBlock = '';
    let routineBlock = '';
    let savedUserMsg = null;
    let session = null;

    if (db && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const user = await db.getOrCreateUser(userName);
        if (user && user.id) {
          session = await db.getOrCreateSession(user.id);

          const memories = await db.getMemories(user.id);
          if (memories && memories.length) {
            memoryBlock = '\n\n== MEMÓRIAS SOBRE O USUÁRIO (use naturalmente, sem citar que tem memórias) ==\n'
              + memories.map(m => `- [${m.category}] ${m.content}`).join('\n');
          }

          const firstOfDay = await db.isFirstOfDay(user.id);
          if (firstOfDay) {
            const routines = await db.getRoutines(user.id, 'first_of_day');
            if (routines && routines.length) {
              routineBlock = '\n\n== ROTINAS PARA A PRIMEIRA INTERAÇÃO DO DIA ==\n'
                + routines.map(r => `- ${r.action}`).join('\n')
                + '\nExecute essas rotinas naturalmente na sua resposta.';
            }
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

    /* ---- Sistema enriquecido ---- */
    const enrichedSystem = system
      + memoryBlock
      + routineBlock
      + `\n\n== INSTRUÇÕES DE MEMÓRIA ==
Se o usuário compartilhar informações pessoais importantes (preferências, dados da empresa, metas, gostos, rotinas), responda normalmente E adicione ao final da sua resposta, invisível ao usuário, um bloco:
<memory_extract>
categoria: preferência|empresa|meta|gosto|rotina|pessoal
conteúdo: frase curta descrevendo o fato
</memory_extract>
Pode adicionar múltiplos blocos. Só extraia fatos claros e relevantes, não extraia a cada mensagem.`;

    /* ---- MCP ---- */
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

    /* ---- Chamar Claude ---- */
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await r.json();

    /* ---- Salvar resposta e extrair memórias (só se Supabase ativo) ---- */
    if (data.content && db && session && session.id) {
      try {
        let fullAnswer = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');

        const memRegex = /<memory_extract>\s*categoria:\s*(.+?)\s*conteúdo:\s*(.+?)\s*<\/memory_extract>/gs;
        let match;
        const user = await db.getOrCreateUser(userName);
        while ((match = memRegex.exec(fullAnswer)) !== null) {
          if (user && user.id) {
            await db.addMemory(user.id, match[1].trim(), match[2].trim(), savedUserMsg?.id);
          }
        }

        const cleanAnswer = fullAnswer.replace(/<memory_extract>[\s\S]*?<\/memory_extract>/g, '').trim();
        data.content = [{ type: 'text', text: cleanAnswer }];

        await db.saveMessage(session.id, 'assistant', cleanAnswer);
      } catch (saveErr) {
        console.warn('[nexus] erro ao salvar resposta:', saveErr.message);
      }
    }

    res.status(r.status).json(data);
  } catch (e) {
    console.error('[nexus] erro no /api/chat:', e);
    res.status(500).json({ error: { message: String(e) } });
  }
};