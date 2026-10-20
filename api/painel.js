/* NEXUS → painel: o que fica em volta do núcleo na tela (20/10/2026).

   O HUD mostra o dia sem precisar perguntar: tarefas, agenda, atendimento,
   alertas, o financeiro (recebido, pago e saldo do período, igual ao
   dashboard do Financeiro), as contas (vencidas e a vencer) e o tráfego
   (Meta, Google e as vendas reais do Nexus). Financeiro e tráfego abrem no
   mês corrente; ?de=&ate= troca o período (seletor da tela ou pela voz). A tela
   pede isto ao abrir, a cada 2 minutos e depois de cada resposta.

   ⚠️ CADA PAINEL É ISOLADO. Fonte que falhou volta `{ erro }` e o painel diz
   "não consegui verificar", nunca zero. Ausência de medição não é zero.

   ⚠️ REQUIRE COM O CAMINHO ESCRITO. A Vercel empacota cada função só com os
   arquivos que enxerga no código. A primeira versão carregava os módulos com
   require(variável): tarefas, tráfego, Google e vigia ficaram fora do deploy
   e o painel mostrava "sem leitura" em produção, funcionando no local.

   POST { acao: 'concluir' | 'reabrir', id } marca uma tarefa pelo check da
   tela, sem passar pelo modelo.

   Só o dono (lib/sessao.js).                                               */

const negocios = require('../lib/negocios');
const opcional = (fn) => { try { return fn(); } catch (e) { console.warn('[nexus] painel sem módulo:', e.message); return null; } };
const tarefasPessoais = opcional(() => require('../lib/tarefas-pessoais'));
const trafegoMeta = opcional(() => require('../lib/trafego'));
const googleAds = opcional(() => require('../lib/google-ads'));
const vigia = opcional(() => require('../lib/vigia'));
const panoramas = opcional(() => require('../lib/panoramas'));
const financeiroApp = opcional(() => require('../lib/financeiro-app'));

const ymdSP = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const r0 = (v) => Math.round(Number(v) || 0);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function tentar(fn) {
  try { return await fn(); }
  catch (e) { return { erro: String(e.message || e) }; }
}
const ferramenta = (lista, nome) => ((lista || []).find((f) => f.def && f.def.name === nome) || {}).run;
/* títulos do Opera chegam com emoji ("📄 Entrega: 🤖 trabalhista"): na tela
   de linhas finas eles viram ruído */
const limpar = (t) => String(t || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s{2,}/g, ' ').trim();

async function tarefas() {
  if (!tarefasPessoais || !tarefasPessoais.disponivel()) return { erro: 'tarefas sem banco configurado' };
  const [hoje, feitas] = await Promise.all([tarefasPessoais.deHoje(), tarefasPessoais.feitasHoje()]);
  return { itens: [...hoje, ...feitas].slice(0, 8) };
}

async function agenda() {
  const ag = await negocios.executar('agenda_prazos', { dias: 2 });
  if (ag.erro) return ag;
  const hoje = ymdSP(new Date());
  const itens = [...(ag.compromissos_marcados || []), ...(ag.prazos_de_processo || [])]
    .filter((e) => e.data_evento)
    .map((e) => ({
      titulo: limpar(e.titulo), tipo: String(e.tipo || '').replace(/_/g, ' '),
      quando: String(e.data_evento), hoje: String(e.data_evento).slice(0, 10) === hoje,
      critico: ['prazo_fatal', 'audiencia', 'entrega_laudo', 'prazo_processo'].includes(e.tipo),
      local: e.local ? limpar(e.local) : null,
    }))
    .sort((a, b) => a.quando.localeCompare(b.quando));
  const parados = (ag.followups_pendentes || []).filter((f) => f.parado_ha_dias >= 7).length;
  return { itens: itens.slice(0, 5), total: itens.length, negociacoes_paradas: parados };
}

async function atendimento() {
  const w = await negocios.executar('whatsapp_pendentes', {});
  if (w.erro) return w;
  const esperando = Array.isArray(w.aguardando_resposta) ? w.aguardando_resposta : [];
  const escalados = Array.isArray(w.escalados_para_humano) ? w.escalados_para_humano : [];
  return {
    esperando: esperando.length,
    escalados: escalados.length,
    pessoas: esperando.slice(0, 3).map((c) => ({ nome: limpar(c.nome) || c.telefone, ha_dias: c.ha_dias })),
    casos: escalados.slice(0, 3).map((c) => ({
      assunto: limpar([c.area_identificada, c.tipo_calculo].filter(Boolean).join(' · ')) || 'atendimento',
      valor: c.valor_pagamento ? Number(c.valor_pagamento) : null,
    })),
  };
}

