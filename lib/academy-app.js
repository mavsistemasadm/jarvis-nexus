/* ══════════════════════════════════════════════════════
   A ACADEMY PELA PORTA DELA (17/10/2026)

   Cursos, próximos eventos, matrícula e anúncio de live por
   POST /api/integracoes/jarvis da Academy (repositório peritos-academy), que
   usa os mesmos núcleos das telas do admin. Matrícula e anúncio propõem e
   esperam confirmação (lib/acoes.js). A matrícula não cria conta.
   ══════════════════════════════════════════════════════ */
const acoes = require('./acoes');

const URL_ACADEMY = 'https://evolua.peritosacademy.com.br/api/integracoes/jarvis';

async function chamar(acao, corpo = {}) {
  const chave = process.env.JARVIS_ACADEMY_KEY;
  if (!chave) return { erro: 'JARVIS_ACADEMY_KEY não configurada' };
  const r = await fetch(URL_ACADEMY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-jarvis-key': chave },
    body: JSON.stringify({ acao, ...corpo }),
  });
  const d = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
  if (!r.ok && !d.erro) d.erro = `Academy respondeu ${r.status}`;
  return d;
}

acoes.registrar('academy_matricular', (e) => chamar('matricular', e));
acoes.registrar('academy_anunciar_live', (e) => chamar('anunciar', { eventoId: e.eventoId }));

const FERRAMENTAS = [
  {
    def: { name: 'academy_cursos', description: 'Cursos publicados da Peritos Academy, com slug e título. Use para achar o curso certo antes de matricular.', input_schema: { type: 'object', properties: {} } },
    run: () => chamar('cursos'),
  },
  {
    def: { name: 'academy_eventos', description: 'Próximos eventos e lives da Academy, com id, data e quantas pessoas receberiam o anúncio.', input_schema: { type: 'object', properties: {} } },
    run: () => chamar('eventos'),
  },
  {
    def: {
      name: 'academy_matricular',
      description: 'PROPÕE matricular uma pessoa (que já tem conta na Academy) num curso, por um número de meses ou vitalício. Não cria conta nem manda email. Confira o slug com academy_cursos.',
      input_schema: {
        type: 'object',
        properties: { email: { type: 'string' }, cursoSlug: { type: 'string' }, curso: { type: 'string', description: 'Nome, para o resumo.' }, meses: { type: 'number', description: 'Omita para vitalício.' } },
        required: ['email', 'cursoSlug'],
      },
    },
    run: (i, ctx) => acoes.propor('academy_matricular', { email: i.email, cursoSlug: i.cursoSlug, meses: i.meses ?? null },
      `Matricular ${i.email} em ${i.curso || i.cursoSlug}, ${i.meses ? `por ${i.meses} ${i.meses === 1 ? 'mês' : 'meses'}` : 'vitalício'}`, ctx),
  },
  {
    def: {
      name: 'academy_anunciar_live',
      description: 'PROPÕE anunciar um evento/live por email e sino para o público dele. O resumo traz quantas pessoas recebem. Email não tem desfazer. Pegue o id em academy_eventos.',
      input_schema: { type: 'object', properties: { eventoId: { type: 'string' } }, required: ['eventoId'] },
    },
    run: async (i, ctx) => {
      const lista = await chamar('eventos');
      const ev = (lista.eventos || []).find(e => e.id === i.eventoId);
      if (!ev) return { erro: 'evento não encontrado entre os próximos' };
      if (!ev.publicado) return { erro: 'o evento ainda não está publicado: publique antes de anunciar' };
      return acoes.propor('academy_anunciar_live', { eventoId: ev.id },
        `Anunciar "${ev.titulo}" por email e sino para ${ev.publico} pessoas. Não tem desfazer.`, ctx);
    },
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.JARVIS_ACADEMY_KEY };
