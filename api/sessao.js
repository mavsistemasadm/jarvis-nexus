/* GET  /api/sessao       → 200 com sessão do dono, 401 sem
   POST /api/sessao {sair} → apaga a sessão */
const { donoDaSessao, apagarSessao } = require('../lib/sessao');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'POST') {
    apagarSessao(req, res);
    return res.end(JSON.stringify({ ok: true }));
  }
  const uid = donoDaSessao(req);
  res.statusCode = uid ? 200 : 401;
  return res.end(JSON.stringify({ ok: !!uid }));
};
