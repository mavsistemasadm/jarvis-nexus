/* Autorização do YouTube (18/10/2026). Ver lib/youtube.js.
   GET /api/youtube-auth          → manda para a tela do Google
   GET /api/youtube-auth?code=... → o Google volta aqui; guarda e prepara a chave
   Só o dono, logado pelo Nexus, passa nas duas pontas. */
const { donoDaSessao } = require('../lib/sessao');
const youtube = require('../lib/youtube');

function pagina(res, status, titulo, texto) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jarvis e YouTube</title>
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
  if (erro) return pagina(res, 400, 'Autorização cancelada', `O Google respondeu: ${erro.replace(/[<>&]/g, '')}. Pode tentar de novo quando quiser.`);
  const code = url.searchParams.get('code');
  try {
    if (!code) {
      res.statusCode = 302;
      res.setHeader('Location', youtube.urlDeAutorizacao());
      return res.end();
    }
    const r = await youtube.concluirAutorizacao(code);
    return pagina(res, 200, 'Pronto, o Jarvis cuida das suas lives',
      `Canal conectado: <b>${String(r.canal || '').replace(/[<>&]/g, '')}</b>. Criei no YouTube Studio a chave de transmissão <b>${youtube.NOME_DA_CHAVE}</b>: ela é a que vai no OBS, uma vez só. Pode fechar esta página.`);
  } catch (e) {
    console.error('[youtube-auth]', e.message);
    return pagina(res, 500, 'Não deu certo desta vez', String(e.message).replace(/[<>&]/g, ''));
  }
};
