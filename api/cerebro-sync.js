/* Cron diário: atualiza o cérebro dos projetos (lib/cerebro-sync.js).
   Autenticado pelo CRON_SECRET (Authorization: Bearer), como a rotina.
   Precisa de GITHUB_TOKEN_LEITURA: token fine-grained do GitHub com
   "Contents: Read-only" nos repositórios, e nada mais. Sem ele, responde 503
   e não faz nada. */
const { sincronizar } = require('../lib/cerebro-sync');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const segredo = process.env.CRON_SECRET;
  const recebido = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!segredo || recebido !== segredo) { res.statusCode = 401; return res.end(JSON.stringify({ erro: 'não autorizado' })); }
  if (!process.env.GITHUB_TOKEN_LEITURA) { res.statusCode = 503; return res.end(JSON.stringify({ erro: 'GITHUB_TOKEN_LEITURA não configurado' })); }
  try {
    const r = await sincronizar({
      githubToken: process.env.GITHUB_TOKEN_LEITURA,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
    });
    return res.end(JSON.stringify({ ok: true, ...r }));
  } catch (e) {
    console.error('[cerebro-sync]', e.message);
    res.statusCode = 500;
    return res.end(JSON.stringify({ erro: e.message }));
  }
};
