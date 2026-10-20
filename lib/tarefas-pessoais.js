/* ══════════════════════════════════════════════════════
   TAREFAS E LEMBRETES DO MARLOS (20/10/2026)

   "Me lembra às 15h de ligar pro advogado", "anota: renovar o seguro sexta",
   "todo dia 5 me lembra do DAS". Tabela tarefas_pessoais
   (sql/tarefas-pessoais.sql), no Supabase do próprio Jarvis.

   Grava direto, sem o "sim": como a memória, é a lista dele, não dado de
   negócio, e desfazer é uma frase ("apaga essa").

   O aviso com hora sai pelo /api/lembretes (WhatsApp dele), que o pg_cron do
   Supabase chama a cada 5 minutos. O bom dia lê as de hoje, e o fechamento
   do dia (/api/fim-do-dia) lê as feitas, as que ficaram e as de amanhã.

   ⚠️ HORA É DE BRASÍLIA. O modelo manda "2026-10-21T15:00" sem fuso; aqui
   vira -03:00. O Brasil não tem horário de verão desde 2019, então o fuso é
   fixo e a conta de "próxima vez" não precisa de biblioteca.
   ══════════════════════════════════════════════════════ */
const db = require('./supabase');

const FUSO_MS = 3 * 3600000;

function disponivel() { return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)); }

const ymdSP = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const hojeSP = () => ymdSP(new Date());
const amanhaSP = () => ymdSP(new Date(Date.now() + 86400000));

/* "2026-10-21T15:00" (Brasília) → ISO em UTC. Com fuso explícito, respeita. */
function paraISO(quando) {
  if (!quando) return null;
  let s = String(quando).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T09:00';
  if (/T\d{2}:\d{2}$/.test(s)) s += ':00';
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += '-03:00';
  const d = new Date(s);
  if (isNaN(d)) throw new Error(`hora que não entendi: ${quando}`);
  return d.toISOString();
}

/* "amanhã às 15h", "hoje às 9h30", "sex 24/10 às 8h" — o que se lê no celular */
function legivel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const dia = ymdSP(d);
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':00', 'h').replace(':', 'h');
  if (dia === hojeSP()) return `hoje às ${hora}`;
  if (dia === amanhaSP()) return `amanhã às ${hora}`;
  const nome = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '').replace(',', '');
  return `${nome} às ${hora}`;
}

/* A próxima vez de um lembrete que repete, sempre no futuro (se o disparo
   ficou parado uns dias, não manda os atrasados em fila: pula para a próxima). */
function proximaVez(iso, repetir) {
  const agora = Date.now();
  // trabalha no relógio de Brasília deslocando o fuso fixo
  const local = new Date(new Date(iso).getTime() - FUSO_MS);
  const dia1 = () => local.setUTCDate(local.getUTCDate() + 1);
  const diaDoMes = local.getUTCDate();   // o do mês original: o 31 não vira 28 para sempre depois de fevereiro
  for (let i = 0; i < 400 && local.getTime() + FUSO_MS <= agora; i++) {
    if (repetir === 'diario') dia1();
    else if (repetir === 'dias_uteis') { do dia1(); while ([0, 6].includes(local.getUTCDay())); }
    else if (repetir === 'semanal') local.setUTCDate(local.getUTCDate() + 7);
    else if (repetir === 'mensal') {
      local.setUTCDate(1); local.setUTCMonth(local.getUTCMonth() + 1);
      const fim = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
      local.setUTCDate(Math.min(diaDoMes, fim));   // dia 31 em mês de 30 cai no 30
    } else return null;
  }
  return new Date(local.getTime() + FUSO_MS).toISOString();
}

const ROTULO_REPETIR = { diario: 'todo dia', dias_uteis: 'dia útil', semanal: 'toda semana', mensal: 'todo mês' };

/* o que o modelo e o texto do WhatsApp recebem: sem uuid comprido demais na fala,
   mas com o id para concluir/mudar */
function enxuta(t) {
  const hoje = hojeSP();
  const atrasada = t.estado === 'aberta' && ((t.dia && t.dia < hoje) || (!t.dia && t.quando && ymdSP(new Date(t.quando)) < hoje && !t.repetir));
  return {
    id: t.id,
    texto: t.texto,
    ...(t.quando ? { aviso: legivel(t.quando) } : {}),
    ...(t.dia ? { dia: t.dia } : {}),
    ...(t.repetir ? { repete: ROTULO_REPETIR[t.repetir] } : {}),
    ...(atrasada ? { atrasada: true } : {}),
    ...(t.estado !== 'aberta' ? { estado: t.estado } : {}),
  };
}

