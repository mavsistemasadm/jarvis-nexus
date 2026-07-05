/* NEXUS → Facebook/Meta Ads (Marketing API) — multi-contas */

const FB_API = process.env.FB_API_URL || 'https://graph.facebook.com/v21.0';

/* FB_AD_ACCOUNTS no formato: "Nome1:12345,Nome2:67890" */
function contas() {
  const raw = process.env.FB_AD_ACCOUNTS || '';
  return raw.split(',').map(p => {
    const [nome, id] = p.split(':').map(s => (s || '').trim());
    return nome && id ? { nome, id } : null;
  }).filter(Boolean);
}

async function fbGet(accountId, path, params = {}) {
  const token = process.env.FB_ACCESS_TOKEN;
  if (!token) return { erro: 'FB_ACCESS_TOKEN não configurado no .env' };
  const qs = new URLSearchParams({ access_token: token, ...params });
  const r = await fetch(`${FB_API}/act_${accountId}${path}?${qs}`);
  const d = await r.json();
  if (d.error) return { erro: d.error.message };
  return d;
}

const CAMPOS = 'spend,impressions,clicks,cpc,cpm,ctr,actions';

function resumir(rows, contaNome) {
  return (rows || []).map(r => ({
    conta: contaNome,
    campanha: r.campaign_name || undefined,
    gasto: r.spend ? Number(r.spend) : 0,
    impressoes: r.impressions ? Number(r.impressions) : 0,
    cliques: r.clicks ? Number(r.clicks) : 0,
    cpc: r.cpc ? Number(Number(r.cpc).toFixed(2)) : null,
    ctr: r.ctr ? Number(Number(r.ctr).toFixed(2)) : null,
    resultados: (r.actions || [])
      .filter(a => ['lead', 'purchase', 'onsite_conversion.messaging_conversation_started_7d', 'link_click'].includes(a.action_type))
      .map(a => ({ tipo: a.action_type, qtd: Number(a.value) }))
  }));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const { action, periodo } = req.body || {};
  const preset = ['today','yesterday','this_month','last_month','last_7d','last_30d'].includes(periodo) ? periodo : 'this_month';
  const cts = contas();
  if (!cts.length) return res.status(200).json({ data: { erro: 'FB_AD_ACCOUNTS não configurado no .env' } });

  try {
    const porConta = await Promise.all(cts.map(async (c) => {
      if (action === 'campanhas') {
        const d = await fbGet(c.id, '/insights', { fields: CAMPOS + ',campaign_name', level: 'campaign', date_preset: preset, limit: 25 });
        return d.erro ? [{ conta: c.nome, erro: d.erro }] : resumir(d.data, c.nome);
      }
      const d = await fbGet(c.id, '/insights', { fields: CAMPOS, date_preset: preset });
      return d.erro ? [{ conta: c.nome, erro: d.erro }] : resumir(d.data, c.nome);
    }));
    res.status(200).json({ data: porConta.flat(), periodo: preset });
  } catch (e) {
    console.error('[nexus] erro facebook:', e);
    res.status(500).json({ error: String(e) });
  }
};