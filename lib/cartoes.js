/* ══════════════════════════════════════════════════════
   CARTÕES NA TELA (19/10/2026)

   Pedido do dono: resposta com número não pode existir só na voz e numa
   legenda que some ("você precisa decorar o que ele falou"). Quando uma
   ferramenta devolve dado que se lê melhor em tabela (tráfego), ou propõe uma
   ação que espera o "sim", o servidor monta aqui um cartão e manda à tela
   junto da fala (evento `cartao` do fluxo; `cartoes` na resposta comum).

   O cartão é montado do RESULTADO da ferramenta, nunca do texto do modelo:
   o número na tela é o que a fonte devolveu.

   Formato: { tipo: 'tabela', titulo, subtitulo, colunas: [{ rotulo, num }],
   grupos: [{ titulo, linhas: [[...]] }], nota }
   ou       { tipo: 'confirmar', acao_id, resumo }.
   ══════════════════════════════════════════════════════ */

const reais = (v) => (v == null ? '—' : `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const inteiro = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const pct = (v) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const dec = (v) => (v == null || v === 0 ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const dataBR = (s) => (s ? String(s).split('-').reverse().slice(0, 2).join('/') : '');
const periodo = (p) => (p && (p.de || p.since) ? `${dataBR(p.de || p.since)} a ${dataBR(p.ate || p.until)}` : '');
const MAX_LINHAS = 15;

function tabela(titulo, subtitulo, colunas, grupos, nota) {
  const g = grupos.map(x => ({ ...x, linhas: x.linhas.slice(0, MAX_LINHAS) })).filter(x => x.linhas.length);
  if (!g.length) return null;
  return { tipo: 'tabela', titulo, subtitulo, colunas, grupos: g, nota };
}

const C = (rotulo, num = true) => ({ rotulo, num });

function doGoogle(i, d) {
  if (!d || d.erro || !Array.isArray(d.contas)) return null;
  const nivel = d.nivel || 'campanha';
  const nomes = { campanha: 'campanhas', grupo: 'grupos', anuncio: 'anuncios', palavra: 'palavras', termo: 'termos' };
  const lista = (conta) => conta[nomes[nivel]] || [];
  let colunas, linha;
  if (nivel === 'campanha') {
    colunas = [C('Campanha', false), C('Status', false), C('Orç./dia'), C('Gasto'), C('Cliques'), C('CPC')];
    linha = (x) => [x.nome, x.status, x.orcamentoDia != null ? reais(x.orcamentoDia) : '—', reais(x.gasto), inteiro(x.cliques), reais(x.cpc)];
  } else if (nivel === 'palavra' || nivel === 'termo') {
    colunas = [C(nivel === 'termo' ? 'Termo pesquisado' : 'Palavra-chave', false), C('Campanha', false), C('Gasto'), C('Cliques'), C('CPC'), C('Conv.')];
    linha = (x) => [x.termo || x.palavra, x.campanha, reais(x.gasto), inteiro(x.cliques), reais(x.cpc), dec(x.conversoes)];
  } else {
    colunas = [C(nivel === 'grupo' ? 'Grupo de anúncios' : 'Anúncio', false), C('Campanha', false), C('Gasto'), C('Cliques'), C('CTR'), C('CPC')];
    linha = (x) => [x.nome, x.campanha, reais(x.gasto), inteiro(x.cliques), pct(x.ctr), reais(x.cpc)];
  }
  const grupos = d.contas.map(conta => ({
    titulo: conta.erro ? `${conta.conta}: não consegui ler (${conta.erro})` : conta.conta,
    linhas: conta.erro ? [] : lista(conta).map(linha),
  }));
  const rotulo = { campanha: 'campanhas', grupo: 'grupos de anúncios', anuncio: 'anúncios', palavra: 'palavras-chave', termo: 'termos de pesquisa' }[nivel];
  return tabela(`Google Ads · ${rotulo}`, periodo(d.periodo), colunas, grupos,
    'Conversões do Google ainda não são confiáveis. Venda real: Nexus.');
}

function doMeta(i, d) {
  if (!d || d.erro) return null;
  const sub = periodo(d.periodo);
  if (Array.isArray(d.fatias)) {
    const nome = { posicionamento: 'posicionamento', idade: 'idade', genero: 'gênero', horario: 'horário' }[d.quebra] || d.quebra;
    return tabela(`Meta · por ${nome}`, sub,
      [C(nome[0].toUpperCase() + nome.slice(1), false), C('Gasto'), C('Cliques'), C('CTR'), C('CPC'), C('Compras')],
      [{ titulo: '', linhas: d.fatias.map(x => [String(x.fatia).replace(/_/g, ' '), reais(x.gasto), inteiro(x.cliques), pct(x.ctr), reais(x.cpc), inteiro(x.compras)]) }],
      'Números do pixel do Meta.');
  }
  const chave = ['conjuntos', 'anuncios', 'campanhas'].find(k => Array.isArray(d[k]));
  if (!chave) return null;
  const titulo = { campanhas: 'campanhas', conjuntos: 'conjuntos', anuncios: 'anúncios' }[chave];
  const comOrc = chave !== 'anuncios';
  const colunas = [C(titulo[0].toUpperCase() + titulo.slice(1), false), C('Status', false), ...(comOrc ? [C('Orç./dia')] : []),
    C('Gasto'), C('Cliques'), C('CTR'), C('CPC'), C('Freq.'), C('Compras')];
  const linhas = d[chave].map(x => [x.nome, x.rodando ? 'Ativa' : 'Pausada', ...(comOrc ? [x.orcamentoDia != null ? reais(x.orcamentoDia) : '—'] : []),
    reais(x.gasto), inteiro(x.cliques), pct(x.ctr), reais(x.cpc), dec(x.frequencia), inteiro(x.compras)]);
  return tabela(`Meta · ${titulo}`, sub, colunas, [{ titulo: '', linhas }], 'Números do pixel do Meta. Venda real: Nexus.');
}

/* O relatório da MH (19/10/2026): na voz só o destaque, na tela os nomes. */
function doMh(i, d) {
  if (!d || d.erro) return null;
  const op = d.orcamentos_parados || {}, docs = d.esperando_documentos || {}, f = d.fechados || {}, ag = d.agente || {}, r = d.regua_do_orcamento || {};
  const grupos = [
    { titulo: `Orçamentos parados: ${inteiro(op.quantos)} (${reais(op.valor)})`,
      linhas: (op.lista || []).map(x => [x.quem, `${x.dias} dias`, x.valor != null ? reais(x.valor) : '—', x.canal === 'email' ? 'e-mail' : 'WhatsApp']) },
    { titulo: `Esperando documento: ${inteiro(docs.quantos)}`,
      linhas: (docs.lista || []).map(x => [x.quem, `${x.dias} dias`, '', '']) },
    { titulo: 'Fechados', linhas: [
      ['Ontem', inteiro(f.ontem), reais(f.valor_ontem), ''],
      ['Últimos 7 dias', inteiro(f.ultimos_7_dias), reais(f.valor_7_dias), ''],
      ['No mês', inteiro(f.no_mes), reais(f.valor_no_mes), ''],
    ] },
    { titulo: 'Agente da MH e régua do orçamento', linhas: [
      ['Pessoas que escreveram ontem', inteiro(ag.pessoas_ontem), '', ''],
      ['Contatos novos ontem', inteiro(ag.contatos_novos_ontem), '', ''],
      ['Esperando você agora', inteiro(ag.esperando_voce_agora), '', ''],
      ['Toques de orçamento hoje', `${inteiro(r.whatsapp_hoje)} WhatsApp`, `${inteiro(r.email_hoje)} e-mail`, ''],
      ['Responderam em 7 dias', inteiro(r.responderam_7_dias), `de ${inteiro(r.enviados_7_dias)} toques`, ''],
    ] },
  ];
  return tabela('MH Cálculos · comercial', '', [C('', false), C(''), C(''), C('', false)], grupos, '');
}

const POR_FERRAMENTA = { trafego_google: doGoogle, trafego_meta: doMeta, mh_comercial: doMh };

/** O cartão para o resultado desta ferramenta, ou null. Nunca lança. */
function cartaoDe(nome, input, saida) {
  try {
    if (saida && saida.acao_id && saida.resumo) return { tipo: 'confirmar', acao_id: saida.acao_id, resumo: saida.resumo };
    const f = POR_FERRAMENTA[nome];
    return f ? f(input || {}, saida) : null;
  } catch (e) {
    console.warn('[nexus] cartão não montado:', nome, e.message);
    return null;
  }
}

module.exports = { cartaoDe };
