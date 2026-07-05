/* Função serverless da Vercel — mesma lógica do server.js local.
   Configure ANTHROPIC_API_KEY (e tokens MCP opcionais) nas
   Environment Variables do projeto na Vercel. */

const SOURCES = {
  windsor:  { url: 'https://mcp.windsor.ai',                 name: 'windsor',      tokenEnv: 'WINDSOR_MCP_TOKEN' },
  gdrive:   { url: 'https://drivemcp.googleapis.com/mcp/v1', name: 'gdrive',       tokenEnv: 'GDRIVE_MCP_TOKEN' },
  make:     { url: 'https://mcp.make.com',                   name: 'make',         tokenEnv: 'MAKE_MCP_TOKEN' },
  facebook: { url: 'https://mcp.facebook.com/ads',           name: 'facebook-ads', tokenEnv: 'FACEBOOK_MCP_TOKEN' },
  canva:    { url: 'https://mcp.canva.com/mcp',              name: 'canva',        tokenEnv: 'CANVA_MCP_TOKEN' }
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'use POST' } });

  const { system, messages, sources = [], webSearch = false } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages vazio' } });
  }

  const mcp_servers = [];
  for (const key of sources) {
    const s = SOURCES[key];
    if (!s) continue;
    const token = process.env[s.tokenEnv];
    if (!token) { console.warn(`[nexus] fonte "${key}" ignorada: defina ${s.tokenEnv}`); continue; }
    mcp_servers.push({ type: 'url', url: s.url, name: s.name, authorization_token: token });
  }

  const payload = { model: process.env.NEXUS_MODEL || 'claude-sonnet-4-6', max_tokens: 1000, system, messages };
  if (mcp_servers.length) payload.mcp_servers = mcp_servers;
  if (webSearch) payload.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

  const headers = { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' };
  if (mcp_servers.length) headers['anthropic-beta'] = 'mcp-client-2025-04-04';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[nexus] erro no /api/chat:', e);
    res.status(500).json({ error: { message: String(e) } });
  }
};
