/* NEXUS → Spotify (OAuth + busca + play/pause/next) */

const SP_ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com';
const SP_API = process.env.SPOTIFY_API_URL || 'https://api.spotify.com';

function creds() {
  return {
    id: process.env.SPOTIFY_CLIENT_ID,
    secret: process.env.SPOTIFY_CLIENT_SECRET,
    redirect: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/api/spotify/callback',
    refresh: process.env.SPOTIFY_REFRESH_TOKEN
  };
}

async function accessToken() {
  const c = creds();
  if (!c.id || !c.secret || !c.refresh) throw new Error('Spotify não configurado (.env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN)');
  const r = await fetch(`${SP_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'authorization': 'Basic ' + Buffer.from(c.id + ':' + c.secret).toString('base64')
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('token do Spotify falhou: ' + JSON.stringify(d).slice(0, 120));
  return d.access_token;
}

async function spFetch(token, path, opts = {}) {
  const r = await fetch(`${SP_API}/v1${path}`, {
    ...opts,
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json', ...(opts.headers || {}) }
  });
  if (r.status === 204) return {};
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

/* toca uma busca: prioriza artista (contexto) senão faixa */
async function tocar(busca) {
  const token = await accessToken();
  const q = encodeURIComponent(busca);
  const s = await spFetch(token, `/search?q=${q}&type=track,artist&limit=1&market=BR`);
  const artist = s.artists && s.artists.items && s.artists.items[0];
  const track = s.tracks && s.tracks.items && s.tracks.items[0];

  let body, tocando;
  if (artist && artist.name.toLowerCase() === busca.toLowerCase()) {
    body = { context_uri: artist.uri };
    tocando = artist.name;
  } else if (track) {
    body = { uris: [track.uri] };
    tocando = `${track.name} — ${track.artists.map(a => a.name).join(', ')}`;
  } else if (artist) {
    body = { context_uri: artist.uri };
    tocando = artist.name;
  } else {
    return { erro: `não achei "${busca}" no Spotify` };
  }

  const r = await fetch(`${SP_API}/v1/me/player/play`, {
    method: 'PUT',
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.status === 404) return { erro: 'nenhum aparelho ativo — abre o Spotify no PC ou celular primeiro' };
  if (r.status === 403) return { erro: 'controle de reprodução exige Spotify Premium' };
  if (!r.ok) return { erro: 'Spotify respondeu ' + r.status };
  return { ok: true, tocando };
}

async function controle(acao) {
  const token = await accessToken();
  const map = { pause: ['PUT', '/me/player/pause'], play: ['PUT', '/me/player/play'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] };
  const m = map[acao];
  if (!m) return { erro: 'ação inválida' };
  const r = await fetch(`${SP_API}/v1${m[1]}`, { method: m[0], headers: { 'authorization': `Bearer ${token}` } });
  if (r.status === 404) return { erro: 'nenhum aparelho ativo' };
  if (!r.ok && r.status !== 204) return { erro: 'Spotify respondeu ' + r.status };
  return { ok: true };
}

module.exports = async (req, res) => {
  const url = req.url || '';
  const c = creds();

  /* GET /api/spotify/login → manda pro consentimento do Spotify */
  if (req.method === 'GET' && url.includes('/login')) {
    if (!c.id) return res.status(500).json({ error: 'defina SPOTIFY_CLIENT_ID no .env' });
    const scopes = 'user-modify-playback-state user-read-playback-state';
    const auth = `${SP_ACCOUNTS}/authorize?client_id=${c.id}&response_type=code&redirect_uri=${encodeURIComponent(c.redirect)}&scope=${encodeURIComponent(scopes)}`;
    res.setHeader('location', auth);
    return res.status(302).end();
  }

  /* GET /api/spotify/callback → troca o código e MOSTRA o refresh token */
  if (req.method === 'GET' && url.includes('/callback')) {
    const code = new URLSearchParams(url.split('?')[1] || '').get('code');
    if (!code) return res.status(400).end('sem code');
    const r = await fetch(`${SP_ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'authorization': 'Basic ' + Buffer.from(c.id + ':' + c.secret).toString('base64')
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: c.redirect })
    });
    const d = await r.json();
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (!d.refresh_token) return res.status(500).end('<h2>Falhou: ' + JSON.stringify(d) + '</h2>');
    return res.status(200).end(`<body style="font-family:sans-serif;background:#0a0f1e;color:#dbe7ff;padding:40px">
      <h2>✅ Spotify conectado!</h2>
      <p>Copie a linha abaixo para o seu <b>.env</b> (e para as variáveis da Vercel):</p>
      <pre style="background:#071226;padding:16px;border-radius:8px;user-select:all">SPOTIFY_REFRESH_TOKEN=${d.refresh_token}</pre>
      <p>Depois reinicie o servidor. Pode fechar esta aba.</p></body>`);
  }

  /* POST /api/spotify → ações por voz */
  if (req.method === 'POST') {
    const { acao, busca } = req.body || {};
    try {
      const result = acao === 'tocar' ? await tocar(busca || '') : await controle(acao);
      return res.status(200).json(result);
    } catch (e) {
      return res.status(500).json({ erro: String(e.message || e) });
    }
  }

  res.status(405).json({ error: 'método não suportado' });
};