const CAMPOS = 'select=id,texto,quando,dia,repetir,estado,avisado_em,fechada_em';
const lista = async (filtro) => {
  const r = await db.query('tarefas_pessoais', `${filtro}&${CAMPOS}&order=quando.asc.nullslast,dia.asc.nullslast,criada_em.asc&limit=60`);
  if (!Array.isArray(r)) throw new Error((r && r.message) || 'tarefas indisponíveis');
  return r;
};

/* Fim de um dia de Brasília em UTC: 2026-10-20 → 2026-10-21T03:00:00Z */
const fimDoDia = (ymd) => new Date(`${ymd}T23:59:59-03:00`).toISOString();
const inicioDoDia = (ymd) => new Date(`${ymd}T00:00:00-03:00`).toISOString();

/* de hoje = com dia até hoje, ou com aviso até o fim de hoje (atrasadas entram) */
async function deHoje() {
  const h = hojeSP();
  return (await lista(`estado=eq.aberta&or=(dia.lte.${h},and(dia.is.null,quando.lte.${fimDoDia(h)}))`)).map(enxuta);
}
async function deAmanha() {
  const a = amanhaSP();
  return (await lista(`estado=eq.aberta&or=(dia.eq.${a},and(dia.is.null,quando.gte.${inicioDoDia(a)},quando.lte.${fimDoDia(a)}))`)).map(enxuta);
}
async function feitasHoje() {
  return (await lista(`estado=eq.feita&fechada_em=gte.${inicioDoDia(hojeSP())}`)).map(enxuta);
}

async function listar(periodo = 'hoje') {
  if (periodo === 'hoje') return { periodo, tarefas: await deHoje() };
  if (periodo === 'amanha') return { periodo, tarefas: await deAmanha() };
  if (periodo === 'feitas_hoje') return { periodo, tarefas: await feitasHoje() };
  if (periodo === 'semana') {
    const fim = ymdSP(new Date(Date.now() + 7 * 86400000));
    return { periodo, tarefas: (await lista(`estado=eq.aberta&or=(dia.lte.${fim},and(dia.is.null,quando.lte.${fimDoDia(fim)}))`)).map(enxuta) };
  }
  return { periodo: 'abertas', tarefas: (await lista('estado=eq.aberta')).map(enxuta) };
}

async function criar(i) {
  const texto = String(i.texto || '').trim();
  if (!texto) return { erro: 'texto vazio' };
  const quando = paraISO(i.quando);
  if (i.repetir && !quando) return { erro: 'lembrete que repete precisa de hora (quando)' };
  if (quando && !i.repetir && new Date(quando) < new Date(Date.now() - 60000)) return { erro: `essa hora já passou (${legivel(quando)}): confirme o dia com ele` };
  const [t] = await db.insert('tarefas_pessoais', { texto, quando, dia: i.dia || null, repetir: i.repetir || null });
  if (!t || !t.id) return { erro: 'não consegui gravar a tarefa' };
  return { ok: true, tarefa: enxuta(t) };
}

async function atualizar(i) {
  if (!i.id) return { erro: 'faltou o id (consulte tarefas_listar)' };
  const mudar = {};
  if (i.acao === 'concluir') Object.assign(mudar, { estado: 'feita', fechada_em: new Date().toISOString() });
  else if (i.acao === 'descartar') Object.assign(mudar, { estado: 'descartada', fechada_em: new Date().toISOString() });
  else if (i.acao === 'reabrir') Object.assign(mudar, { estado: 'aberta', fechada_em: null });
  if (i.texto) mudar.texto = String(i.texto).trim();
  if (i.quando !== undefined) Object.assign(mudar, { quando: paraISO(i.quando), avisado_em: null });
  if (i.dia !== undefined) mudar.dia = i.dia || null;
  if (i.repetir !== undefined) mudar.repetir = i.repetir || null;
  if (!Object.keys(mudar).length) return { erro: 'nada para mudar' };
  const r = await db.update('tarefas_pessoais', { id: i.id }, mudar);
  if (!Array.isArray(r) || !r.length) return { erro: 'tarefa não encontrada' };
  return { ok: true, tarefa: enxuta(r[0]) };
}

/* ---- o disparo (api/lembretes.js) ----
   Pega a tarefa ANTES de mandar (PATCH com avisado_em=is.null): duas
   chamadas sobrepostas do cron não mandam o mesmo lembrete duas vezes.
   Se o envio falhar, devolve, e a próxima rodada tenta de novo. */
