/* NEXUS → Make (dispara cenários via webhook, por voz)
   Configuração no .env, um por linha no formato:
   MAKE_HOOK_NOMEDAACAO=descrição do que faz|https://hook.us1.make.com/xxxx
   Ex.: MAKE_HOOK_WHATSAPP=envia mensagem de WhatsApp (dados: para, mensagem)|https://hook.us1.make.com/abc123
*/

function hooks() {
  const out = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('MAKE_HOOK_')) continue;
    const nome = k.replace('MAKE_HOOK_', '').toLowerCase();
    const [descricao, url] = String(v).split('|').map(s => (s || '').trim());
    if (url && url.startsWith('http')) out.push({ nome, descricao: descricao || nome, url });
  }
  return out;
}

async function disparar(nome, dados = {}) {
  const h = hooks().find(x => x.nome === String(nome || '').toLowerCase());
  if (!h) return { erro: `webhook "${nome}" não existe. Disponíveis: ` + (hooks().map(x => x.nome).join(', ') || 'nenhum') };
  try {
    const r = await fetch(h.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origem: 'nexus', quando: new Date().toISOString(), ...dados })
    });
    const text = await r.text();
    if (!r.ok) return { erro: `Make respondeu ${r.status}: ${text.slice(0, 120)}` };
    return { ok: true, resposta: text.slice(0, 200) };
  } catch (e) {
    return { erro: String(e.message || e) };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  const { acao, nome, dados } = req.body || {};
  if (acao === 'listar') return res.status(200).json({ hooks: hooks().map(h => ({ nome: h.nome, descricao: h.descricao })) });
  const result = await disparar(nome, dados);
  res.status(200).json(result);
};
module.exports.hooks = hooks;
module.exports.disparar = disparar;