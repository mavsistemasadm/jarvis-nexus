/* ══════════════════════════════════════════════════════
   AÇÕES COM CONFIRMAÇÃO NO SERVIDOR (17/10/2026)

   Até aqui toda escrita do Jarvis dependia de o modelo escrever uma tag no
   meio da resposta DEPOIS de o dono dizer sim. Quem garantia o "sim" era o
   prompt. Agora quem garante é o servidor:

   1. A ferramenta de escrita NÃO escreve. Ela grava uma linha `pendente` em
      `acoes` (sql/acoes.sql) com o resumo do que vai acontecer, e devolve o
      resumo para o modelo ler em voz alta.
   2. Só `confirmar_acao` executa, e ela RECUSA:
      - ação criada na mesma requisição (entre propor e executar precisa
        existir uma fala do dono; sem isso o modelo propõe e se confirma
        sozinho na mesma volta);
      - última fala do dono que não seja um sim (ou que tenha um "não");
      - ação com mais de 15 minutos, ou que não esteja pendente.
   3. Tudo fica no diário: proposta, decisão e resultado.

   Cada módulo de escrita registra os seus executores com `registrar`.
   ══════════════════════════════════════════════════════ */
const db = require('./supabase');

const VALIDADE_MS = 15 * 60 * 1000;
const executores = {};

/** `nome` é a ferramenta que propõe; `executar(entrada)` é o que de fato grava. */
function registrar(nome, executar) { executores[nome] = executar; }

const SIM = /\b(sim|confirmo|confirma|confirmado|pode|podes|isso|ok|okay|manda|grava|lan[cç]a|beleza|certo|exato|positivo|fechado|perfeito|vai|claro|correto|t[aá] certo|t[aá] bom)\b/i;
// Sem "para": "pode lançar para mim" é um sim.
const NAO = /\b(n[aã]o|nao|cancela|cancelar|espera|errado|pera)\b/i;

/** A fala do dono responde sim? `null` quando não dá para saber. */
function ehSim(fala) {
  const t = String(fala || '').trim();
  if (!t) return false;
  if (NAO.test(t)) return false;
  return SIM.test(t);
}

function disponivel() { return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY); }

async function propor(ferramenta, entrada, resumo, ctx) {
  if (!disponivel()) return { erro: 'diário de ações indisponível (SUPABASE_URL do Jarvis)' };
  const [linha] = await db.insert('acoes', { ferramenta, entrada, resumo, origem: ctx.origem || 'tela' });
  if (!linha || !linha.id) return { erro: 'não consegui registrar a ação' };
  return {
    acao_id: linha.id,
    resumo,
    instrucao: 'NADA FOI GRAVADO AINDA. Leia o resumo para o Marlos e pergunte se confirma. '
      + 'Só chame confirmar_acao com este acao_id DEPOIS que ele responder que sim, na próxima fala dele.',
  };
}

async function confirmar(acaoId, ctx) {
  const [a] = await db.query('acoes', `id=eq.${encodeURIComponent(acaoId)}&limit=1`);
  if (!a) return { erro: 'ação não encontrada' };
  if (a.estado !== 'pendente') return { erro: `ação já está ${a.estado}` };
  const criada = new Date(a.criada_em).getTime();
  if (criada >= ctx.inicio) {
    return { erro: 'RECUSADO: esta ação foi proposta nesta mesma resposta. Leia o resumo e espere o Marlos responder.' };
  }
  if (Date.now() - criada > VALIDADE_MS) {
    await db.update('acoes', { id: a.id }, { estado: 'expirada', decidida_em: new Date().toISOString() });
    return { erro: 'ação expirou (mais de 15 minutos). Proponha de novo.' };
  }
  if (!ehSim(ctx.ultimaFala)) {
    return { erro: `RECUSADO: a última fala do Marlos ("${String(ctx.ultimaFala || '').slice(0, 80)}") não é uma confirmação. Pergunte de novo, ou cancele.` };
  }
  const executar = executores[a.ferramenta];
  if (!executar) return { erro: `sem executor para ${a.ferramenta}` };
  let resultado, estado = 'executada';
  try {
    resultado = await executar(a.entrada || {});
    if (resultado && resultado.erro) estado = 'falhou';
  } catch (e) {
    resultado = { erro: String(e.message || e) };
    estado = 'falhou';
  }
  await db.update('acoes', { id: a.id }, { estado, resultado, decidida_em: new Date().toISOString() });
  return { estado, resultado };
}

async function cancelar(acaoId) {
  await db.update('acoes', { id: acaoId }, { estado: 'cancelada', decidida_em: new Date().toISOString() });
  return { ok: true };
}

/* As pendentes dos últimos 15 minutos. Entram no contexto de toda fala: o
   histórico que a tela manda tem só texto, sem o resultado das ferramentas, e
   sem isto o "sim" da fala seguinte não saberia o que confirmar. */
async function pendentesRecentes() {
  if (!disponivel()) return [];
  const desde = new Date(Date.now() - VALIDADE_MS).toISOString();
  const linhas = await db.query('acoes', `estado=eq.pendente&criada_em=gte.${desde}&order=criada_em.desc&limit=10&select=id,resumo,criada_em`);
  return Array.isArray(linhas) ? linhas : [];
}

async function recentes(dias = 7) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const linhas = await db.query('acoes', `criada_em=gte.${desde}&estado=eq.executada&order=criada_em.desc&limit=50&select=ferramenta,resumo,criada_em`);
  return { dias, executadas: linhas };
}

const FERRAMENTAS = [
  {
    def: {
      name: 'confirmar_acao',
      description: 'Executa uma ação proposta antes (lançamento, classificação, regra, cadastro). Chame SÓ depois que o Marlos disser sim, na fala seguinte à proposta. O servidor recusa se ele não confirmou.',
      input_schema: { type: 'object', properties: { acao_id: { type: 'string' } }, required: ['acao_id'] },
    },
    run: (i, ctx) => confirmar(i.acao_id, ctx),
  },
  {
    def: {
      name: 'cancelar_acao',
      description: 'Descarta uma ação proposta que o Marlos não quis.',
      input_schema: { type: 'object', properties: { acao_id: { type: 'string' } }, required: ['acao_id'] },
    },
    run: (i) => cancelar(i.acao_id),
  },
  {
    def: {
      name: 'acoes_recentes',
      description: 'O diário do Jarvis: o que ele gravou nos últimos dias (lançamentos, classificações, regras, cadastros). Use para "o que você fez essa semana?".',
      input_schema: { type: 'object', properties: { dias: { type: 'number' } } },
    },
    run: (i) => recentes(i.dias || 7),
  },
];

module.exports = { registrar, propor, confirmar, cancelar, ehSim, pendentesRecentes, FERRAMENTAS, disponivel };
