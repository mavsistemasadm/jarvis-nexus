/* ══════════════════════════════════════════════════════
   GOOGLE ADS, PELO JARVIS (19/10/2026)

   Pedido do dono: "é possível conectar o Jarvis para ver o Google Ads?". As
   contas da Nexus Pericial (Peritos) e da MH Cálculos, lidas pela API oficial,
   no mesmo jeito do Meta (lib/trafego.js): campanha, grupo de anúncios,
   anúncio, palavra-chave e termo de pesquisa.

   ⚠️ NÃO HÁ DEVELOPER TOKEN. O Google aposentou o token em 09/09/2026; o nível
   de acesso agora é do PROJETO do Google Cloud que emitiu o OAuth. Este módulo
   usa o mesmo projeto e o mesmo cliente OAuth do YouTube ("Jarvis YouTube",
   YOUTUBE_CLIENT_ID/SECRET), com o escopo `adwords`. O nível do projeto é
   Explorer: 2.880 operações por dia em conta real, e cada consulta é uma.

   A autorização está em /api/google-ads-auth. O refresh token e a lista de
   contas moram em `integracoes` (chave google_ads), nunca em env.

   ⚠️ As conversões do Google nesta conta ainda não são confiáveis (ver
   nexus docs/trafego/google-ads.md, §4 a §10). Venda real é a do banco.
   ══════════════════════════════════════════════════════ */
const db = require('./supabase');
const acoes = require('./acoes');

const VERSAO = (process.env.GOOGLE_ADS_VERSAO || 'v26').trim();
const API = `https://googleads.googleapis.com/${VERSAO}`;
const ESCOPO = 'https://www.googleapis.com/auth/adwords';
const RETORNO = 'https://jarvis.nexuspericial.com.br/api/google-ads-auth';
const CHAVE = 'google_ads';

function credenciais() {
  const id = (process.env.YOUTUBE_CLIENT_ID || '').trim();
  const segredo = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  return id && segredo ? { id, segredo } : null;
}

async function lerIntegracao() {
  const [l] = await db.query('integracoes', `chave=eq.${CHAVE}&limit=1`);
  return l && l.valor ? l.valor : null;
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
  if (!r.ok) throw new Error(`não gravei a integração (${r.status})`);
}

