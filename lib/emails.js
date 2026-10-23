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
  contatos_tags: 'os contatos com as tags escolhidas',
};
// Públicos que alcançam quem NÃO é aluno: a live precisa estar aberta ao
// público, senão o link do email leva ao login de quem não tem conta.
const ALCANCA_NAO_ALUNOS = ['toda_base', 'contatos_tags'];
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

/** Nomes de tag → filtro do compositor. `null` quando não é público por tag. */
async function filtroDeTags(publico, tags) {
  if (publico !== 'contatos_tags') return null;
  const nomes = (tags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean);
  if (!nomes.length) return { erro: 'público por tag sem nenhuma tag' };
  const d = await nexus('/tags', { method: 'GET' });
  if (d.erro) return d;
  const achadas = (d.tags || []).filter(t => nomes.includes(String(t.nome).toLowerCase()));
  const faltam = nomes.filter(n => !achadas.some(t => String(t.nome).toLowerCase() === n));
  if (faltam.length) return { erro: `tag não encontrada: ${faltam.join(', ')}. Use email_tags para ver os nomes.` };
  return { tagIds: achadas.map(t => t.id), modoTag: 'OR' };
}

const contar = (publico, filtro) => nexus(`/audiencia-count?publico_alvo=${encodeURIComponent(publico)}`
  + (filtro ? `&filtro_custom=${encodeURIComponent(JSON.stringify(filtro))}` : ''), { method: 'GET' });

/** "2026-10-28T11:00" (Brasília) → Date. */
const deBrasilia = (local) => new Date(`${String(local).slice(0, 16)}:00-03:00`);
const legivel = (d) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);

acoes.registrar('email_agendar_lembretes', async (e) => {
  const feitos = [];
  for (const l of e.lembretes) {
    const d = await nexus('/salvar', { method: 'POST', body: JSON.stringify({ ...l.dados, id: l.id, status: 'agendado', agendado_para: l.quando }) });
    if (d.erro) return { erro: `${l.nome}: ${d.erro}`, feitos };
    feitos.push(`${l.nome} agendado para ${legivel(new Date(l.quando))}`);
  }
  return { ok: true, feitos };
});

acoes.registrar('email_disparar', async (e) => {
  const d = await nexus('/disparar', { method: 'POST', body: JSON.stringify({ comunicacao_id: e.id }) });
  if (d.erro) return d;
  return { ok: true, status: d.comunicacao && d.comunicacao.status, total: d.comunicacao && d.comunicacao.total_destinatarios };
});

const PROP_TAGS = { type: 'array', items: { type: 'string' }, description: 'Só com publico contatos_tags: nomes das tags (veja em email_tags).' };

/** Os dados de uma live da Academy pelo id, com o link da página. */
async function liveDaAcademy(eventoId) {
  const lista = await require('./academy-app').chamarAcademy('eventos');
  if (lista.erro) return lista;
  const ev = (lista.eventos || []).find(e => e.id === eventoId);
  return ev || { erro: 'live não encontrada entre as próximas (academy_eventos)' };
}

