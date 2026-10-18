/* ══════════════════════════════════════════════════════
   O YOUTUBE DO CANAL, PELO JARVIS (18/10/2026)

   Pedido do dono: "só me preocupar em estar presente". O Jarvis agenda a
   transmissão no canal, o link já existe na hora do agendamento, e a live
   da Academy nasce com ele (academy_criar_live). Na hora, o dono abre o
   OBS e clica em "Iniciar transmissão": a transmissão foi criada com
   enableAutoStart/enableAutoStop, então entra no ar sozinha quando o sinal
   chega e sai quando ele para. Ninguém abre o YouTube Studio.

   ⚠️ UMA CHAVE SÓ PARA SEMPRE. Toda transmissão é ligada (bind) à mesma
   stream reutilizável "Lives Peritos Academy", a que o canal já tinha. É por isso
   que o OBS é configurado uma única vez.

   A autorização (OAuth do Google, projeto "Jarvis YouTube" na conta do
   dono) está em /api/youtube-auth. O refresh token mora em `integracoes`
   (sql/integracoes.sql), nunca em env: env não se reescreve sozinha.
   ══════════════════════════════════════════════════════ */
const db = require('./supabase');

const API = 'https://www.googleapis.com/youtube/v3';
const ESCOPO = 'https://www.googleapis.com/auth/youtube';
const RETORNO = 'https://jarvis.nexuspericial.com.br/api/youtube-auth';
// A chave que o canal já usa nas lives (criada em 08/2024). Usar a existente
// em vez de criar uma: criar stream pela API devolveu 500 do YouTube na
// autorização de 18/10/2026, e reaproveitar evita mexer no OBS.
const NOME_DA_CHAVE = 'Lives Peritos Academy';

function credenciais() {
  const id = (process.env.YOUTUBE_CLIENT_ID || '').trim();
  const segredo = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  return id && segredo ? { id, segredo } : null;
}

async function lerIntegracao() {
  const [l] = await db.query('integracoes', 'chave=eq.youtube&limit=1');
  return l && l.valor ? l.valor : null;
}

async function gravarIntegracao(valor) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/integracoes?on_conflict=chave`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY, authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json', prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ chave: 'youtube', valor, atualizada_em: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`não gravei a integração (${r.status})`);
}

function urlDeAutorizacao() {
  const c = credenciais();
  if (!c) throw new Error('YOUTUBE_CLIENT_ID/SECRET não configurados');
  const q = new URLSearchParams({
    client_id: c.id, redirect_uri: RETORNO, response_type: 'code', scope: ESCOPO,
    // offline + consent: é o que garante o refresh token, inclusive numa
    // segunda autorização (sem `consent` o Google não manda de novo).
    access_type: 'offline', prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function trocarCodigo(code) {
  const c = credenciais();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.segredo, redirect_uri: RETORNO, grant_type: 'authorization_code' }),
  });
  const d = await r.json();
  if (!r.ok || !d.refresh_token) throw new Error(`Google recusou a troca: ${d.error_description || d.error || r.status}`);
  return d;
}

async function tokenDeAcesso() {
  const c = credenciais();
  const integ = await lerIntegracao();
  if (!c || !integ || !integ.refresh_token) throw new Error('YouTube não autorizado: abra jarvis.nexuspericial.com.br/api/youtube-auth');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: integ.refresh_token, client_id: c.id, client_secret: c.segredo, grant_type: 'refresh_token' }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Google recusou o token: ${d.error_description || d.error || r.status}`);
  return d.access_token;
}

async function yt(caminho, opcoes = {}, token) {
  const t = token || await tokenDeAcesso();
  const r = await fetch(`${API}${caminho}`, {
    ...opcoes, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(opcoes.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`YouTube ${r.status}: ${(d.error && d.error.message) || 'erro'}`);
  return d;
}

/** A stream reutilizável do Jarvis; cria na primeira vez. Devolve id e canal. */
async function garantirChave(token) {
  const lista = await yt('/liveStreams?part=id,snippet,cdn,contentDetails&mine=true&maxResults=50', {}, token);
  const achada = (lista.items || []).find(s => s.snippet && s.snippet.title.trim() === NOME_DA_CHAVE);
  if (achada) return achada;
  return yt('/liveStreams?part=id,snippet,cdn,contentDetails', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title: NOME_DA_CHAVE },
      cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
      contentDetails: { isReusable: true },
    }),
  }, token);
}

/** Chamado uma vez, ao fim da autorização: guarda o token e prepara a chave. */
async function concluirAutorizacao(code) {
  const tok = await trocarCodigo(code);
  // O token é gravado ANTES de qualquer chamada ao YouTube: se a API falhar
  // (como a primeira vez, com a API ainda desligada no projeto), a
  // autorização não se perde e não é preciso pedir ao dono de novo.
  await gravarIntegracao({ refresh_token: tok.refresh_token, autorizado_em: new Date().toISOString() });
  const canal = await yt('/channels?part=snippet&mine=true', {}, tok.access_token);
  const c = (canal.items || [])[0];
  await gravarIntegracao({
    refresh_token: tok.refresh_token,
    canal_id: c && c.id, canal_nome: c && c.snippet && c.snippet.title,
    autorizado_em: new Date().toISOString(),
  });
  const chave = await garantirChave(tok.access_token);
  return { canal: c && c.snippet && c.snippet.title, chave: NOME_DA_CHAVE, streamId: chave.id };
}

/**
 * Agenda a transmissão e a liga à chave fixa. `inicioISO` em UTC.
 * Pública por padrão: é live de comunidade, e ela também toca embutida na
 * página do evento da Academy.
 */
async function agendar({ titulo, descricao, inicioISO, privacidade = 'public' }) {
  const token = await tokenDeAcesso();
  const b = await yt('/liveBroadcasts?part=id,snippet,status,contentDetails', {
    method: 'POST',
    body: JSON.stringify({
      snippet: { title: String(titulo).slice(0, 100), description: descricao || '', scheduledStartTime: inicioISO },
      status: { privacyStatus: privacidade, selfDeclaredMadeForKids: false },
      contentDetails: {
        enableAutoStart: true, enableAutoStop: true, enableDvr: true, recordFromStart: true,
        latencyPreference: 'low', monitorStream: { enableMonitorStream: false },
      },
    }),
  }, token);
  const chave = await garantirChave(token);
  await yt(`/liveBroadcasts/bind?id=${b.id}&part=id,contentDetails&streamId=${chave.id}`, { method: 'POST' }, token);
  return { videoId: b.id, link: `https://www.youtube.com/watch?v=${b.id}` };
}

/** created · ready · testing · live · complete · revoked */
async function situacao(videoId) {
  const d = await yt(`/liveBroadcasts?part=status&id=${encodeURIComponent(videoId)}`);
  const it = (d.items || [])[0];
  return it ? it.status.lifeCycleStatus : null;
}

async function conectado() {
  if (!credenciais()) return false;
  const integ = await lerIntegracao().catch(() => null);
  return !!(integ && integ.refresh_token);
}

module.exports = { urlDeAutorizacao, concluirAutorizacao, agendar, situacao, conectado, NOME_DA_CHAVE };