function urlDeAutorizacao() {
  const c = credenciais();
  if (!c) throw new Error('YOUTUBE_CLIENT_ID/SECRET não configurados');
  const q = new URLSearchParams({
    client_id: c.id, redirect_uri: RETORNO, response_type: 'code', scope: ESCOPO,
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

async function tokenDeAcesso(integ) {
  const c = credenciais();
  if (!c || !integ || !integ.refresh_token) throw new Error('Google Ads não autorizado: abra jarvis.nexuspericial.com.br/api/google-ads-auth');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: integ.refresh_token, client_id: c.id, client_secret: c.segredo, grant_type: 'refresh_token' }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Google recusou o token: ${d.error_description || d.error || r.status}`);
  return d.access_token;
}

/* O erro do Google Ads vem aninhado (error.details[].errors[].message); o
   primeiro texto útil é o que vai para o Jarvis dizer. */
function mensagemDeErro(d, status) {
  const det = d && d.error && Array.isArray(d.error.details) ? d.error.details : [];
  for (const x of det) {
    const e = x && Array.isArray(x.errors) && x.errors[0];
    if (e && e.message) return `${e.message}${e.errorCode ? ` (${Object.values(e.errorCode)[0]})` : ''}`;
  }
  return (d && d.error && d.error.message) || `HTTP ${status}`;
}

async function chamar(caminho, { token, login, corpo, metodo } = {}) {
  const r = await fetch(`${API}${caminho}`, {
    method: metodo || (corpo ? 'POST' : 'GET'),
    headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
      ...(login ? { 'login-customer-id': String(login) } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Ads: ${mensagemDeErro(d, r.status)}`);
  return d;
}

/** GAQL numa conta, com as páginas juntas (teto de 5 páginas). */
async function consultar(conta, query, token) {
  const linhas = [];
  let pagina = null;
  for (let i = 0; i < 5; i++) {
    const d = await chamar(`/customers/${conta.id}/googleAds:search`, {
      token, login: conta.login, corpo: { query, ...(pagina ? { pageToken: pagina } : {}) },
    });
    linhas.push(...(d.results || []));
    if (!d.nextPageToken) break;
    pagina = d.nextPageToken;
  }
  return linhas;
}

/* As contas que o login alcança: as diretas e, dentro de cada conta de
   administrador (MCC), as filhas. `login` é a conta por onde se entra, que
   vai no cabeçalho login-customer-id. Só contas de anúncio ativas ficam. */
async function descobrirContas(token) {
  const d = await chamar('/customers:listAccessibleCustomers', { token });
  const ids = (d.resourceNames || []).map(n => n.split('/')[1]);
  const contas = new Map();
  for (const id of ids) {
    let info;
    try {
      [info] = await consultar({ id, login: id },
        'SELECT customer.id, customer.descriptive_name, customer.manager, customer.status FROM customer', token);
    } catch { continue; } // conta cancelada ou sem acesso: não entra
    const c = info && info.customer;
    if (!c || c.status !== 'ENABLED') continue;
    if (!c.manager) {
      if (!contas.has(id)) contas.set(id, { id, nome: c.descriptiveName || id, login: id });
      continue;
    }
    const filhas = await consultar({ id, login: id },
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 1', token)
      .catch(() => []);
    for (const f of filhas) {
      const cc = f.customerClient;
      if (!cc || cc.manager || cc.status !== 'ENABLED') continue;
      const fid = String(cc.id);
      // Entrar pela própria conta, quando o login tem acesso direto, vence.
      if (!contas.has(fid)) contas.set(fid, { id: fid, nome: cc.descriptiveName || fid, login: id });
    }
  }
  return [...contas.values()];
}

async function concluirAutorizacao(code) {
  const tok = await trocarCodigo(code);
  // Gravado ANTES de chamar a API (mesma regra do YouTube): se o projeto
  // ainda não tiver acesso, a autorização não se perde.
  const base = { refresh_token: tok.refresh_token, autorizado_em: new Date().toISOString() };
  await gravarIntegracao(base);
  const contas = await descobrirContas(tok.access_token);
  await gravarIntegracao({ ...base, contas, contas_em: new Date().toISOString() });
  return { contas };
}

/** Token e contas; descobre as contas se ainda não houver lista. */
async function sessao() {
  const integ = await lerIntegracao();
  const token = await tokenDeAcesso(integ);
  let contas = integ.contas;
  if (!Array.isArray(contas) || !contas.length) {
    contas = await descobrirContas(token);
    await gravarIntegracao({ ...integ, contas, contas_em: new Date().toISOString() });
  }
  return { token, contas };
}

const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const soDigitos = (s) => String(s || '').replace(/\D/g, '');

/** "mh", "nexus", "peritos", ou o id (com ou sem traços). Vazio = todas. */
function escolherContas(contas, pedido) {
  if (!pedido) return contas;
  const dig = soDigitos(pedido);
  if (dig.length >= 8) return contas.filter(c => c.id === dig);
  const p = normal(pedido);
  const achadas = contas.filter(c => normal(c.nome).includes(p));
  if (achadas.length) return achadas;
  // "Peritos" é a conta da Nexus Pericial (o nome no Google é o do produto).
  if (/perit|academy/.test(p)) return contas.filter(c => /nexus/.test(normal(c.nome)));
  return [];
}

function ymdSP(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
const reais = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n) => Math.round(n * 100) / 100;
const STATUS = { ENABLED: 'ativa', PAUSED: 'pausada', REMOVED: 'removida' };

const METRICAS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value';

function numeros(m = {}) {
  const gasto = Number(m.costMicros || 0) / 1e6;
  const impressoes = Number(m.impressions || 0);
  const cliques = Number(m.clicks || 0);
  const conversoes = Number(m.conversions || 0);
  const valor = Number(m.conversionsValue || 0);
  return {
    gasto: r2(gasto), impressoes, cliques,
    ctr: impressoes ? r2(cliques / impressoes * 100) : 0,
    cpc: cliques ? r2(gasto / cliques) : 0,
    conversoes: r2(conversoes), valorConversoes: r2(valor),
    cpa: conversoes ? r2(gasto / conversoes) : null,
    roas: gasto && valor ? r2(valor / gasto) : null,
  };
}

/* Uma consulta por nível. `filtro` é o recorte de campanha, já validado. */
const NIVEIS = {
  campanha: {
    lista: 'campanhas',
    gaql: (p, filtro) => `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros, campaign_budget.explicitly_shared, metrics.search_impression_share, ${METRICAS} FROM campaign WHERE segments.date BETWEEN '${p.de}' AND '${p.ate}' AND campaign.status != 'REMOVED'${filtro}`,
    linha: (l) => ({
      id: l.campaign.id, nome: l.campaign.name, status: STATUS[l.campaign.status] || l.campaign.status,
      tipo: l.campaign.advertisingChannelType, lance: l.campaign.biddingStrategyType,
      orcamentoDia: l.campaignBudget ? r2(Number(l.campaignBudget.amountMicros || 0) / 1e6) : null,
      orcamentoCompartilhado: !!(l.campaignBudget && l.campaignBudget.explicitlyShared) || undefined,
      parcelaImpressoes: l.metrics.searchImpressionShare != null ? r2(Number(l.metrics.searchImpressionShare) * 100) : undefined,
      ...numeros(l.metrics),
    }),
  },
  grupo: {
    lista: 'grupos',
    gaql: (p, filtro) => `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id, campaign.name, ${METRICAS} FROM ad_group WHERE segments.date BETWEEN '${p.de}' AND '${p.ate}' AND ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'${filtro}`,
    linha: (l) => ({
      id: l.adGroup.id, nome: l.adGroup.name, status: STATUS[l.adGroup.status] || l.adGroup.status,
      campanhaId: l.campaign.id, campanha: l.campaign.name, ...numeros(l.metrics),
    }),
  },
  anuncio: {
    lista: 'anuncios',
    gaql: (p, filtro) => `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.status, ad_group.name, campaign.id, campaign.name, ${METRICAS} FROM ad_group_ad WHERE segments.date BETWEEN '${p.de}' AND '${p.ate}' AND ad_group_ad.status != 'REMOVED' AND campaign.status != 'REMOVED'${filtro}`,
    linha: (l) => {
      const ad = l.adGroupAd.ad || {};
      const titulos = ((ad.responsiveSearchAd && ad.responsiveSearchAd.headlines) || []).slice(0, 3).map(h => h.text);
      return {
        id: ad.id, nome: ad.name || titulos.join(' | ') || ad.type, status: STATUS[l.adGroupAd.status] || l.adGroupAd.status,
        grupo: l.adGroup.name, campanhaId: l.campaign.id, campanha: l.campaign.name, ...numeros(l.metrics),
      };
    },
  },
  palavra: {
    lista: 'palavras',
    gaql: (p, filtro) => `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group.name, campaign.id, campaign.name, ${METRICAS} FROM keyword_view WHERE segments.date BETWEEN '${p.de}' AND '${p.ate}' AND ad_group_criterion.status != 'REMOVED' AND campaign.status != 'REMOVED'${filtro} ORDER BY metrics.cost_micros DESC LIMIT 60`,
    linha: (l) => ({
      palavra: l.adGroupCriterion.keyword.text, correspondencia: l.adGroupCriterion.keyword.matchType,
      status: STATUS[l.adGroupCriterion.status] || l.adGroupCriterion.status,
      grupo: l.adGroup.name, campanhaId: l.campaign.id, campanha: l.campaign.name, ...numeros(l.metrics),
    }),
  },
  termo: {
    lista: 'termos',
    gaql: (p, filtro) => `SELECT search_term_view.search_term, search_term_view.status, ad_group.name, campaign.id, campaign.name, ${METRICAS} FROM search_term_view WHERE segments.date BETWEEN '${p.de}' AND '${p.ate}'${filtro} ORDER BY metrics.cost_micros DESC LIMIT 60`,
    linha: (l) => ({
      termo: l.searchTermView.searchTerm, situacao: l.searchTermView.status,
      grupo: l.adGroup.name, campanhaId: l.campaign.id, campanha: l.campaign.name, ...numeros(l.metrics),
    }),
  },
};

async function desempenho(i) {
  const { token, contas } = await sessao();
  const escolhidas = escolherContas(contas, i.conta);
  if (!escolhidas.length) return { erro: `nenhuma conta do Google Ads com "${i.conta}"`, contas: contas.map(c => c.nome) };
  const hoje = new Date();
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(i.ate || '') ? i.ate : ymdSP(hoje);
  const de = /^\d{4}-\d{2}-\d{2}$/.test(i.de || '') ? i.de
    : ymdSP(new Date(hoje.getTime() - (Math.max(1, Number(i.dias) || 7) - 1) * 86400000));
  const nivel = NIVEIS[i.nivel] ? i.nivel : 'campanha';
  const n = NIVEIS[nivel];
  const campanhaId = soDigitos(i.campanhaId);
  const filtro = campanhaId ? ` AND campaign.id = ${campanhaId}` : '';

  const resultado = [];
  for (const conta of escolhidas) {
    try {
      const linhas = (await consultar(conta, n.gaql({ de, ate }, filtro), token)).map(n.linha);
      // Só o que gastou ou está ativo: parado sem gasto é ruído na voz.
      const uteis = linhas.filter(x => x.gasto > 0 || x.status === 'ativa').sort((a, b) => b.gasto - a.gasto).slice(0, 40);
      const total = numeros({
        costMicros: linhas.reduce((s, x) => s + x.gasto * 1e6, 0),
        impressions: linhas.reduce((s, x) => s + x.impressoes, 0),
        clicks: linhas.reduce((s, x) => s + x.cliques, 0),
        conversions: linhas.reduce((s, x) => s + x.conversoes, 0),
        conversionsValue: linhas.reduce((s, x) => s + x.valorConversoes, 0),
      });
      resultado.push({ conta: conta.nome, contaId: conta.id, ...(nivel === 'termo' || nivel === 'palavra' ? {} : { total }), [n.lista]: uteis });
    } catch (e) {
      resultado.push({ conta: conta.nome, contaId: conta.id, erro: e.message });
    }
  }
  return {
    periodo: { de, ate }, nivel, contas: resultado,
    nota: 'Conversões do Google ainda não são confiáveis nestas contas (rastreamento em correção). Gasto, cliques, CTR e CPC são confiáveis. Venda real do Nexus: nexus_panorama.',
  };
}

/* ── Ações: pausar, ativar, orçamento ─────────────────────────────────────
   Toda ação propõe e espera o sim (lib/acoes.js). Na execução, a conta é
   relida: o que valia na proposta pode ter mudado em 15 minutos. */
async function contaPorId(contaId) {
  const { token, contas } = await sessao();
  const conta = contas.find(c => c.id === soDigitos(contaId));
  if (!conta) throw new Error(`conta ${contaId} não está entre as autorizadas`);
  return { token, conta };
}

async function mudarStatus(e, status) {
  const { token, conta } = await contaPorId(e.contaId);
  const grupo = soDigitos(e.grupoId);
  const campanha = soDigitos(e.campanhaId);
  if (!grupo && !campanha) return { erro: 'faltou campanhaId ou grupoId' };
  const [recurso, rota] = grupo
    ? [`customers/${conta.id}/adGroups/${grupo}`, 'adGroups']
    : [`customers/${conta.id}/campaigns/${campanha}`, 'campaigns'];
  await chamar(`/customers/${conta.id}/${rota}:mutate`, {
    token, login: conta.login,
    corpo: { operations: [{ update: { resourceName: recurso, status }, updateMask: 'status' }] },
  });
  return { ok: true, conta: conta.nome, [grupo ? 'grupoId' : 'campanhaId']: grupo || campanha, status: STATUS[status] };
}

async function mudarOrcamento(e) {
  const { token, conta } = await contaPorId(e.contaId);
  const campanha = soDigitos(e.campanhaId);
  const valor = Number(e.valorDia);
  if (!campanha || !(valor > 0)) return { erro: 'faltou campanhaId ou valorDia' };
  const [l] = await consultar(conta,
    `SELECT campaign.name, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${campanha}`, token);
  if (!l || !l.campaignBudget) return { erro: 'campanha sem orçamento próprio' };
  if (l.campaignBudget.explicitlyShared) return { erro: 'o orçamento desta campanha é compartilhado com outras; mude no painel do Google Ads' };
  const atual = Number(l.campaignBudget.amountMicros || 0) / 1e6;
  // Mesmo teto do Meta: no máximo 3x o atual numa mudança.
  if (atual > 0 && valor > atual * 3) return { erro: `recusado: ${reais(valor)} passa de 3 vezes o atual (${reais(atual)})` };
  await chamar(`/customers/${conta.id}/campaignBudgets:mutate`, {
    token, login: conta.login,
    corpo: { operations: [{ update: { resourceName: l.campaignBudget.resourceName, amountMicros: String(Math.round(valor * 1e6)) }, updateMask: 'amount_micros' }] },
  });
  return { ok: true, conta: conta.nome, campanha: l.campaign.name, de: r2(atual), para: r2(valor) };
}

acoes.registrar('google_pausar', (e) => mudarStatus(e, 'PAUSED'));
acoes.registrar('google_ativar', (e) => mudarStatus(e, 'ENABLED'));
acoes.registrar('google_orcamento', mudarOrcamento);

const alvo = (i) => ({ contaId: soDigitos(i.contaId), ...(i.grupoId ? { grupoId: soDigitos(i.grupoId) } : { campanhaId: soDigitos(i.campanhaId) }) });
const qual = (i) => (i.grupoId ? `o grupo de anúncios "${i.nome}"` : `a campanha "${i.nome}"`);
const ALVO_SCHEMA = {
  contaId: { type: 'string', description: 'contaId de trafego_google.' },
  campanhaId: { type: 'string' }, grupoId: { type: 'string', description: 'Para mexer num grupo de anúncios em vez da campanha.' },
  nome: { type: 'string' },
};

const FERRAMENTAS = [
  {
    def: {
      name: 'trafego_google',
      description: 'Google Ads (contas Nexus Pericial e MH Cálculos) num período: gasto, impressões, cliques, CTR, CPC, conversões, CPA, ROAS, orçamento diário e status. nivel: "campanha" (padrão), "grupo" (grupos de anúncios), "anuncio", "palavra" (palavras-chave, as 60 que mais gastaram) ou "termo" (termos de pesquisa que as pessoas digitaram, os 60 que mais gastaram; é onde se acha palavra negativa). conta: "nexus"/"peritos", "mh" ou vazio para todas. campanhaId restringe a uma campanha. As conversões do Google ainda não são confiáveis: julgue por gasto, cliques, CTR e CPC, e confira venda real com nexus_panorama.',
      input_schema: {
        type: 'object',
        properties: {
          conta: { type: 'string', description: 'nexus, peritos, mh, ou o id. Vazio = todas.' },
          nivel: { type: 'string', enum: Object.keys(NIVEIS) },
          campanhaId: { type: 'string' },
          dias: { type: 'number', description: 'Últimos N dias (padrão 7), em dias de Brasília. Ignorado se de/ate vierem.' },
          de: { type: 'string', description: 'AAAA-MM-DD' },
          ate: { type: 'string', description: 'AAAA-MM-DD' },
        },
      },
    },
    run: desempenho,
  },
  {
    def: {
      name: 'trafego_google_pausar',
      description: 'PROPÕE pausar uma campanha do Google Ads, ou um grupo de anúncios (grupoId). Pegue contaId, ids e nome em trafego_google. Pausar se desfaz ativando.',
      input_schema: { type: 'object', properties: ALVO_SCHEMA, required: ['contaId', 'nome'] },
    },
    run: (i, ctx) => acoes.propor('google_pausar', alvo(i), `Pausar ${qual(i)} no Google Ads`, ctx),
  },
  {
    def: {
      name: 'trafego_google_ativar',
      description: 'PROPÕE ativar (voltar a rodar) uma campanha ou um grupo de anúncios (grupoId) do Google Ads que está pausado.',
      input_schema: { type: 'object', properties: ALVO_SCHEMA, required: ['contaId', 'nome'] },
    },
    run: (i, ctx) => acoes.propor('google_ativar', alvo(i), `Ativar ${qual(i)} no Google Ads`, ctx),
  },
  {
    def: {
      name: 'trafego_google_orcamento',
      description: 'PROPÕE mudar o orçamento diário, em reais, de uma campanha do Google Ads. No máximo 3 vezes o atual numa mudança; orçamento compartilhado entre campanhas é recusado. Diga o valor atual e o novo no resumo.',
      input_schema: {
        type: 'object',
        properties: { contaId: { type: 'string' }, campanhaId: { type: 'string' }, nome: { type: 'string' }, valorDia: { type: 'number' }, valorAtual: { type: 'number' } },
        required: ['contaId', 'campanhaId', 'nome', 'valorDia'],
      },
    },
    run: (i, ctx) => acoes.propor('google_orcamento', { contaId: soDigitos(i.contaId), campanhaId: soDigitos(i.campanhaId), valorDia: i.valorDia },
      `Orçamento diário da campanha "${i.nome}" no Google Ads: ${i.valorAtual ? `de ${reais(i.valorAtual)} ` : ''}para ${reais(i.valorDia)}`, ctx),
  },
];

module.exports = {
  FERRAMENTAS, urlDeAutorizacao, concluirAutorizacao, desempenho,
  disponivel: () => !!(credenciais() && process.env.SUPABASE_URL),
};
