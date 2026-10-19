/* ══════════════════════════════════════════════════════
   RECONQUISTA PELO JARVIS (19/10/2026)

   Pedido do dono: "o Lucas não precisa acompanhar, tem que estar no Jarvis".
   Quem conversa com os clientes suspensos é o agente do Nexus
   (lib/reconquista no repositório nexus-peritosacademy), pelo WhatsApp
   comercial. Aqui o dono vê como está, lê as conversas, testa o agente e tira
   alguém da régua. Rota: POST /api/reconquista (x-jarvis-key).
   ══════════════════════════════════════════════════════ */
const acoes = require('./acoes');
const URL_NEXUS = 'https://www.nexuspericial.com.br/api/reconquista';

async function chamar(corpo) {
  const chave = process.env.JARVIS_NEXUS_KEY;
  if (!chave) return { erro: 'JARVIS_NEXUS_KEY não configurada' };
  const r = await fetch(URL_NEXUS, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis-key': chave }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
  if (!r.ok && !d.erro) d.erro = `Nexus respondeu ${r.status}`;
  return d;
}

/* Acha a pessoa pelo nome falado ("a Vanusa") quando não vier o id. */
async function idDe(i) {
  if (i.id) return i.id;
  const p = await chamar({ acao: 'painel' });
  const alvo = String(i.nome || '').toLowerCase();
  const achada = (p.pessoas || []).find(x => String(x.nome || '').toLowerCase().includes(alvo));
  return achada ? achada.id : null;
}

acoes.registrar('reconquista_pausar', (e) => chamar({ acao: 'pausar', id: e.id }));
acoes.registrar('reconquista_retomar', (e) => chamar({ acao: 'retomar', id: e.id }));

const FERRAMENTAS = [
  {
    def: {
      name: 'reconquista_painel',
      description: 'Reconquista dos clientes do Nexus suspensos por falta de pagamento: quantos em cada estado (aguardando, em conversa, oferta aceita, voltou, perdido, saiu, pausada), quanto já voltou por mês e quanto está em jogo, quem precisa do Marlos, e a lista de pessoas com motivo e etapa. envioLigado=false significa simulação: as mensagens são montadas e NÃO saem. Use para "como está a reconquista?", "quem voltou?", "alguém precisa de mim?".',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => chamar({ acao: 'painel' }),
  },
  {
    def: {
      name: 'reconquista_conversa',
      description: 'A conversa do agente com uma pessoa da reconquista (id do painel, ou nome). Mostra cada mensagem, se foi simulada ou enviada, e as ações (motivo, oferta, aviso ao Marlos).',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' } } },
    },
    run: async (i) => { const id = await idDe(i); return id ? chamar({ acao: 'conversa', id }) : { erro: 'não achei essa pessoa na reconquista' }; },
  },
  {
    def: {
      name: 'reconquista_testar',
      description: 'Testa o agente: manda uma resposta INVENTADA como se fosse da pessoa e devolve o que o agente responderia. Nunca envia nada. Use quando o Marlos quiser ver "o que ele responderia se a fulana dissesse X".',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' }, texto: { type: 'string' } }, required: ['texto'] },
    },
    run: async (i) => { const id = await idDe(i); return id ? chamar({ acao: 'simular_resposta', id, texto: i.texto }) : { erro: 'não achei essa pessoa na reconquista' }; },
  },
  {
    def: {
      name: 'reconquista_pausar',
      description: 'PROPÕE tirar uma pessoa da reconquista (o agente para de falar com ela). Use quando o Marlos disser que ele mesmo vai cuidar, ou que não é para chamar a pessoa.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' } }, required: ['nome'] },
    },
    run: async (i, ctx) => { const id = await idDe(i); return id ? acoes.propor('reconquista_pausar', { id }, `Tirar ${i.nome} da reconquista (o agente para de falar com essa pessoa)`, ctx) : { erro: 'não achei essa pessoa na reconquista' }; },
  },
  {
    def: {
      name: 'reconquista_retomar',
      description: 'PROPÕE devolver à reconquista uma pessoa que foi tirada.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' } }, required: ['nome'] },
    },
    run: async (i, ctx) => { const id = await idDe(i); return id ? acoes.propor('reconquista_retomar', { id }, `Devolver ${i.nome} à reconquista`, ctx) : { erro: 'não achei essa pessoa na reconquista' }; },
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.JARVIS_NEXUS_KEY, painel: () => chamar({ acao: 'painel' }) };