/* ⚠️ O FINANCEIRO VEM DO PRÓPRIO FINANCEIRO (ação `caixa` do /api/jarvis
   dele): a mesma conta do dashboard, para o número da tela do Jarvis ser o
   que o Marlos encontra lá. Uma conta paralela aqui (pela data do
   lançamento) já mostrou R$ 324 mil de saída num mês de R$ 42 mil pagos. */
async function caixa(periodo) {
  if (!financeiroApp || !financeiroApp.configurado()) return { erro: 'Financeiro sem FINANCEIRO_APP_URL/JARVIS_FINANCEIRO_KEY' };
  const d = await financeiroApp.chamar('caixa', { de: periodo.de, ate: periodo.ate });
  if (d.erro) throw new Error(d.erro);
  return d;
}

async function financeiro(periodo, cx) {
  if (cx.erro) return cx;
  const hoje = ymdSP(new Date());
  // a série vai do início ao fim do período (ou até hoje), um ponto por dia
  const fim = periodo.ate < hoje ? periodo.ate : hoje;
  const porDia = Object.fromEntries((cx.por_dia || []).map((d) => [d.data, d]));
  const serie = [];
  for (let t = new Date(periodo.de + 'T12:00:00'); ymdSP(t) <= fim && serie.length < 92; t = new Date(t.getTime() + 86400000)) {
    const d = ymdSP(t);
    serie.push({ data: d, receitas: r0((porDia[d] || {}).receitas) });
  }
  const hojeCx = porDia[hoje] || { receitas: 0, despesas: 0 };
  return {
    periodo: cx.periodo,
    tudo: cx.tudo, empresas: cx.empresas || null, pessoal: cx.pessoal || null,
    hoje: { receitas: r0(hojeCx.receitas), despesas: r0(hojeCx.despesas) },
    serie,
    por_empresa: (cx.por_empresa || []).filter((e) => e.receitas > 0).slice(0, 3),
  };
}

function contas(cx) {
  if (cx.erro) return cx;
  const c = cx.contas || {};
  const hoje = ymdSP(new Date());
  const diasDe = (v) => Math.max(0, Math.round((new Date(hoje + 'T12:00:00') - new Date(String(v).slice(0, 10) + 'T12:00:00')) / 86400000));
  const itens = (b) => ((b && b.itens) || []).map((x) => ({ descricao: limpar(x.descricao), empresa: x.empresa, valor: r2(x.valor), vencimento: x.vencimento, dias_atraso: diasDe(x.vencimento) }));
  return {
    atraso: { qtd: (c.vencidas || {}).qtd || 0, total: (c.vencidas || {}).total || 0, itens: itens(c.vencidas).slice(0, 3) },
    hoje: { qtd: (c.vencem_hoje || {}).qtd || 0, total: (c.vencem_hoje || {}).total || 0, itens: itens(c.vencem_hoje).slice(0, 3) },
    semana: { qtd: (c.a_vencer_7d || {}).qtd || 0, total: (c.a_vencer_7d || {}).total || 0 },
    a_pagar_7d: c.a_pagar_7d || 0, a_receber_7d: c.a_receber_7d || 0,
  };
}