async function pegar(id, agora) {
  // db.update só filtra com eq; aqui precisa do is.null
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/tarefas_pessoais?id=eq.${id}&avisado_em=is.null`, {
    method: 'PATCH',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: JSON.stringify({ avisado_em: agora }),
  });
  return r.json();
}

async function dispararLembretes(enviar) {
  const agora = new Date().toISOString();
  const vencidos = await lista(`estado=eq.aberta&avisado_em=is.null&quando=lte.${agora}`);
  const resultado = [];
  for (const t of vencidos) {
    const pego = await pegar(t.id, agora).catch(() => null);
    if (!Array.isArray(pego) || !pego.length) continue;
    const atraso = Date.now() - new Date(t.quando).getTime();
    const texto = `⏰ *Lembrete:* ${t.texto}${atraso > 30 * 60000 ? `\n_(era para ${legivel(t.quando)})_` : ''}${t.repetir ? `\n_Repete ${ROTULO_REPETIR[t.repetir]}._` : ''}`;
    try {
      await enviar(texto);
      if (t.repetir) await db.update('tarefas_pessoais', { id: t.id }, { quando: proximaVez(t.quando, t.repetir), avisado_em: null });
      resultado.push({ id: t.id, enviado: true });
    } catch (e) {
      await db.update('tarefas_pessoais', { id: t.id }, { avisado_em: null }).catch(() => {});
      resultado.push({ id: t.id, erro: e.message });
    }
  }
  return resultado;
}

const FERRAMENTAS = [
  {
    def: {
      name: 'tarefa_criar',
      description: 'Anota uma tarefa ou lembrete pessoal do Marlos. Com hora (quando), ele recebe o aviso no WhatsApp nessa hora; sem hora, com dia, entra na lista daquele dia (o bom dia e o fechamento leem). Use para "me lembra de...", "anota...", "não me deixa esquecer...". Grava direto: depois diga em meia frase o que ficou e quando ("anotado, te lembro amanhã às 15h"). Se ele não disser a hora de um "me lembra", pergunte. "Me lembra amanhã" sem hora: quando às 9h.',
      input_schema: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'A tarefa, curta e no imperativo: "Ligar para o Dr. Paulo sobre o laudo".' },
          quando: { type: 'string', description: 'Hora do aviso, Brasília, AAAA-MM-DDTHH:MM. Calcule a partir da data e hora de agora.' },
          dia: { type: 'string', description: 'Dia da tarefa sem hora, AAAA-MM-DD.' },
          repetir: { type: 'string', enum: ['diario', 'dias_uteis', 'semanal', 'mensal'], description: 'Só quando ele pedir que repita ("todo dia 5", "toda segunda").' },
        },
        required: ['texto'],
      },
    },
    run: (i) => criar(i),
  },
  {
    def: {
      name: 'tarefas_listar',
      description: 'As tarefas e lembretes pessoais do Marlos. "O que tenho hoje?", "o que eu anotei?", "o que ficou pra amanhã?". hoje inclui as atrasadas.',
      input_schema: { type: 'object', properties: { periodo: { type: 'string', enum: ['hoje', 'amanha', 'semana', 'abertas', 'feitas_hoje'] } } },
    },
    run: (i) => listar(i.periodo),
  },
  {
    def: {
      name: 'tarefa_atualizar',
      description: 'Conclui, descarta, reabre ou muda uma tarefa pessoal (id vem de tarefas_listar). "Já liguei pro advogado" → concluir. "Esquece aquele lembrete" → descartar. "Passa pra amanhã às 10h" → só o novo quando. Em tarefa que repete, concluir e descartar encerram a série: use só se ele quiser parar.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          acao: { type: 'string', enum: ['concluir', 'descartar', 'reabrir'] },
          texto: { type: 'string' },
          quando: { type: 'string', description: 'Nova hora do aviso, Brasília, AAAA-MM-DDTHH:MM.' },
          dia: { type: 'string', description: 'Novo dia, AAAA-MM-DD.' },
          repetir: { type: 'string', enum: ['diario', 'dias_uteis', 'semanal', 'mensal', ''] },
        },
        required: ['id'],
      },
    },
    run: (i) => atualizar(i),
  },
];

module.exports = { FERRAMENTAS, disponivel, deHoje, deAmanha, feitasHoje, dispararLembretes, proximaVez, paraISO, legivel };
