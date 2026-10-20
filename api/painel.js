/* NEXUS → painel: o que fica em volta do núcleo na tela (20/10/2026).

   O HUD mostra o dia sem precisar perguntar: tarefas, agenda, quem espera
   resposta, o dinheiro de hoje, o tráfego de hoje e os alertas do vigia.
   A tela pede isto ao abrir, a cada 2 minutos e depois de cada resposta.

   ⚠️ CADA PAINEL É ISOLADO. Fonte que falhou volta `{ erro }` e o painel diz
   "não consegui verificar", nunca zero. É a mesma regra do bom dia: ausência
   de medição não é medição de zero.

   POST { acao: 'concluir' | 'reabrir', id } marca uma tarefa pelo check da
   tela, sem passar pelo modelo.

   Só o dono (lib/sessao.js).                                               */

const negocios = require('../lib/negocios');

const ymdSP = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

async function tentar(fn) {
  try { return await fn(); }
  catch (e) { return { erro: String(e.message || e) }; }
}
const carregar = (m) => { try { return require(m); } catch { return null; } };

async function tarefas() {
  const t = carregar('../lib/tarefas-pessoais');
  if (!t || !t.disponivel()) return { erro: 'não configurado' };
  const [hoje, feitas] = await Promise.all([t.deHoje(), t.feitasHoje()]);
  return { itens: [...hoje, ...feitas].slice(0, 8) };
}

async function agenda() {
  const ag = await negocios.executar('agenda_prazos', { dias: 2 });
  if (ag.erro) return ag;
  const hoje = ymdSP(new Date());
  const itens = [...(ag.compromissos_marcados || []), ...(ag.prazos_de_processo || [])]
    .filter((e) => e.data_evento)
    .map((e) => ({
      titulo: e.titulo, tipo: String(e.tipo || '').replace(/_/g, ' '),
      quando: String(e.data_evento), hoje: String(e.data_evento).slice(0, 10) === hoje,
      critico: ['prazo_fatal', 'audiencia', 'entrega_laudo', 'prazo_processo'].includes(e.tipo),
      local: e.local || null,
    }))
    .sort((a, b) => a.quando.localeCompare(b.quando));
  return { itens: itens.slice(0, 5), total: itens.length };
}

async function whatsapp() {
  const w = await negocios.executar('whatsapp_pendentes', {});
  if (w.erro) return w;
  const lista = Array.isArray(w.aguardando_resposta) ? w.aguardando_resposta : [];
  return {
    total: lista.length,
    escalados: Array.isArray(w.escalados_para_humano) ? w.escalados_para_humano.length : 0,
    itens: lista.slice(0, 3).map((c) => ({ nome: c.nome || c.telefone, ha_dias: c.ha_dias, nao_lidas: c.nao_lidas })),
  };
}

async function dinheiro() {
  const hoje = ymdSP(new Date());
  const m = await negocios.executar('financeiro_movimentacoes', { de: hoje, ate: hoje, limit: 40 });
  if (m.erro) return m;
  const porEmpresa = {};
  for (const i of m.itens || []) {
    if (i.tipo !== 'Receita') continue;
    porEmpresa[i.empresa || 'Outros'] = (porEmpresa[i.empresa || 'Outros'] || 0) + Number(i.valor || 0);
  }
  return {
    receitas: Number(m.total_receitas || 0), despesas: Number(m.total_despesas || 0),
    por_empresa: Object.entries(porEmpresa).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([empresa, valor]) => ({ empresa, valor })),
  };
}

async function trafego() {
  const hoje = ymdSP(new Date());
  const t = carregar('../lib/trafego');
  const g = carregar('../lib/google-ads');
  const metaFn = t && t.disponivel() && (t.FERRAMENTAS.find((f) => f.def.name === 'trafego_meta') || {}).run;
  const [meta, google] = await Promise.all([
    metaFn ? tentar(() => metaFn({ de: hoje, ate: hoje })) : { erro: 'não configurado' },
    g && g.disponivel() ? tentar(() => g.desempenho({ nivel: 'campanha', de: hoje, ate: hoje })) : { erro: 'não configurado' },
  ]);
  const somaMeta = (k) => (meta.campanhas || []).reduce((s, c) => s + Number(c[k] || 0), 0);
  return {
    meta: meta.erro ? { erro: meta.erro } : { gasto: somaMeta('gasto'), compras: somaMeta('compras'), cliques: somaMeta('cliques') },
    google: google.erro ? { erro: google.erro } : {
      gasto: (google.contas || []).reduce((s, c) => s + Number((c.total && c.total.gasto) || 0), 0),
      cliques: (google.contas || []).reduce((s, c) => s + Number((c.total && c.total.cliques) || 0), 0),
    },
  };
}

async function alertas() {
  const v = carregar('../lib/vigia');
  if (!v) return { erro: 'não configurado' };
  const { alertas: lista, falhas } = await v.avaliar();
  return {
    itens: lista.slice(0, 4).map((a) => ({ titulo: a.titulo, urgente: a.severidade === v.SEV.URGENTE })),
    total: lista.length, falhas,
  };
}

async function atender(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    const { acao, id } = req.body || {};
    if (!['concluir', 'reabrir'].includes(acao) || !id) { res.statusCode = 400; return res.end(JSON.stringify({ erro: 'acao ou id inválido' })); }
    const t = carregar('../lib/tarefas-pessoais');
    const atual = t.FERRAMENTAS.find((f) => f.def.name === 'tarefa_atualizar');
    return res.end(JSON.stringify(await tentar(() => atual.run({ id, acao }))));
  }

  const nomes = ['tarefas', 'agenda', 'whatsapp', 'dinheiro', 'trafego', 'alertas'];
  const fns = [tarefas, agenda, whatsapp, dinheiro, trafego, alertas];
  const resultados = await Promise.all(fns.map((f) => tentar(f)));
  const corpo = { agora: new Date().toISOString() };
  nomes.forEach((n, i) => { corpo[n] = resultados[i]; });
  res.end(JSON.stringify(corpo));
}

const { comSessao } = require('../lib/sessao');
module.exports = comSessao(atender);
