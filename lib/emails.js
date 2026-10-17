/* ══════════════════════════════════════════════════════
   EMAIL PELO COMPOSITOR DO NEXUS (17/10/2026)

   O Jarvis usa o MESMO compositor do admin (/api/admin/comunicacao/*), com
   x-jarvis-key, entrando como operador: não fura supressão.

   - Escrever gera o texto pela IA do Nexus e guarda RASCUNHO: não sai nada.
   - Teste vai só para o email do dono.
   - Disparo PROPÕE e espera confirmação (lib/acoes.js), com o número de
     destinatários contado na hora no resumo. Email não tem desfazer.
   ══════════════════════════════════════════════════════ */
const acoes = require('./acoes');

const BASE = 'https://www.nexuspericial.com.br/api/admin/comunicacao';
const PUBLICOS = {
  todos: 'todos os assinantes ativos',
  essencial: 'assinantes do Essencial',
  pro: 'assinantes do Pro',
  toda_base: 'toda a base (assinantes e contatos ativos)',
};
const MARCAS = ['nexus', 'mh-calculos', 'ache-um-perito', 'peritos-academy'];

async function nexus(caminho, opcoes = {}) {
  const chave = process.env.JARVIS_NEXUS_KEY;
  if (!chave) return { erro: 'JARVIS_NEXUS_KEY não configurada' };
  const r = await fetch(`${BASE}${caminho}`, {
    ...opcoes,
    headers: { 'content-type': 'application/json', 'x-jarvis-key': chave, ...(opcoes.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { erro: d.error || d.erro || `Nexus ${r.status}` };
  return d;
}

const contar = (publico) => nexus(`/audiencia-count?publico_alvo=${encodeURIComponent(publico)}`, { method: 'GET' });

acoes.registrar('email_disparar', async (e) => {
  const d = await nexus('/disparar', { method: 'POST', body: JSON.stringify({ comunicacao_id: e.id }) });
  if (d.erro) return d;
  return { ok: true, status: d.comunicacao && d.comunicacao.status, total: d.comunicacao && d.comunicacao.total_destinatarios };
});

const FERRAMENTAS = [
  {
    def: {
      name: 'email_escrever',
      description: 'Escreve um email de comunicação pelo compositor do Nexus (a IA de lá, na voz da marca) e guarda como RASCUNHO, sem enviar. Devolve assunto, texto e quantas pessoas o público escolhido alcança hoje. Para mudar um rascunho, passe o id e o novo pedido. Leia o assunto e um resumo do texto para o Marlos; ofereça mandar um teste para o email dele antes de disparar.',
      input_schema: {
        type: 'object',
        properties: {
          pedido: { type: 'string', description: 'O que o email deve dizer, com o objetivo e os detalhes que ele deu.' },
          marca: { type: 'string', enum: MARCAS, description: 'Empresa remetente. Padrão nexus.' },
          publico: { type: 'string', enum: Object.keys(PUBLICOS), description: 'Padrão todos (assinantes ativos).' },
          cta_texto: { type: 'string' }, cta_link: { type: 'string' },
          id: { type: 'string', description: 'Rascunho a reescrever.' },
        },
        required: ['pedido'],
      },
    },
    run: async (i) => {
      const marca = MARCAS.includes(i.marca) ? i.marca : 'nexus';
      const publico = PUBLICOS[i.publico] ? i.publico : 'todos';
      const g = await nexus('/gerar', { method: 'POST', body: JSON.stringify({ prompt: i.pedido, marca, cta_texto: i.cta_texto, cta_link: i.cta_link, personalizar_nome: true, reescrever: !!i.id }) });
      if (g.erro) return g;
      const s = await nexus('/salvar', { method: 'POST', body: JSON.stringify({
        id: i.id || undefined, assunto: g.assunto, corpo_html: g.corpo_html, corpo_texto: g.corpo_texto,
        prompt_original: i.pedido, cta_texto: i.cta_texto, cta_link: i.cta_link,
        publico_alvo: publico, status: 'rascunho', personalizar_nome: true, marca,
      }) });
      if (s.erro) return s;
      const id = (s.comunicacao && s.comunicacao.id) || s.id || (s.data && s.data.id);
      const n = await contar(publico);
      return {
        id, assunto: g.assunto, texto: String(g.corpo_texto || '').slice(0, 1500),
        publico: PUBLICOS[publico], destinatarios: n.total, suprimidos: n.total_suprimidos,
        nota: 'RASCUNHO salvo, nada foi enviado. Também aparece no compositor do admin do Nexus.',
      };
    },
  },
  {
    def: {
      name: 'email_enviar_teste',
      description: 'Manda o rascunho como teste só para o email do Marlos, para ele ver na caixa de entrada.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    run: (i) => nexus('/teste', { method: 'POST', body: JSON.stringify({ comunicacao_id: i.id, email_teste: process.env.JARVIS_DONO_EMAIL || 'marlos.h.santos@gmail.com' }) }),
  },
  {
    def: {
      name: 'email_disparar',
      description: 'PROPÕE disparar um rascunho para o público dele. O resumo traz o número de destinatários contado agora. Só dispara depois do sim do Marlos. Email não tem desfazer: nunca proponha sem ele ter ouvido o assunto e o público.',
      input_schema: { type: 'object', properties: { id: { type: 'string' }, assunto: { type: 'string' }, publico: { type: 'string', enum: Object.keys(PUBLICOS) } }, required: ['id', 'publico'] },
    },
    run: async (i, ctx) => {
      const n = await contar(i.publico);
      if (n.erro) return n;
      return acoes.propor('email_disparar', { id: i.id },
        `Disparar "${i.assunto || 'o rascunho'}" para ${PUBLICOS[i.publico] || i.publico}: ${n.total} pessoas${n.total_suprimidos ? ` (${n.total_suprimidos} ficam de fora pela supressão)` : ''}. Não tem desfazer.`, ctx);
    },
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.JARVIS_NEXUS_KEY };