async function trafego(periodo) {
  const hoje = ymdSP(new Date());
  const ate = periodo.ate < hoje ? periodo.ate : hoje;
  const metaFn = trafegoMeta && trafegoMeta.disponivel() && ferramenta(trafegoMeta.FERRAMENTAS, 'trafego_meta');
  const nexusFn = panoramas && ferramenta(panoramas.FERRAMENTAS, 'nexus_panorama');
  // o panorama do Nexus conta dias até hoje: período que termina antes de hoje não cabe nele
  const diasNexus = ate === hoje ? Math.round((new Date(hoje + 'T12:00:00') - new Date(periodo.de + 'T12:00:00')) / 86400000) + 1 : null;
  const [meta, google, nexus] = await Promise.all([
    metaFn ? tentar(() => metaFn({ de: periodo.de, ate })) : { erro: 'Meta sem JARVIS_NEXUS_KEY' },
    googleAds && googleAds.disponivel() ? tentar(() => googleAds.desempenho({ nivel: 'campanha', de: periodo.de, ate })) : { erro: 'Google Ads não conectado' },
    !nexusFn ? { erro: 'Nexus não configurado' } : diasNexus ? tentar(() => nexusFn({ dias: diasNexus })) : { erro: 'vendas do Nexus só para períodos até hoje' },
  ]);
  let m = { erro: meta.erro };
  if (!meta.erro) {
    const camps = meta.campanhas || [];
    const soma = (k) => camps.reduce((s, c) => s + Number(c[k] || 0), 0);
    const gasto = soma('gasto'), compras = soma('compras'), receita = soma('receita'), cliques = soma('cliques'), impressoes = soma('impressoes');
    const orcamento = camps.filter((c) => c.rodando).reduce((s, c) => s + Number(c.orcamentoDia || 0), 0);
    m = {
      gasto: r2(gasto), orcamento: r2(orcamento), pct_orcamento: orcamento ? r0((gasto / orcamento) * 100) : null,
      compras, receita: r2(receita), cliques, ctr: impressoes ? r2((cliques / impressoes) * 100) : 0,
      cpa: compras ? r2(gasto / compras) : null, roas: gasto && receita ? r2(receita / gasto) : null,
      rodando: camps.filter((c) => c.rodando).length, checkouts: soma('inicioCheckout'),
    };
  }
  let g = { erro: google.erro };
  if (!google.erro) {
    const contas = (google.contas || []).filter((c) => c.total);
    const soma = (k) => contas.reduce((s, c) => s + Number(c.total[k] || 0), 0);
    const cliques = soma('cliques'), impressoes = soma('impressoes');
    g = { gasto: r2(soma('gasto')), cliques, conversoes: r2(soma('conversoes')), ctr: impressoes ? r2((cliques / impressoes) * 100) : 0, contas: contas.length };
  }
  const n = nexus.erro ? { erro: nexus.erro } : {
    vendas: Number((nexus.vendas && nexus.vendas.novos_pagantes) || 0),
    checkouts_pagos: Number((nexus.checkout && nexus.checkout.pagos) || 0),
    checkouts_iniciados: Number((nexus.checkout && nexus.checkout.iniciados) || 0),
    abandonados: Number((nexus.checkout && nexus.checkout.abandonados) || 0),
  };
  return { meta: m, google: g, nexus: n };
}

async function alertas() {
  if (!vigia) return { erro: 'vigia fora do deploy' };
  const { alertas: lista, falhas } = await vigia.avaliar();
  return {
    itens: lista.slice(0, 4).map((a) => ({ titulo: limpar(a.titulo), urgente: a.severidade === vigia.SEV.URGENTE })),
    total: lista.length, falhas,
  };
}

async function atender(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    const { acao, id } = req.body || {};
    if (!['concluir', 'reabrir'].includes(acao) || !id) { res.statusCode = 400; return res.end(JSON.stringify({ erro: 'acao ou id inválido' })); }
    if (!tarefasPessoais) { res.statusCode = 503; return res.end(JSON.stringify({ erro: 'tarefas fora do deploy' })); }
    const atual = ferramenta(tarefasPessoais.FERRAMENTAS, 'tarefa_atualizar');
    return res.end(JSON.stringify(await tentar(() => atual({ id, acao }))));
  }

  // o período de financeiro e tráfego: o mês corrente, ou o que a tela pedir
  const q = new URLSearchParams(String(req.url || '').split('?')[1] || '');
  const valida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  const hoje = ymdSP(new Date());
  const fimMes = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const periodo = {
    de: valida(q.get('de')) ? q.get('de') : hoje.slice(0, 8) + '01',
    ate: valida(q.get('ate')) ? q.get('ate') : fimMes,
  };
  if (periodo.ate < periodo.de) periodo.ate = periodo.de;

  const cx = await tentar(() => caixa(periodo));
  const fontes = {
    tarefas, agenda, atendimento, alertas,
    financeiro: () => financeiro(periodo, cx),
    contas: () => contas(cx),
    trafego: () => trafego(periodo),
  };
  const nomes = Object.keys(fontes);
  const resultados = await Promise.all(nomes.map((n) => tentar(fontes[n])));
  const corpo = { agora: new Date().toISOString(), periodo };
  nomes.forEach((n, i) => { corpo[n] = resultados[i]; });
  res.end(JSON.stringify(corpo));
}

const { comSessao } = require('../lib/sessao');
module.exports = comSessao(atender);
