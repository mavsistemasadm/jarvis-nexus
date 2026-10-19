/* Autorização do Google Ads (19/10/2026). Ver lib/google-ads.js.
   GET /api/google-ads-auth          → manda para a tela do Google
   GET /api/google-ads-auth?code=... → o Google volta aqui; guarda e acha as contas
   Só o dono, logado pelo Nexus, passa nas duas pontas. */
const { donoDaSessao } = require('../lib/sessao');
const googleAds = require('../lib/google-ads');

const limpo = (s) => String(s || '').replace(/[<>&]/g, '');

function pagina(res, status, titulo, texto) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis e Google Ads</title>
<body style="font-family:-apple-system,Inter,sans-serif;background:#0c1322;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">
<div style="max-width:520px"><h1 style="font-size:28px;letter-spacing:-.02em">${titulo}</h1><p style="color:#b8bfd1;line-height:1.6">${texto}</p></div></body>`);
}

module.exports = async (req, res) => {
  if (!donoDaSessao(req)) {
    res.statusCode = 302;
    res.setHeader('Location', 'https://www.nexuspericial.com.br/abrir/jarvis');
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  const erro = url.searchParams.get('error');
  if (erro) return pagina(res, 400, 'Autorização cancelada', `O Google respondeu: ${limpo(erro)}. Pode tentar de novo quando quiser.`);
  const code = url.searchParams.get('code');
  try {
    if (!code) {
      res.statusCode = 302;
      res.setHeader('Location', googleAds.urlDeAutorizacao());
      return res.end();
    }
    const { contas } = await googleAds.concluirAutorizacao(code);
    const lista = contas.length ? contas.map(c => `<b>${limpo(c.nome)}</b>`).join(', ') : 'nenhuma conta de anúncios ativa';
    return pagina(res, 200, 'Pronto, o Jarvis enxerga o Google Ads', `Contas conectadas: ${lista}. Pode fechar esta página e perguntar ao Jarvis.`);
  } catch (e) {
    console.error('[google-ads-auth]', e.message);
    return pagina(res, 500, 'Não deu certo desta vez', limpo(e.message));
  }
};
