/* NEXUS server — zero dependências (Node 18+). Rode com: node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');

/* ---- .env manual (sem dotenv) ---- */
(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) process.env[m[1]] = process.env[m[1]] || m[2];
    }
  } catch (e) { /* sem .env ainda — ok */ }
})();

const SOURCES = {
  windsor:  { url: 'https://mcp.windsor.ai',                 name: 'windsor',      tokenEnv: 'WINDSOR_MCP_TOKEN' },
  gdrive:   { url: 'https://drivemcp.googleapis.com/mcp/v1', name: 'gdrive',       tokenEnv: 'GDRIVE_MCP_TOKEN' },
  make:     { url: 'https://mcp.make.com',                   name: 'make',         tokenEnv: 'MAKE_MCP_TOKEN' },
  facebook: { url: 'https://mcp.facebook.com/ads',           name: 'facebook-ads', tokenEnv: 'FACEBOOK_MCP_TOKEN' },
  canva:    { url: 'https://mcp.canva.com/mcp',              name: 'canva',        tokenEnv: 'CANVA_MCP_TOKEN' }
};

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const PUB = __dirname;
const BLOCKED = /^(\.|server\.js|package\.json|README|api|node_modules)/i;

async function chat(req, res) {
  let raw = '';
  for await (const c of req) raw += c;
  let body;
  try { body = JSON.parse(raw || '{}'); } catch (e) { return send(res, 400, { error: { message: 'JSON inválido' } }); }
  const { system, messages, sources = [], webSearch = false } = body;
  if (!Array.isArray(messages) || messages.length === 0) return send(res, 400, { error: { message: 'messages vazio' } });

  const mcp_servers = [];
  for (const key of sources) {
    const s = SOURCES[key];
    if (!s) continue;
    const token = process.env[s.tokenEnv];
    if (!token) { console.warn(`[nexus] fonte "${key}" ignorada: defina ${s.tokenEnv} no .env`); continue; }
    mcp_servers.push({ type: 'url', url: s.url, name: s.name, authorization_token: token });
  }

  const payload = { model: process.env.NEXUS_MODEL || 'claude-sonnet-4-6', max_tokens: 1000, system, messages };
  if (mcp_servers.length) payload.mcp_servers = mcp_servers;
  if (webSearch) payload.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

  const headers = { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' };
  if (mcp_servers.length) headers['anthropic-beta'] = 'mcp-client-2025-04-04';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
    send(res, r.status, await r.json());
  } catch (e) {
    console.error('[nexus] erro no /api/chat:', e);
    send(res, 500, { error: { message: String(e) } });
  }
}

function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res) {
  const clean = path.normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  if (BLOCKED.test(clean)) { res.writeHead(403); return res.end(); }
  let file = path.join(PUB, clean === '' ? 'index.html' : clean);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('não encontrado'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') return chat(req, res);
  serveStatic(req, res);
}).listen(port, () => {
  if (!process.env.ANTHROPIC_API_KEY) console.warn('[nexus] ATENÇÃO: ANTHROPIC_API_KEY não definida no .env — o cérebro não vai responder.');
  console.log(`NEXUS no ar: http://localhost:${port}  (use Chrome ou Edge para a voz)`);
});
