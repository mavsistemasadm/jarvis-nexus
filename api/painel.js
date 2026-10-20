/* NEXUS → painel: o que fica em volta do núcleo na tela (20/10/2026).

   O HUD mostra o dia sem precisar perguntar: tarefas, agenda, atendimento,
   alertas, o financeiro (hoje, 14 dias, meta do mês), as contas (atrasadas e
   a vencer) e o tráfego (Meta, Google e as vendas reais do Nexus). A tela
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

async function financeiro() {
  const hoje = ymdSP(new Date());
  const ini = ymdSP(new Date(Date.now() - 13 * 86400000));
  const [dias, mes] = await Promise.all([
    negocios.financeiro.porDia(ini, hoje),
    tentar(() => negocios.financeiro.resumo()),
  ]);
  const serie = [];
  for (let i = 13; i >= 0; i--) {
    const d = ymdSP(new Date(Date.now() - i * 86400000));
    serie.push({ data: d, receitas: r0((dias[d] || {}).receitas) });
  }
  const hojeTot = dias[hoje] || { receitas: 0, despesas: 0 };
  const media = serie.slice(0, 13).reduce((s, x) => s + x.receitas, 0) / 13;
  const metas = !mes.erro && Array.isArray(mes.meta)
    ? mes.meta.filter((m) => Number(m.meta) > 0).map((m) => ({ empresa: m.empresa, faturado: r0(m.faturado), meta: r0(m.meta), pct: r0(m.percentual) }))
    : [];
  const empresas = !mes.erro && Array.isArray(mes.por_empresa)
    ? mes.por_empresa.filter((e) => Number(e.receitas) > 0).sort((a, b) => b.receitas - a.receitas).slice(0, 3)
      .map((e) => ({ empresa: e.empresa, receitas: r0(e.receitas) }))
    : [];
  return {
    hoje: { receitas: r0(hojeTot.receitas), despesas: r0(hojeTot.despesas) },
    vs_media: media > 0 ? r0(((hojeTot.receitas - media) / media) * 100) : null,
    serie, metas, empresas,
    mes: !mes.erro && Array.isArray(mes.por_empresa) ? {
      receitas: r0(mes.por_empresa.reduce((s, e) => s + Number(e.receitas || 0), 0)),
      despesas: r0(mes.por_empresa.reduce((s, e) => s + Number(e.despesas || 0), 0)),
    } : null,
  };
}

async function contas() {
  const hoje = ymdSP(new Date());
  const [atraso, avencer] = await Promise.all([
    negocios.executar('financeiro_contas', { tipo: 'em_atraso' }),
    negocios.executar('financeiro_contas', { tipo: 'a_vencer', dias: 7 }),
  ]);
  if (atraso.erro && avencer.erro) return { erro: atraso.erro };
  // dias_atraso do banco vem 0 mesmo vencida: a conta é feita aqui
  const diasDe = (v) => Math.round((new Date(hoje + 'T12:00:00') - new Date(String(v).slice(0, 10) + 'T12:00:00')) / 86400000);
  const lista = (l) => (Array.isArray(l) ? l : []).map((c) => ({ descricao: limpar(c.descricao), empresa: c.empresa, valor: r2(c.valor), vencimento: c.vencimento, dias_atraso: Math.max(0, diasDe(c.vencimento)) }));
  const atrasadas = lista(atraso.em_atraso).sort((a, b) => b.valor - a.valor);
  const proximas = lista(avencer.contas).sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  const deHoje = proximas.filter((c) => String(c.vencimento).slice(0, 10) === hoje);
  const soma = (l) => r2(l.reduce((s, c) => s + c.valor, 0));
  return {
    atraso: atraso.erro ? { erro: atraso.erro } : { qtd: atrasadas.length, total: soma(atrasadas), itens: atrasadas.slice(0, 3) },
    hoje: { qtd: deHoje.length, total: soma(deHoje), itens: deHoje.slice(0, 3) },
    semana: avencer.erro ? { erro: avencer.erro } : { qtd: proximas.length, total: soma(proximas), itens: proximas.filter((c) => !deHoje.includes(c)).slice(0, 2) },
  };
}

async function trafego() {
  const hoje = ymdSP(new Date());
  const metaFn = trafegoMeta && trafegoMeta.disponivel() && ferramenta(trafegoMeta.FERRAMENTAS, 'trafego_meta');
  const nexusFn = panoramas && ferramenta(panoramas.FERRAMENTAS, 'nexus_panorama');
  const [meta, google, nexus] = await Promise.all([
    metaFn ? tentar(() => metaFn({ de: hoje, ate: hoje })) : { erro: 'Meta sem JARVIS_NEXUS_KEY' },
    googleAds && googleAds.disponivel() ? tentar(() => googleAds.desempenho({ nivel: 'campanha', de: hoje, ate: hoje })) : { erro: 'Google Ads não conectado' },
    nexusFn ? tentar(() => nexusFn({ dias: 1 })) : { erro: 'Nexus não configurado' },
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

  const fontes = { tarefas, agenda, atendimento, financeiro, contas, trafego, alertas };
  const nomes = Object.keys(fontes);
  const resultados = await Promise.all(nomes.map((n) => tentar(fontes[n])));
  const corpo = { agora: new Date().toISOString() };
  nomes.forEach((n, i) => { corpo[n] = resultados[i]; });
  res.end(JSON.stringify(corpo));
}

const { comSessao } = require('../lib/sessao');
module.exports = comSessao(atender);
