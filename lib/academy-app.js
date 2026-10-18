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
acoes.registrar('whatsapp_grupos_escolher', (e) => chamar('grupos_definir', { jids: e.grupos }));
acoes.registrar('academy_grupos_anunciar', (e) => chamar('grupos_anunciar', { eventoId: e.eventoId }));
acoes.registrar('academy_abrir_ao_publico', (e) => chamar('abrir_ao_publico', { eventoId: e.eventoId }));
acoes.registrar('academy_anunciar_live', (e) => chamar('anunciar', { eventoId: e.eventoId }));
// O YouTube vem antes: a transmissão agendada já tem link, e a live da Academy
// nasce com ele (a página do evento toca o vídeo embutido). Sem a autorização
// do YouTube, a live é criada do mesmo jeito, sem link, e o resultado avisa.
acoes.registrar('academy_criar_live', async (e) => {
  let youtube = null;
  if (!e.linkTransmissao) {
    try {
      const yt = require('./youtube');
      if (await yt.conectado()) {
        const inicioISO = new Date(`${e.quando}:00-03:00`).toISOString();
        youtube = await yt.agendar({ titulo: e.titulo, descricao: e.descricao, inicioISO });
        e = { ...e, linkTransmissao: youtube.link };
      } else {
        youtube = { aviso: 'YouTube não autorizado: a live foi criada sem link de transmissão' };
      }
    } catch (err) {
      youtube = { erro: `não agendei no YouTube: ${err.message}` };
    }
  }
  const r = await chamar('criar_evento', e);
  return { ...r, youtube };
});

/**
 * Depois da live, a gravação entra sozinha na Academy (18/10/2026): o link do
 * YouTube vira `gravacao_url` quando a transmissão termina (`complete`). Roda
 * no bom dia das 8h. Nunca lança.
 */