const FERRAMENTAS = [
  {
    def: {
      name: 'email_escrever',
      description: 'Escreve um email de comunicação pelo compositor do Nexus (a IA de lá, na voz da marca) e guarda como RASCUNHO, sem enviar. Devolve assunto, texto e quantas pessoas o público escolhido alcança hoje. Para mudar um rascunho, passe o id e o novo pedido. Leia o assunto e um resumo do texto para o Marlos; ofereça mandar um teste para o email dele antes de disparar. Convite de live: marca peritos-academy, cta_link = link da live (academy_eventos). ⚠️ Os alunos migrados da Academy NÃO estão em "todos" (assinantes do Nexus): para alcançar os alunos da Academy use academy_anunciar_live; este email é para a base do Nexus. ⚠️ Email de RECURSO NOVO: antes, leia o guia "anuncio de recurso novo" no cérebro (nexus-peritosacademy) e mande o formato dele no pedido (cena curta da dor, bloco de destaque com imagem e três ✓, um botão); e pergunte ao Marlos sobre notificação na Academy, popup no app e grupos de WhatsApp.',
      input_schema: {
        type: 'object',
        properties: {
          pedido: { type: 'string', description: 'O que o email deve dizer, com o objetivo e os detalhes que ele deu.' },
          marca: { type: 'string', enum: MARCAS, description: 'Empresa remetente. Padrão nexus.' },
          publico: { type: 'string', enum: Object.keys(PUBLICOS), description: 'Padrão todos (assinantes ativos do Nexus).' },
          tags: PROP_TAGS,
          cta_texto: { type: 'string' }, cta_link: { type: 'string' },
          id: { type: 'string', description: 'Rascunho a reescrever.' },
        },
        required: ['pedido'],
      },
    },
    run: async (i) => {
      const marca = MARCAS.includes(i.marca) ? i.marca : 'nexus';
      const publico = PUBLICOS[i.publico] ? i.publico : 'todos';
      const filtro = await filtroDeTags(publico, i.tags);
      if (filtro && filtro.erro) return filtro;
      const g = await nexus('/gerar', { method: 'POST', body: JSON.stringify({ prompt: i.pedido, marca, cta_texto: i.cta_texto, cta_link: i.cta_link, personalizar_nome: true, reescrever: !!i.id }) });
      if (g.erro) return g;
      const s = await nexus('/salvar', { method: 'POST', body: JSON.stringify({
        id: i.id || undefined, assunto: g.assunto, corpo_html: g.corpo_html, corpo_texto: g.corpo_texto,
        prompt_original: i.pedido, cta_texto: i.cta_texto, cta_link: i.cta_link,
        publico_alvo: publico, filtro_custom: filtro, status: 'rascunho', personalizar_nome: true, marca,
      }) });
      if (s.erro) return s;
      const id = (s.comunicacao && s.comunicacao.id) || s.id || (s.data && s.data.id);
      const n = await contar(publico, filtro);
      return {
        id, assunto: g.assunto, texto: String(g.corpo_texto || '').slice(0, 1500),
        publico: PUBLICOS[publico], tags: i.tags, destinatarios: n.total, suprimidos: n.total_suprimidos,
        nota: 'RASCUNHO salvo, nada foi enviado. Também aparece no compositor do admin do Nexus.',
      };
    },
  },
  {
    def: {
      name: 'email_tags',
      description: 'Lista as tags da base de contatos do Nexus (ex.: ja-e-perito, inscricao-eventos-quer-ser-perito, aluno-academy-nexus), para escolher um público por tag.',
      input_schema: { type: 'object', properties: {} },
    },
    run: async () => {
      const d = await nexus('/tags', { method: 'GET' });
      return d.erro ? d : { tags: (d.tags || []).map(t => t.nome) };
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
      input_schema: { type: 'object', properties: { id: { type: 'string' }, assunto: { type: 'string' }, publico: { type: 'string', enum: Object.keys(PUBLICOS) }, tags: PROP_TAGS }, required: ['id', 'publico'] },
    },
    run: async (i, ctx) => {
      const filtro = await filtroDeTags(i.publico, i.tags);
      if (filtro && filtro.erro) return filtro;
      const n = await contar(i.publico, filtro);
      if (n.erro) return n;
      const alvo = i.publico === 'contatos_tags' ? `os contatos com as tags ${(i.tags || []).join(', ')}` : (PUBLICOS[i.publico] || i.publico);
      return acoes.propor('email_disparar', { id: i.id },
        `Disparar "${i.assunto || 'o rascunho'}" para ${alvo}: ${n.total} pessoas${n.total_suprimidos ? ` (${n.total_suprimidos} ficam de fora pela supressão)` : ''}. Não tem desfazer.`, ctx);
    },
  },
  {
    def: {
      name: 'email_lembretes_da_live',
      description: 'Depois do convite de uma live pela base do Nexus: escreve os dois lembretes automáticos (véspera às 8h e no dia às 7h, horário de Brasília) para O MESMO público do convite, e PROPÕE agendar os dois. Quem já reservou o lugar sai na hora do envio. Ficam como rascunho até o sim: ofereça o teste de cada um (email_enviar_teste). Se o público alcança quem não é aluno (toda_base ou tags), a live precisa estar aberta ao público (academy_abrir_ao_publico).',
      input_schema: {
        type: 'object',
        properties: {
          eventoId: { type: 'string', description: 'Id da live na Academy (academy_eventos).' },
          publico: { type: 'string', enum: Object.keys(PUBLICOS) }, tags: PROP_TAGS,
          marca: { type: 'string', enum: MARCAS, description: 'Padrão peritos-academy.' },
        },
        required: ['eventoId', 'publico'],
      },
    },
    run: async (i, ctx) => {
      const ev = await liveDaAcademy(i.eventoId);
      if (ev.erro) return ev;
      if (ALCANCA_NAO_ALUNOS.includes(i.publico) && !ev.aberto_ao_publico) {
        return { erro: 'esse público tem gente que não é aluno e a live não está aberta ao público: proponha academy_abrir_ao_publico antes' };
      }
      const filtroTags = await filtroDeTags(i.publico, i.tags);
      if (filtroTags && filtroTags.erro) return filtroTags;
      const filtro = { ...(filtroTags || {}), excluirConfirmadosEventoAcademy: ev.id };
      const marca = MARCAS.includes(i.marca) ? i.marca : 'peritos-academy';
      const inicio = new Date(ev.inicia_em);
      const diaBR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
      const vespera = deBrasilia(`${diaBR(new Date(inicio.getTime() - 86400000))}T08:00`);
      const doDia = deBrasilia(`${diaBR(inicio)}T07:00`);
      const quando = legivel(inicio);
      const planos = [
        { nome: 'lembrete da véspera', quando: vespera, pedido: `Lembrete curto da live "${ev.titulo}", que é AMANHÃ, ${quando} (Brasília). Para quem ainda não reservou: convide a reservar o lugar pelo botão, que leva aos lembretes de 1 hora antes e de quando entrar no ar. Tom de recado do Marlos.` },
        { nome: 'lembrete do dia', quando: doDia, pedido: `Lembrete curto da live "${ev.titulo}", que é HOJE, ${quando} (Brasília). Para quem ainda não reservou: ainda dá tempo, reserve pelo botão. Uma ou duas frases, direto.` },
      ].filter(pl => pl.quando.getTime() > Date.now() + 10 * 60000 && pl.quando.getTime() < inicio.getTime() - 3600000);
      if (!planos.length) return { erro: 'a live está perto demais: não sobra horário para os lembretes da véspera nem do dia' };

      const lembretes = [];
      for (const pl of planos) {
        const g = await nexus('/gerar', { method: 'POST', body: JSON.stringify({ prompt: pl.pedido, marca, cta_texto: 'Reservar meu lugar', cta_link: `${ev.link}?reservar=1`, personalizar_nome: true }) });
        if (g.erro) return g;
        const dados = {
          assunto: g.assunto, corpo_html: g.corpo_html, corpo_texto: g.corpo_texto, prompt_original: pl.pedido,
          cta_texto: 'Reservar meu lugar', cta_link: `${ev.link}?reservar=1`,
          publico_alvo: i.publico, filtro_custom: filtro, personalizar_nome: true, marca,
        };
        const s = await nexus('/salvar', { method: 'POST', body: JSON.stringify({ ...dados, status: 'rascunho' }) });
        if (s.erro) return s;
        const id = (s.comunicacao && s.comunicacao.id) || s.id || (s.data && s.data.id);
        lembretes.push({ nome: pl.nome, id, quando: pl.quando.toISOString(), dados, texto: String(g.corpo_texto || '').slice(0, 600) });
      }
      const resumo = lembretes.map(l => `${l.nome} em ${legivel(new Date(l.quando))} ("${l.dados.assunto}")`).join(' e ');
      const proposta = await acoes.propor('email_agendar_lembretes', { lembretes: lembretes.map(({ texto, ...l }) => l) },
        `Agendar ${resumo}, para ${PUBLICOS[i.publico] || i.publico}, sem quem já reservou.`, ctx);
      return { ...proposta, rascunhos: lembretes.map(l => ({ id: l.id, nome: l.nome, assunto: l.dados.assunto, texto: l.texto })) };
    },
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.JARVIS_NEXUS_KEY };
