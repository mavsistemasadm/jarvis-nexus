/* NEXUS → Financeiro do Grupo MH (Supabase externo) */

const FIN_URL = process.env.FINANCEIRO_SUPABASE_URL;
const FIN_KEY = process.env.FINANCEIRO_SUPABASE_KEY;
const FIN_EMAIL = process.env.FINANCEIRO_USER_EMAIL;

function finHeaders() {
  return {
    'apikey': FIN_KEY,
    'authorization': `Bearer ${FIN_KEY}`,
    'content-type': 'application/json'
  };
}

async function callFn(fnName, params = {}) {
  const body = { p_email: FIN_EMAIL, ...params };
  const r = await fetch(`${FIN_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST', headers: finHeaders(), body: JSON.stringify(body)
  });
  return r.json();
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });

  const { action, ano_mes, dias, limit } = req.body || {};

  try {
    let data;
    switch (action) {
      case 'resumo_mensal':
        data = await callFn('resumo_mensal', ano_mes ? { p_ano_mes: ano_mes } : {});
        break;
      case 'contas_a_vencer':
        data = await callFn('contas_a_vencer', { p_dias: dias || 7 });
        break;
      case 'contas_em_atraso':
        data = await callFn('contas_em_atraso');
        break;
      case 'faturamento_vs_meta':
        data = await callFn('faturamento_vs_meta', ano_mes ? { p_ano_mes: ano_mes } : {});
        break;
      case 'top_despesas':
        data = await callFn('top_despesas', { ...(ano_mes ? { p_ano_mes: ano_mes } : {}), p_limit: limit || 10 });
        break;
      case 'fluxo_diario':
        data = await callFn('fluxo_diario', ano_mes ? { p_ano_mes: ano_mes } : {});
        break;
      case 'listar_empresas':
        data = await callFn('listar_empresas');
        break;
      default:
        return res.status(400).json({ error: 'action inválida' });
    }
    res.status(200).json({ data });
  } catch (e) {
    console.error('[nexus] erro financeiro:', e);
    res.status(500).json({ error: String(e) });
  }
};