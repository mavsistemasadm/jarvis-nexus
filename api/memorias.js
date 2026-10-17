/* GET    /api/memorias            → memórias, ações dos últimos 14 dias e pendentes
   DELETE /api/memorias {id}       → apaga uma memória
   Só o dono (lib/sessao.js). É a tela onde ele vê tudo o que o Jarvis sabe e fez. */
const db = require('../lib/supabase');

async function atender(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    const [user] = await db.query('users', 'name=eq.Marlos&limit=1');
    if (!user) return res.end(JSON.stringify({ memorias: [], acoes: [] }));
    if (req.method === 'DELETE') {
      const id = (req.body && req.body.id) || '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) { res.statusCode = 400; return res.end(JSON.stringify({ erro: 'id inválido' })); }
      await fetch(`${process.env.SUPABASE_URL}/rest/v1/memories?id=eq.${id}&user_id=eq.${user.id}`, {
        method: 'DELETE', headers: { apikey: process.env.SUPABASE_ANON_KEY, authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` },
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    const desde = new Date(Date.now() - 14 * 86400000).toISOString();
    const [memorias, acoes] = await Promise.all([
      db.query('memories', `user_id=eq.${user.id}&order=updated_at.desc&limit=200&select=id,category,content,updated_at`),
      db.query('acoes', `criada_em=gte.${desde}&order=criada_em.desc&limit=100&select=ferramenta,resumo,estado,origem,criada_em`),
    ]);
    return res.end(JSON.stringify({
      memorias: Array.isArray(memorias) ? memorias : [],
      acoes: Array.isArray(acoes) ? acoes : [],
      regras_financeiro: (process.env.FINANCEIRO_APP_URL || '') + '/conferencia/regras',
    }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ erro: String(e.message || e) }));
  }
}

const { comSessao } = require('../lib/sessao');
module.exports = comSessao(atender);
