/* ══════════════════════════════════════════════════════
   AS ESCRITAS ANTIGAS, AGORA COM CONFIRMAÇÃO NO SERVIDOR (17/10/2026)

   Lançamento, baixa de conta, compromisso e processo eram etiquetas
   (<lancamento_criar> etc.) que o modelo escrevia no texto depois do "sim":
   quem garantia o sim era o prompt. Agora são ferramentas que PROPÕEM, e só
   `confirmar_acao` executa (lib/acoes.js). As funções que gravam continuam
   as mesmas de antes (RPC do Financeiro, REST do Opera).

   Memória é a exceção: guardar um fato não muda dado de negócio, e o dono vê
   e apaga tudo em /memorias.html. Por isso grava direto.
   ══════════════════════════════════════════════════════ */
const acoes = require('./acoes');
const negocios = require('./negocios');
const db = require('./supabase');

async function lancarMovimentacao(l) {
  const FIN_URL = process.env.FIN_TEST_URL || process.env.FINANCEIRO_SUPABASE_URL;
  const FIN_KEY = process.env.FINANCEIRO_SUPABASE_KEY;
  const FIN_EMAIL = process.env.FINANCEIRO_USER_EMAIL;
  if (!FIN_URL || !FIN_KEY || !FIN_EMAIL) return { erro: 'financeiro não configurado' };
  const r = await fetch(`${FIN_URL}/rest/v1/rpc/lancar_movimentacao`, {
    method: 'POST',
    headers: { apikey: FIN_KEY, authorization: `Bearer ${FIN_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      p_email: FIN_EMAIL,
      p_tipo: l.tipo || 'Despesa',
      p_empresa: l.empresa,
      p_descricao: l.descricao,
      p_valor: l.valor,
      p_data: l.data || null,
      p_vencimento: l.vencimento || null,
      p_categoria: l.categoria || null,
      p_centro: l.centro || null,
      p_produto: l.produto || null,
      p_pago: !!l.pago,
      p_data_pagamento: l.data_pagamento || null,
      p_banco: l.banco || null,
      p_forma: l.forma_pagamento || null,
    }),
  });
  const out = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
  if (out && out.message && !out.erro) return { erro: out.message };
  return out;
}

const embrulhar = (fn) => async (d) => {
  try { return { ok: true, resultado: await fn(d) }; }
  catch (e) { return { erro: String(e.message || e) }; }
};

acoes.registrar('financeiro_lancar', lancarMovimentacao);
acoes.registrar('financeiro_dar_baixa', embrulhar(d => negocios.escrever.confirmarPagamento(d)));
acoes.registrar('opera_agendar', embrulhar(d => negocios.escrever.criarEvento(d)));
acoes.registrar('opera_criar_processo', embrulhar(d => negocios.escrever.criarProcesso(d)));

const reais = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBR = (d) => (d ? String(d).split('-').reverse().join('/') : 'hoje');

const FERRAMENTAS = [
  {
    def: {
      name: 'financeiro_lancar',
      description: 'PROPÕE um lançamento manual de despesa ou receita no Financeiro. Colete antes o que faltar (empresa, categoria, se já foi pago). Empresas: Ecossistema Nexus, MH Cálculos, Octa Gestão Imobiliária, Peritos Academy, Pró-Labore. Na dúvida sobre nomes de categoria/produto, consulte financeiro_opcoes.',
      input_schema: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['Despesa', 'Receita'] },
          empresa: { type: 'string' }, descricao: { type: 'string' }, valor: { type: 'number' },
          data: { type: 'string', description: 'AAAA-MM-DD; padrão hoje' }, vencimento: { type: 'string' },
          categoria: { type: 'string' }, centro: { type: 'string' }, produto: { type: 'string' },
          pago: { type: 'boolean' }, data_pagamento: { type: 'string' }, banco: { type: 'string' }, forma_pagamento: { type: 'string' },
        },
        required: ['tipo', 'empresa', 'descricao', 'valor'],
      },
    },
    run: (i, ctx) => acoes.propor('financeiro_lancar', i,
      `${i.tipo || 'Despesa'} de ${reais(i.valor)}: ${i.descricao}, ${i.empresa}${i.categoria ? ` / ${i.categoria}` : ''}${i.produto ? ` / ${i.produto}` : ''}, ${dataBR(i.data)}${i.pago ? `, já pago${i.banco ? ` pelo ${i.banco}` : ''}` : ', em aberto'}`, ctx),
  },
  {
    def: {
      name: 'financeiro_dar_baixa',
      description: 'PROPÕE dar baixa (marcar como paga) numa conta em aberto. Consulte financeiro_contas antes para achar a conta e confirmar descrição e valor. A descrição precisa bater com UMA conta só.',
      input_schema: {
        type: 'object',
        properties: { descricao: { type: 'string' }, valor: { type: 'number' }, data_pagamento: { type: 'string' }, banco: { type: 'string' }, forma_pagamento: { type: 'string' } },
        required: ['descricao'],
      },
    },
    run: (i, ctx) => acoes.propor('financeiro_dar_baixa', i, `Baixa da conta ${i.descricao}${i.valor ? ` de ${reais(i.valor)}` : ''}, paga ${dataBR(i.data_pagamento)}${i.banco ? ` pelo ${i.banco}` : ''}`, ctx),
  },
  {
    def: {
      name: 'opera_agendar',
      description: 'PROPÕE um compromisso na agenda do Opera. Tipos: entrega_laudo, entrega_quesitos, prazo_fatal, audiencia, reuniao, diligencia, prazo_processo, followup, outro.',
      input_schema: {
        type: 'object',
        properties: {
          tipo: { type: 'string' }, titulo: { type: 'string' }, data: { type: 'string', description: 'AAAA-MM-DD' },
          hora: { type: 'string', description: 'HH:MM; omita se for o dia todo' }, local: { type: 'string' }, alerta_dias: { type: 'number' },
        },
        required: ['titulo', 'data'],
      },
    },
    run: (i, ctx) => acoes.propor('opera_agendar', i, `Agenda do Opera: ${i.titulo}, ${dataBR(i.data)}${i.hora ? ` às ${i.hora}` : ''}${i.local ? `, ${i.local}` : ''}`, ctx),
  },
  {
    def: {
      name: 'opera_criar_processo',
      description: 'PROPÕE abrir um processo/cálculo no Opera. Pergunte primeiro a atuação (perito do juízo ou contratado), depois os dados e por fim prazos e honorários, um de cada vez. Só atuação e tipo_acao são obrigatórios. Nunca pergunte o status. Tipos: Cálculos Cíveis, Bancários, Trabalhistas, Previdenciários, Tributários, Contábeis, Atuariais.',
      input_schema: {
        type: 'object',
        properties: {
          atuacao: { type: 'string', enum: ['perito_juizo', 'perito_contratado'] }, tipo_acao: { type: 'string' }, titulo: { type: 'string' },
          numero: { type: 'string' }, vara: { type: 'string' }, tribunal: { type: 'string' }, comarca: { type: 'string' }, valor_causa: { type: 'number' },
          prazo_entrega: { type: 'string' }, data_nomeacao: { type: 'string' },
          honorario_tipo: { type: 'string', enum: ['fixo', 'hora', 'exito', 'misto'] }, honorario_valor: { type: 'number' }, deposito_judicial: { type: 'boolean' },
          contato_nome: { type: 'string' }, contato_telefone: { type: 'string' }, contato_email: { type: 'string' }, observacoes: { type: 'string' },
        },
        required: ['atuacao', 'tipo_acao'],
      },
    },
    run: (i, ctx) => acoes.propor('opera_criar_processo', i,
      `Processo no Opera: ${i.titulo || i.tipo_acao}, ${i.atuacao === 'perito_juizo' ? 'perito do juízo' : 'perito contratado'}${i.prazo_entrega ? `, entrega ${dataBR(i.prazo_entrega)}` : ''}${i.honorario_valor ? `, honorário ${reais(i.honorario_valor)}` : ''}`, ctx),
  },
  {
    def: {
      name: 'memoria_guardar',
      description: 'Guarda um fato duradouro sobre o Marlos, a família, as empresas, as pessoas da equipe ou um jeito de classificar e decidir (ex.: "almoço do dia a dia é Mercado e Alimentação"). Grava direto: ele vê e apaga tudo na tela de memórias. Não guarde o que é de uma conversa só.',
      input_schema: {
        type: 'object',
        properties: { categoria: { type: 'string', enum: ['pessoal', 'empresa', 'preferência', 'pessoa', 'decisão', 'meta', 'rotina'] }, conteudo: { type: 'string' } },
        required: ['categoria', 'conteudo'],
      },
    },
    run: async (i, ctx) => {
      if (!ctx.userId) return { erro: 'memória indisponível' };
      await db.addMemory(ctx.userId, i.categoria, i.conteudo);
      return { ok: true };
    },
  },
];

module.exports = { FERRAMENTAS };
