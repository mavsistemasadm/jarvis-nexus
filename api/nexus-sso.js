/* Entrada pelo Nexus. Ver o cabeçalho de lib/sessao.js.
   GET /api/nexus-sso?token=<access_token do Nexus> */
const { gravarSessao, donos } = require('../lib/sessao');

function redirecionar(res, para) {
  res.statusCode = 302;
  res.setHeader('Location', para);
  res.end();
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');
  if (!token) return redirecionar(res, '/?erro=token_ausente');

  // O token é conferido direto no Auth do Nexus (o mesmo projeto de
  // PERITOS_SUPABASE_URL): quem diz quem é a pessoa é o Nexus, não o Jarvis.
  const base = process.env.PERITOS_SUPABASE_URL;
  const chave = process.env.PERITOS_SUPABASE_KEY || process.env.PERITOS_SUPABASE_SERVICE_KEY;
  if (!base || !chave || donos().length === 0 || !process.env.JARVIS_SESSAO_SEGREDO) {
    console.error('[sso] configuração ausente: PERITOS_SUPABASE_*, JARVIS_DONOS ou JARVIS_SESSAO_SEGREDO');
    return redirecionar(res, '/?erro=configuracao');
  }

  let usuario = null;
  try {
    const r = await fetch(`${base.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: chave, authorization: `Bearer ${token}` },
    });
    if (r.ok) usuario = await r.json();
  } catch (e) {
    console.error('[sso] Nexus indisponível:', e.message);
  }
  if (!usuario || !usuario.id) return redirecionar(res, '/?erro=token_invalido');
  if (!donos().includes(usuario.id)) {
    console.warn('[sso] conta do Nexus fora de JARVIS_DONOS:', usuario.email);
    return redirecionar(res, '/?erro=nao_autorizado');
  }

  gravarSessao(req, res, usuario.id);
  return redirecionar(res, '/');
};
