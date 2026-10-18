/* ══════════════════════════════════════════════════════
   O FINANCEIRO PELA PORTA DELE (17/10/2026)

   Conferência dos lançamentos automáticos (Asaas, Conta Simples, Opera),
   regras por favorecido e cadastros (categoria, produto, centro). Tudo por
   POST /api/jarvis do Financeiro (repositório grupo-mh-financeiro), que
   aplica as MESMAS regras da tela. O Jarvis não escreve no banco do
   Financeiro para nada disso: a regra de cada operação mora lá, num lugar só.

   Leitura é direta. Escrita propõe e espera confirmação (lib/acoes.js).

   MEMÓRIAS (18/10/2026): o que antes se chamava "regra". "Quando vier deste
   favorecido, classifique assim", com dois modos: concluir (entra conferido)
   ou sugerir (entra preenchido e espera o "confirma"). O Marlos vê e edita as
   mesmas memórias na tela Conferência → Memórias do Financeiro.
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
acoes.registrar('financeiro_editar_memoria', (e) => chamar('memoria_editar', e));
acoes.registrar('financeiro_apagar_memoria', (e) => chamar('memoria_apagar', { id: e.id }));
acoes.registrar('financeiro_criar_cadastro', (e) => chamar(`criar_${e.oque}`, e));

const MODO = { type: 'string', enum: ['concluir', 'sugerir'], description: 'concluir: os próximos entram classificados e conferidos. sugerir: entram preenchidos e esperam o Marlos confirmar (use quando o mesmo favorecido tem usos diferentes, ou quando ele disser "lembra mas me pergunta").' };
const COND = {
  comparacao: { type: 'string', enum: ['igual', 'contem'], description: 'igual (padrão): o nome do favorecido. contem: qualquer favorecido que tenha essa palavra, ex. "BISTEK".' },
  valor_min: { type: 'number', description: 'Opcional: só vale a partir deste valor.' },
  valor_max: { type: 'number', description: 'Opcional: só vale até este valor.' },
};
const modoTxt = (m) => (m === 'sugerir' ? 'sugerir e esperar seu ok' : 'concluir sozinho');
const condTxt = (i) => [
  i.comparacao === 'contem' ? `qualquer nome com "${i.favorecido}"` : null,
  i.valor_min != null ? `a partir de ${reais(i.valor_min)}` : null,
  i.valor_max != null ? `até ${reais(i.valor_max)}` : null,
].filter(Boolean).join(', ');

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
      description: 'Lançamentos automáticos (Asaas, Conta Simples, Opera) esperando o Marlos dizer empresa, centro, categoria e produto. Traz favorecido, valor, data e uma SUGESTÃO quando há memória ou classificação anterior do mesmo favorecido. ja_preenchido=true: uma memória no modo sugerir já preencheu, basta ele confirmar (classificar com a mesma sugestão). Use para "o que tem para conferir?".',
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
      description: 'PROPÕE classificar um ou mais lançamentos da conferência e marcá-los como conferidos. Por padrão também grava a memória do favorecido (os próximos entram sozinhos): lembrar="concluir" (padrão), lembrar="sugerir" para "lembra, mas me pergunta", lembrar=false para "só desta vez". Não grava: devolve um resumo para confirmar.',
      input_schema: {
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            items: { ...classif, properties: { id: { type: 'string' }, favorecido: { type: 'string', description: 'Para o resumo.' }, valor: { type: 'number', description: 'Para o resumo.' }, lembrar: { description: '"concluir" (padrão), "sugerir" ou false', anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['concluir', 'sugerir'] }] }, ...classif.properties }, required: ['id', 'empresa', 'categoria'] },
          },
        },
        required: ['itens'],
      },
    },
    run: (i, ctx) => acoes.propor('financeiro_classificar', i,
      (i.itens || []).map(x => `${x.favorecido || 'lançamento'}${x.valor ? ` (${reais(x.valor)})` : ''} → ${linha(x)}${x.lembrar === false ? ', só desta vez' : x.lembrar === 'sugerir' ? ', e lembrar como sugestão' : ', e lembrar para os próximos'}`).join('; '), ctx),
  },
  {
    def: {
      name: 'financeiro_ensinar_regra',
      description: 'PROPÕE uma memória: "toda vez que vier <favorecido>, é <empresa/centro/categoria/produto>". Também resolve o que já está pendente desse favorecido. Use o nome do favorecido como aparece na conferência (o nome do banco, não a descrição). Para "lembra que Bistek é gasto pessoal": comparacao=contem, favorecido=BISTEK. Faixa de valor separa usos do mesmo favorecido (ex.: Bistek acima de 300 é pró-labore).',
      input_schema: { type: 'object', properties: { favorecido: { type: 'string' }, tipo: { type: 'string', enum: ['Despesa', 'Receita'] }, modo: MODO, ...COND, ...classif.properties }, required: ['favorecido', 'empresa', 'categoria'] },
    },
    run: (i, ctx) => acoes.propor('financeiro_ensinar_regra', i,
      `Memória: todo ${i.tipo || 'Despesa'} de ${i.favorecido}${condTxt(i) ? ` (${condTxt(i)})` : ''} → ${linha(i)}, ${modoTxt(i.modo)}`, ctx),
  },
  {
    def: {
      name: 'financeiro_memorias',
      description: 'As memórias de classificação do Financeiro: favorecido, como classifica, modo (concluir/sugerir), se está ativa, e quantas vezes já classificou. busca opcional (ex.: "bistek"). Use para "o que você lembra do Bistek?", "quais memórias eu tenho?".',
      input_schema: { type: 'object', properties: { busca: { type: 'string' } } },
    },
    run: (i) => chamar('memorias', { busca: i.busca || '' }),
  },
  {
    def: {
      name: 'financeiro_editar_memoria',
      description: 'PROPÕE mudar uma memória existente (o id vem de financeiro_memorias): classificação, modo, comparação, faixa de valor, ou pausar (ativa=false) e reativar. Só manda o que muda.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, favorecido: { type: 'string' }, tipo: { type: 'string', enum: ['Despesa', 'Receita'] }, modo: MODO, ativa: { type: 'boolean' }, ...COND, ...classif.properties }, required: ['id'] },
    },
    run: (i, ctx) => acoes.propor('financeiro_editar_memoria', i,
      `Mudar a memória ${i.favorecido || ''}: ${[linha(i), i.modo ? modoTxt(i.modo) : '', condTxt(i), i.ativa === false ? 'pausar' : i.ativa === true ? 'reativar' : ''].filter(Boolean).join(', ') || 'sem mudança'}`, ctx),
  },
  {
    def: {
      name: 'financeiro_apagar_memoria',
      description: 'PROPÕE apagar uma memória (o id vem de financeiro_memorias). Os lançamentos já classificados não mudam; os próximos desse favorecido voltam a cair em branco. Para parar só por um tempo, prefira editar com ativa=false.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, favorecido: { type: 'string' } }, required: ['id'] },
    },
    run: (i, ctx) => acoes.propor('financeiro_apagar_memoria', i, `Apagar a memória de ${i.favorecido || 'esse favorecido'}`, ctx),
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