async function registrarGravacoes() {
  try {
    const yt = require('./youtube');
    if (!(await yt.conectado())) return { pulado: 'YouTube não autorizado' };
    const p = await chamar('pendentes_gravacao');
    const feitas = [];
    for (const ev of p.eventos || []) {
      const id = (String(ev.link_transmissao).match(/(?:v=|youtu\.be\/|live\/)([\w-]{11})/) || [])[1];
      if (!id) continue;
      if ((await yt.situacao(id).catch(() => null)) !== 'complete') continue;
      const g = await chamar('gravacao', { eventoId: ev.id, url: `https://www.youtube.com/watch?v=${id}` });
      if (g.ok) feitas.push(ev.titulo);
    }
    return { gravacoes_registradas: feitas };
  } catch (e) { return { erro: e.message }; }
}

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
      description: 'PROPÕE anunciar a live para os ALUNOS DA ACADEMY: email de convite, aviso no sino e no celular (pelo Nexxus), e liga os lembretes automáticos da véspera e da manhã do dia para todos os alunos que ainda não reservaram (quem reservou recebe também 1 hora antes e "ao vivo"). O resumo traz quantas pessoas recebem. Antes, ofereça academy_anuncio_teste. Email não tem desfazer. Pegue o id em academy_eventos.',
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
  {
    def: {
      name: 'academy_anuncio_teste',
      description: 'Manda o email de anúncio da live (o mesmo que os alunos da Academy vão receber) só para o email do Marlos, como teste.',
      input_schema: { type: 'object', properties: { eventoId: { type: 'string' } }, required: ['eventoId'] },
    },
    run: (i) => chamar('anuncio_teste', { eventoId: i.eventoId, email: process.env.JARVIS_DONO_EMAIL || 'marlos.h.santos@gmail.com' }),
  },
  {
    def: {
      name: 'academy_abrir_ao_publico',
      description: 'PROPÕE abrir a live para quem não é aluno: a pessoa se inscreve na página só com nome e email, sem criar conta. Necessário antes de convidar a base do Nexus que não é aluna (toda_base ou tags).',
      input_schema: { type: 'object', properties: { eventoId: { type: 'string' }, titulo: { type: 'string' } }, required: ['eventoId'] },
    },
    run: (i, ctx) => acoes.propor('academy_abrir_ao_publico', { eventoId: i.eventoId },
      `Abrir a live${i.titulo ? ` "${i.titulo}"` : ''} para quem não é aluno se inscrever com nome e email.`, ctx),
  },
  {
    def: {
      name: 'whatsapp_grupos',
      description: 'Os grupos de WhatsApp das lives (18/10/2026): os ESCOLHIDOS para receber os avisos, os que o número Nexus Pericial vê (com membros, se só admins falam e se o número é admin), e se a publicação está LIGADA. Desligada até o Marlos tornar o número admin e isso ser conferido.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => chamar('grupos'),
  },
  {
    def: {
      name: 'whatsapp_grupos_escolher',
      description: 'PROPÕE definir quais grupos recebem os avisos das lives. Substitui a escolha anterior. Pegue jid e nome em whatsapp_grupos; avise se o número não é admin num grupo que só admins falam (lá a mensagem não sai).',
      input_schema: {
        type: 'object',
        properties: { grupos: { type: 'array', items: { type: 'object', properties: { jid: { type: 'string' }, nome: { type: 'string' } }, required: ['jid', 'nome'] } } },
        required: ['grupos'],
      },
    },
    run: (i, ctx) => acoes.propor('whatsapp_grupos_escolher', { grupos: i.grupos },
      `Os avisos das lives vão para: ${i.grupos.map(g => g.nome).join(', ')}.`, ctx),
  },
  {
    def: {
      name: 'academy_grupos_teste',
      description: 'Manda o convite da live, como vai sair nos grupos de WhatsApp, só para o WhatsApp do Marlos. Funciona mesmo com os grupos desligados.',
      input_schema: { type: 'object', properties: { eventoId: { type: 'string' } }, required: ['eventoId'] },
    },
    run: (i) => {
      const numero = process.env.WHATSAPP_DONO;
      if (!numero) return { erro: 'WHATSAPP_DONO não configurado no Jarvis' };
      return chamar('grupos_teste', { eventoId: i.eventoId, numero });
    },
  },
  {
    def: {
      name: 'academy_grupos_anunciar',
      description: 'PROPÕE publicar o convite da live nos grupos de WhatsApp escolhidos, e liga os avisos automáticos de lá: "é hoje" de manhã e "estamos ao vivo" na hora, com o link. Antes, ofereça academy_grupos_teste. Mensagem em grupo não tem desfazer.',
      input_schema: { type: 'object', properties: { eventoId: { type: 'string' }, titulo: { type: 'string' } }, required: ['eventoId'] },
    },
    run: async (i, ctx) => {
      const g = await chamar('grupos');
      if (g.erro) return g;
      if (!g.ligado) return { erro: 'os grupos ainda estão desligados: falta o Marlos tornar o número Nexus Pericial administrador e isso ser conferido' };
      const ativos = (g.escolhidos || []).filter(x => x.ativo).map(x => x.nome);
      if (!ativos.length) return { erro: 'nenhum grupo escolhido: use whatsapp_grupos e whatsapp_grupos_escolher' };
      return acoes.propor('academy_grupos_anunciar', { eventoId: i.eventoId },
        `Publicar o convite da live${i.titulo ? ` "${i.titulo}"` : ''} em ${ativos.length} grupo(s): ${ativos.join(', ')}, e mandar lá o "é hoje" e o "ao vivo". Não tem desfazer.`, ctx);
    },
  },
  {
    def: {
      name: 'academy_criar_live',
      description: 'PROPÕE criar uma live: agenda a transmissão no canal do YouTube (entra no ar sozinha quando o OBS começar a transmitir, com a chave fixa do Jarvis) e cria a live na agenda da Academy com esse link, publicada para todos os alunos (18/10/2026). Ela aparece na agenda e, em até 5 minutos, na home do Nexus como a próxima live. A gravação entra na Academy sozinha no dia seguinte. Não manda email. A hora é a de Brasília, no formato AAAA-MM-DDTHH:MM; confirme dia da semana, data, hora e assunto com o Marlos antes. Depois, para avisar por email: email_escrever com marca peritos-academy e cta_link = o link da live, email_enviar_teste, e email_disparar para o público que ele escolher; ou academy_anunciar_live para os alunos da Academy (esse não tem teste).',
      input_schema: {
        type: 'object',
        properties: {
          titulo: { type: 'string', description: 'O assunto, como título da live.' },
          quando: { type: 'string', description: 'AAAA-MM-DDTHH:MM, horário de Brasília.' },
          descricao: { type: 'string' },
          duracaoMin: { type: 'number', description: 'Padrão 60.' },
          tipo: { type: 'string', enum: ['aula_ao_vivo', 'plantao', 'sala_analise', 'lancamento'], description: 'Padrão aula_ao_vivo.' },
          apresentador: { type: 'string', description: 'Padrão Marlos Henrique; diga o convidado se houver.' },
          linkTransmissao: { type: 'string', description: 'Link do YouTube, se já existir.' },
          abertoAoPublico: { type: 'boolean', description: 'Quem não é aluno pode se inscrever. Padrão não.' },
        },
        required: ['titulo', 'quando'],
      },
    },
    run: (i, ctx) => {
      const d = new Date(`${i.quando}:00-03:00`);
      if (Number.isNaN(d.getTime())) return { erro: 'data inválida: use AAAA-MM-DDTHH:MM' };
      const legivel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
      return acoes.propor('academy_criar_live', i,
        `Criar a live "${i.titulo}" em ${legivel} (Brasília): agendar no YouTube e publicar na Academy para todos os alunos${i.abertoAoPublico ? ', aberta a quem não é aluno' : ''}. Não manda email.`, ctx);
    },
  },
];

module.exports = { FERRAMENTAS, registrarGravacoes, chamarAcademy: chamar, disponivel: () => !!process.env.JARVIS_ACADEMY_KEY };
