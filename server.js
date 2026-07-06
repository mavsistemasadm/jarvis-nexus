/* NEXUS server — zero dependências (Node 18+). Rode com: node server.js */
const http = require('http');

/* ---- blindagem: o servidor NUNCA morre por erro interno ---- */
process.on('uncaughtException', e => console.error('[nexus] erro nao tratado:', e.message));
process.on('unhandledRejection', e => console.error('[nexus] promessa rejeitada:', e && e.message ? e.message : e));
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) process.env[m[1]] = process.env[m[1]] || m[2];
    }
  } catch (e) {}
})();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const PUB = __dirname;
const BLOCKED = /^(\.|server\.js|package\.json|README|api|node_modules)/i;

const apiChat = require('./api/chat');
const apiTts = require('./api/tts');
const apiFinanceiro = require('./api/financeiro');
const apiHistory = require('./api/history');
const apiSpotify = require('./api/spotify');
const apiFacebook = require('./api/facebook');
const apiMake = require('./api/make');

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch(e) { resolve({}); }
    });
  });
}

function wrapHandler(handler) {
  return async (req, rawRes) => {
    const body = await parseBody(req);
    const res = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      json(obj) {
        rawRes.writeHead(this.statusCode, { 'content-type': 'application/json', ...this.headers });
        rawRes.end(JSON.stringify(obj));
      },
      end(data) {
        rawRes.writeHead(this.statusCode, this.headers);
        rawRes.end(data);
      }
    };
    req.body = body;
    try {
      await handler(req, res);
    } catch (e) {
      console.error('[nexus] erro no handler:', e.message);
      try { res.status(500).json({ error: { message: String(e) } }); } catch (_) {}
    }
  };
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
http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') return wrapHandler(apiChat)(req, res);
  if (req.method === 'POST' && req.url === '/api/tts') return wrapHandler(apiTts)(req, res);
  if (req.method === 'POST' && req.url === '/api/financeiro') return wrapHandler(apiFinanceiro)(req, res);
  if (req.method === 'POST' && req.url === '/api/history') return wrapHandler(apiHistory)(req, res);
  if (req.url.startsWith('/api/spotify')) return wrapHandler(apiSpotify)(req, res);
  if (req.method === 'POST' && req.url === '/api/facebook') return wrapHandler(apiFacebook)(req, res);
  if (req.method === 'POST' && req.url === '/api/make') return wrapHandler(apiMake)(req, res);
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  serveStatic(req, res);
}).on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error('========================================================');
    console.error('  PORTA ' + port + ' JA ESTA EM USO!');
    console.error('  Voce tem outro "node server.js" rodando em outro');
    console.error('  terminal. Feche-o (Ctrl+C la) e rode de novo.');
    console.error('========================================================');
    process.exit(1);
  }
  console.error('[nexus] erro do servidor:', e.message);
}).listen(port, () => {
  if (!process.env.ANTHROPIC_API_KEY) console.warn('[nexus] ATENÇÃO: ANTHROPIC_API_KEY não definida no .env');
  console.log(`NEXUS no ar: http://localhost:${port}`);
});