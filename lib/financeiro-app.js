/* ══════════════════════════════════════════════════════
   O FINANCEIRO PELA PORTA DELE (17/10/2026)

   Conferência dos lançamentos automáticos (Asaas, Conta Simples, Opera),
   regras por favorecido e cadastros (categoria, produto, centro). Tudo por
   POST /api/jarvis do Financeiro (repositório grupo-mh-financeiro), que
   aplica as MESMAS regras da tela. O Jarvis não escreve no banco do
   Financeiro para nada disso: a regra de cada operação mora lá, num lugar só.

   Leitura é direta. Escrita propõe e espera confirmação (lib/acoes.js).
   ══════════════════════════════════════════════════════ */
const acoes = require('./acoes');

const URL_APP = () => (process.env.FINANCEIRO_APP_URL || '').replace(/\/+$/, '');
const configurado = () => !!(URL_APP() && process.env.JARVIS_FINANCEIRO_KEY);

async function chamar(acao, corpo = {}) {
  const r = await fetch(`${URL_APP()}/api/jarvis`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jarvis-key': process.env.JARVIS_FINANCEIRO_KEY },
    body: JSON.stringify({ acao, ...corpo }),
  });
  const d = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
  if (!r.ok && !d.erro) d.erro = `Financeiro respondeu ${r.status}`;
  return d;
}

const reais = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const linha = (c) => [c.empresa, c.centro, c.categoria, c.produto].filter(Boolean).join(' / ');

/* Os executores: o que roda depois do "sim". */
acoes.registrar('financeiro_classificar', (e) => chamar('classificar', { itens: e.itens }));
acoes.registrar('financeiro_ensinar_regra', (e) => chamar('regra', e));
acoes.registrar('financeiro_descartar', (e) => chamar('descartar', { id: e.id }));
acoes.registrar('financeiro_criar_cadastro', (e) => chamar(`criar_${e.oque}`, e));

const classif = {
  type: 'object',
  properties: {
    empresa: { type: 'string', description: 'Ex.: Pró-Labore, MH Cálculos, Peritos Academy, Ecossistema Nexus' },
    centro: { type: 'string', description: 'Centro de custo. Opcional.' },
    categoria: { type: 'string' },
    produto: { type: 'string', description: 'Opcional, mas pertence à categoria.' },
  },
};

const FERRAMENTAS = [
  {
    def: {
      name: 'financeiro_conferencia',
      description: 'Lançamentos automáticos (Asaas, Conta Simples, Opera) esperando o Marlos dizer empresa, centro, categoria e produto. Traz favorecido, valor, data e uma SUGESTÃO quando há regra ou classificação anterior do mesmo favorecido. Use para "o que tem para conferir?".',
      input_schema: { type: 'object', properties: {} },
    },
    // `total` é a contagem exata; o modelo tendia a supor que a lista tinha sido cortada.
    run: async () => ({ ...(await chamar('pendentes')), nota: 'total é a contagem exata de pendentes, a lista não foi cortada' }),
  },
  {
    def: {
      name: 'financeiro_opcoes',
      description: 'Empresas, centros de custo, categorias e produtos cadastrados no Financeiro. Consulte antes de classificar quando não tiver certeza do nome exato.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => chamar('opcoes'),
  },
  {
    def: {
      name: 'financeiro_classificar',
      description: 'PROPÕE classificar um ou mais lançamentos da conferência e marcá-los como conferidos. Por padrão também ensina a regra do favorecido (os próximos entram sozinhos); lembrar=false para "só desta vez". Não grava: devolve um resumo para confirmar.',
      input_schema: {
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            items: { ...classif, properties: { id: { type: 'string' }, favorecido: { type: 'string', description: 'Para o resumo.' }, valor: { type: 'number', description: 'Para o resumo.' }, lembrar: { type: 'boolean' }, ...classif.properties }, required: ['id', 'empresa', 'categoria'] },
          },
        },
        required: ['itens'],
      },
    },
    run: (i, ctx) => acoes.propor('financeiro_classificar', i,
      (i.itens || []).map(x => `${x.favorecido || 'lançamento'}${x.valor ? ` (${reais(x.valor)})` : ''} → ${linha(x)}${x.lembrar === false ? ', só desta vez' : ', e lembrar para os próximos'}`).join('; '), ctx),
  },
  {
    def: {
      name: 'financeiro_ensinar_regra',
      description: 'PROPÕE uma regra: "toda vez que vier <favorecido>, é <empresa/centro/categoria/produto>". Também resolve o que já está pendente desse favorecido. Use o nome do favorecido como aparece na conferência.',
      input_schema: { type: 'object', properties: { favorecido: { type: 'string' }, tipo: { type: 'string', enum: ['Despesa', 'Receita'] }, ...classif.properties }, required: ['favorecido', 'empresa', 'categoria'] },
    },
    run: (i, ctx) => acoes.propor('financeiro_ensinar_regra', i, `Regra: todo ${i.tipo || 'Despesa'} de ${i.favorecido} → ${linha(i)}`, ctx),
  },
  {
    def: {
      name: 'financeiro_descartar',
      description: 'PROPÕE descartar um lançamento da conferência (duplicado, ou que não deveria existir). Só vale para pendente.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, motivo: { type: 'string' }, favorecido: { type: 'string' }, valor: { type: 'number' } }, required: ['id'] },
    },
    run: (i, ctx) => acoes.propor('financeiro_descartar', i, `Descartar ${i.favorecido || 'lançamento'}${i.valor ? ` de ${reais(i.valor)}` : ''}${i.motivo ? ` (${i.motivo})` : ''}`, ctx),
  },
  {
    def: {
      name: 'financeiro_criar_cadastro',
      description: 'PROPÕE criar uma categoria, um produto (dentro de uma categoria) ou um centro de custo no Financeiro.',
      input_schema: {
        type: 'object',
        properties: {
          oque: { type: 'string', enum: ['categoria', 'produto', 'centro'] },
          nome: { type: 'string' },
          tipo: { type: 'string', enum: ['Despesa', 'Receita'], description: 'Para categoria e centro.' },
          categoria: { type: 'string', description: 'Obrigatório para produto.' },
        },
        required: ['oque', 'nome'],
      },
    },
    run: (i, ctx) => acoes.propor('financeiro_criar_cadastro', i,
      i.oque === 'produto' ? `Criar o produto "${i.nome}" na categoria ${i.categoria}` : `Criar ${i.oque === 'centro' ? 'o centro de custo' : 'a categoria'} "${i.nome}" (${i.tipo || 'Despesa'})`, ctx),
  },
];

module.exports = { FERRAMENTAS, configurado };
