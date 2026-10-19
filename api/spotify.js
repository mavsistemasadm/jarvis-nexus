/* NEXUS → Spotify (OAuth + busca + play/pause/next) */

const SP_ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com';
const SP_API = process.env.SPOTIFY_API_URL || 'https://api.spotify.com';

/* A autorização da conta mora em `integracoes` (chave spotify), como a do
   Google Ads (19/10/2026): o dono entra uma vez em /api/spotify/login, e o
   refresh token é guardado aqui, nunca mostrado na tela nem copiado para env.
   SPOTIFY_REFRESH_TOKEN no env continua valendo, se existir. */
const db = require('../lib/supabase');
const CHAVE = 'spotify';
const RETORNO = 'https://jarvis.nexuspericial.com.br/api/spotify/callback';

async function lerIntegracao() {
  try { const [l] = await db.query('integracoes', `chave=eq.${CHAVE}&limit=1`); return l && l.valor ? l.valor : null; } catch { return null; }
}

async function gravarIntegracao(valor) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes?on_conflict=chave`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json', prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ chave: CHAVE, valor, atualizada_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`não gravei a autorização do Spotify (${r.status})`);
}

function creds() {
  return {
    id: process.env.SPOTIFY_CLIENT_ID,
    secret: process.env.SPOTIFY_CLIENT_SECRET,
    redirect: process.env.SPOTIFY_REDIRECT_URI || RETORNO,
    refresh: process.env.SPOTIFY_REFRESH_TOKEN
  };
}

async function accessToken() {
  const c = creds();
  if (!c.refresh) c.refresh = (await lerIntegracao())?.refresh_token;
  if (!c.id || !c.secret) throw new Error('Spotify sem SPOTIFY_CLIENT_ID/SECRET na Vercel');
  if (!c.refresh) throw new Error('Spotify ainda não conectado: abra jarvis.nexuspericial.com.br/api/spotify/login uma vez');
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
  // O Spotify às vezes troca o refresh token: o novo passa a valer.
  if (d.refresh_token && !process.env.SPOTIFY_REFRESH_TOKEN) await gravarIntegracao({ refresh_token: d.refresh_token }).catch(() => {});
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

  // ⚠️ APARELHO ABERTO MAS PARADO NÃO É "ATIVO" para o Spotify, e o play sem
  // device_id devolve 404. Com o Spotify aberto em algum lugar, toca nele.
  let r = await fetch(`${SP_API}/v1/me/player/play`, {
    method: 'PUT',
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (r.status === 404) {
    const d = await spFetch(token, '/me/player/devices');
    const aparelho = (d.devices || [])[0];
    if (aparelho) {
      r = await fetch(`${SP_API}/v1/me/player/play?device_id=${encodeURIComponent(aparelho.id)}`, {
        method: 'PUT',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
  }
  if (r.status === 404) return { erro: 'nenhum aparelho com o Spotify aberto: abra o Spotify no computador ou no celular' };
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

async function atender(req, res) {
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
    if (!d.refresh_token) return res.status(500).end('<h2>O Spotify não autorizou: ' + String(d.error_description || d.error || 'sem motivo') + '</h2>');
    await gravarIntegracao({ refresh_token: d.refresh_token, conectado_em: new Date().toISOString() });
    return res.status(200).end(`<body style="font-family:sans-serif;background:#0a0f1e;color:#dbe7ff;padding:40px">
      <h2>✅ Spotify conectado ao Jarvis</h2>
      <p>Pode fechar esta aba e pedir uma música para ele. Deixe o Spotify aberto em algum aparelho.</p></body>`);
  }

  /* GET /api/spotify/status → conectado? qual aparelho está ativo? */
  if (req.method === 'GET' && url.includes('/status')) {
    try {
      const token = await accessToken();
      const d = await spFetch(token, '/me/player/devices');
      const ativo = (d.devices || []).find((x) => x.is_active) || null;
      return res.status(200).json({ conectado: true, aparelhos: (d.devices || []).map((x) => x.name), ativo: ativo && ativo.name });
    } catch (e) {
      return res.status(200).json({ conectado: false, motivo: String(e.message || e) });
    }
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

/* Só o dono, pela sessão do Nexus (lib/sessao.js). `interno` é o handler cru,
   para quem chama por dentro já autenticado por outro caminho (o WhatsApp). */
const { comSessao } = require('../lib/sessao');
// O que o arquivo já exportava além da rota (ex.: make.hooks, usado pelo
// chat) continua exportado: trocar module.exports apagava essas funções.
const exportadosAntes = { ...module.exports };
module.exports = Object.assign(comSessao(atender), exportadosAntes);
module.exports.interno = atender;

/* O estado da conexão, para o bom dia dizer se a música vai tocar. */
module.exports.status = async () => {
  try {
    const token = await accessToken();
    const d = await spFetch(token, '/me/player/devices');
    const ativo = (d.devices || []).find((x) => x.is_active) || null;
    return { conectado: true, aparelhos: (d.devices || []).map((x) => x.name), ativo: ativo && ativo.name };
  } catch (e) {
    return { conectado: false, motivo: String(e.message || e) };
  }
};
