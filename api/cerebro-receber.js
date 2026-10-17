/* ══════════════════════════════════════════════════════
   O cérebro recebe na hora (17/10/2026)

   Cada repositório tem um GitHub Action (.github/workflows/jarvis-cerebro.yml)
   que, quando um .md muda na main, manda aqui os arquivos alterados e os
   apagados. Aqui eles são cortados por título (o mesmo `secoes` da
   sincronização completa) e regravados em cerebro_secoes.

   Assim o Jarvis não precisa de credencial do GitHub: quem lê o repositório é
   o próprio GitHub, com o token que ele dá a cada execução.

   POST { projeto, arquivos: [{ caminho, sha, conteudo }], apagados: [caminho] }
   header x-cerebro-key: JARVIS_CEREBRO_KEY
   ══════════════════════════════════════════════════════ */
const crypto = require('crypto');
const { secoes, REPOS, FORA, MIN_BYTES } = require('../lib/cerebro-sync');

function chaveConfere(recebida) {
  const esperada = (process.env.JARVIS_CEREBRO_KEY || '').trim();
  if (!esperada || !recebida) return false;
  const a = Buffer.from(String(recebida)); const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sb(metodo, caminho, corpo) {
  const URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const r = await fetch(`${URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('{}'); }
  if (!chaveConfere(req.headers['x-cerebro-key'])) { res.statusCode = 401; return res.end(JSON.stringify({ erro: 'não autorizado' })); }
  const { projeto, arquivos = [], apagados = [] } = req.body || {};
  if (!REPOS.includes(projeto)) { res.statusCode = 400; return res.end(JSON.stringify({ erro: 'projeto desconhecido' })); }
  try {
    let gravadas = 0, ignorados = 0;
    const fora = (c) => FORA.some(r => r.test(c));
    for (const c of apagados) {
      await sb('DELETE', `cerebro_secoes?projeto=eq.${projeto}&arquivo=eq.${encodeURIComponent(c)}`);
    }
    for (const a of arquivos) {
      const caminho = String(a.caminho || '');
      const conteudo = String(a.conteudo || '');
      await sb('DELETE', `cerebro_secoes?projeto=eq.${projeto}&arquivo=eq.${encodeURIComponent(caminho)}`);
      if (!caminho.endsWith('.md') || fora(caminho) || Buffer.byteLength(conteudo) < MIN_BYTES) { ignorados++; continue; }
      const lista = secoes(conteudo, caminho).map((s, i) => ({ projeto, arquivo: caminho, titulo: s.titulo.slice(0, 500), ordem: i, conteudo: s.conteudo, sha: a.sha || null }));
      for (let i = 0; i < lista.length; i += 200) await sb('POST', 'cerebro_secoes', lista.slice(i, i + 200));
      gravadas += lista.length;
    }
    return res.end(JSON.stringify({ ok: true, projeto, arquivos: arquivos.length, apagados: apagados.length, secoes: gravadas, ignorados }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ erro: e.message }));
  }
};
