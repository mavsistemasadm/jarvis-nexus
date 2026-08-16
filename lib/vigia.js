/* NEXUS → vigia: o que precisa de atenção AGORA.

   Até aqui o NEXUS só sabia responder quando perguntado. Isto é o contrário:
   varre as três bases e devolve o que um bom mordomo avisaria sem esperar
   ser questionado.

   Regra de projeto: um alerta que aparece todo dia deixa de ser alerta. Cada
   regra tem um limiar apertado de propósito — é melhor avisar três coisas que
   importam do que quinze que ele vai ignorar.                              */

const negocios = require('./negocios');

const SEV = { URGENTE: 'urgente', ATENCAO: 'atencao', INFO: 'info' };
const ORDEM = { urgente: 0, atencao: 1, info: 2 };

/* dias entre hoje (Brasília) e uma data AAAA-MM-DD */
function emDias(data) {
  if (!data) return null;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return Math.round((new Date(String(data).slice(0, 10) + 'T12:00:00') - new Date(hoje + 'T12:00:00')) / 86400000);
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* 2026-08-10 não se lê no celular. Vira 10/08 — e "hoje"/"ontem"/"amanhã"
   quando for o caso, que é o que a pessoa realmente quer saber. */
function dataBR(d) {
  if (!d) return '';
  const dias = emDias(d);
  if (dias === 0) return 'hoje';
  if (dias === -1) return 'ontem';
  if (dias === 1) return 'amanhã';
  const [a, m, dd] = String(d).slice(0, 10).split('-');
  return `${dd}/${m}`;
}

/* corta nome comprido sem cortar palavra no meio */
const curto = (s, n = 28) => {
  const t = String(s || '').trim();
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '') + '…';
};

/* Cada regra roda isolada: uma fonte fora do ar não pode derrubar o resto do
   aviso. O erro vira um item visível em vez de sumir em silêncio. */
async function regra(alertas, falhas, nome, fn) {
  try { await fn(alertas); }
  catch (e) { falhas.push(`${nome}: ${e.message}`); }
}

async function avaliar() {
  const alertas = [];
  const falhas = [];
  const fontes = negocios.statusFontes();
  const add = (a) => alertas.push(a);

  await Promise.all([
    /* ---- financeiro ---- */
    fontes.financeiro && regra(alertas, falhas, 'contas em atraso', async () => {
      const { em_atraso } = await negocios.financeiro.contas('em_atraso');
      if (!Array.isArray(em_atraso) || !em_atraso.length) return;
      const total = em_atraso.reduce((s, c) => s + Number(c.valor || 0), 0);
      add({
        chave: 'financeiro:atraso',
        severidade: SEV.URGENTE,
        titulo: `${em_atraso.length} ${em_atraso.length === 1 ? 'conta atrasada' : 'contas atrasadas'} — ${brl(total)}`,
        itens: em_atraso.slice(0, 5).map(c => `${curto(c.descricao)} · ${brl(c.valor)} · venceu ${dataBR(c.vencimento)}`)
      });
    }),

    fontes.financeiro && regra(alertas, falhas, 'contas vencendo', async () => {
      const { contas } = await negocios.financeiro.contas('a_vencer', 3);
      const proximas = (contas || []).filter(c => { const d = emDias(c.vencimento); return d !== null && d >= 0 && d <= 2; });
      if (!proximas.length) return;
      add({
        chave: 'financeiro:vencendo',
        severidade: SEV.ATENCAO,
        titulo: `${proximas.length} ${proximas.length === 1 ? 'conta vence' : 'contas vencem'} em até 2 dias`,
        itens: proximas.map(c => `${curto(c.descricao)} · ${brl(c.valor)} · ${dataBR(c.vencimento)}`)
      });
    }),

    /* ---- prazos e agenda ---- */
    fontes.opera && regra(alertas, falhas, 'agenda', async () => {
      const ag = await negocios.opera.agenda(7);

      /* prazo fatal e audiência não admitem "depois eu vejo" */
      const criticos = [...(ag.compromissos_marcados || []), ...(ag.prazos_de_processo || [])]
        .map(e => ({ ...e, dias: emDias(e.data_evento) }))
        .filter(e => e.dias !== null && e.dias >= 0 && e.dias <= 3);

      for (const e of criticos) {
        const fatal = ['prazo_fatal', 'audiencia', 'entrega_laudo', 'prazo_processo'].includes(e.tipo);
        add({
          chave: `agenda:${e.tipo}:${String(e.data_evento).slice(0, 10)}:${e.titulo}`,
          severidade: (fatal && e.dias <= 2) ? SEV.URGENTE : SEV.ATENCAO,
          titulo: `${e.dias === 0 ? 'HOJE' : e.dias === 1 ? 'amanhã' : `em ${e.dias} dias`}: ${e.titulo}`,
          itens: [`${e.tipo.replace(/_/g, ' ')}${e.local ? ' · ' + e.local : ''}`]
        });
      }

      /* follow-ups: só os que já passaram de uma semana viram alerta */
      const velhos = (ag.followups_pendentes || []).filter(f => f.parado_ha_dias >= 7);
      if (velhos.length) {
        add({
          chave: 'comercial:followup',
          severidade: SEV.ATENCAO,
          titulo: `${velhos.length} ${velhos.length === 1 ? 'negociação parada' : 'negociações paradas'} há 7 dias ou mais`,
          itens: velhos.slice(0, 5).map(f => `${curto(f.titulo)} · ${f.parado_ha_dias}d parado`)
        });
      }
    }),

    /* ---- atendimento ---- */
    fontes.opera && regra(alertas, falhas, 'whatsapp', async () => {
      const w = await negocios.opera.whatsapp();
      const esperando = (w.aguardando_resposta || []).filter(c => c.ha_dias >= 1);
      if (esperando.length) {
        add({
          chave: 'whatsapp:sem_resposta',
          severidade: esperando.some(c => c.ha_dias >= 2) ? SEV.URGENTE : SEV.ATENCAO,
          titulo: `${esperando.length} ${esperando.length === 1 ? 'cliente esperando' : 'clientes esperando'} há mais de um dia`,
          itens: esperando.slice(0, 5).map(c => `${curto(c.nome)} · ${c.nao_lidas} ${c.nao_lidas === 1 ? 'msg' : 'msgs'} · ${c.ha_dias}d`)
        });
      }
      /* `escalar_humano` fica true mesmo depois do caso resolver, então o
         status é quem diz se ainda espera alguém. Sem este filtro, venda já
         fechada aparece como urgente e o alerta perde credibilidade. */
      const RESOLVIDOS = ['convertido', 'perdido', 'cancelado', 'finalizado'];
      const escalados = (w.escalados_para_humano || [])
        .filter(c => !RESOLVIDOS.includes(String(c.status || '').toLowerCase()))
        .filter(c => emDias(c.ultima_atividade_at) <= -1);
      if (escalados.length) {
        add({
          chave: 'whatsapp:escalado',
          severidade: SEV.URGENTE,
          titulo: `${escalados.length} ${escalados.length === 1 ? 'conversa escalada' : 'conversas escaladas'} sem retorno`,
          itens: escalados.slice(0, 5).map(c => `${String(c.status || '').replace(/_/g, ' ')}${c.tipo_calculo ? ' · ' + c.tipo_calculo : ''}`)
        });
      }
    }),

    /* ---- assinaturas ---- */
    fontes.peritos && regra(alertas, falhas, 'assinaturas', async () => {
      const a = await negocios.peritos.assinaturas(2);
      const cancel = (a.eventos || []).filter(e => e.tipo === 'cancelou');
      /* dedupe por e-mail: a base registra o mesmo cancelamento várias vezes,
         e contar bruto inflaria o número num alerta */
      const emails = [...new Set(cancel.map(c => c.email))];
      if (emails.length) {
        add({
          chave: 'assinatura:cancelamento',
          severidade: SEV.ATENCAO,
          titulo: `${emails.length} ${emails.length === 1 ? 'cancelamento' : 'cancelamentos'} de assinatura em 48h`,
          itens: emails.slice(0, 5).map(e => curto(e, 34))
        });
      }
      const novos = (a.eventos || []).filter(e => e.tipo === 'assinou').length;
      if (novos) add({ chave: 'assinatura:novos', severidade: SEV.INFO, titulo: `${novos} ${novos === 1 ? 'assinatura nova' : 'assinaturas novas'} em 48h`, itens: [] });
    })
  ].filter(Boolean));

  alertas.sort((x, y) => ORDEM[x.severidade] - ORDEM[y.severidade]);
  return { alertas, falhas, fontes };
}

/* Texto plano — serve para e-mail e para log. */
function resumir({ alertas, falhas }) {
  if (!alertas.length) return falhas.length ? `Nada urgente. (não consegui checar: ${falhas.join('; ')})` : 'Nada pedindo atenção agora.';
  const linhas = alertas.map(a => {
    const marca = a.severidade === SEV.URGENTE ? '!' : a.severidade === SEV.ATENCAO ? '·' : ' ';
    const det = (a.itens && a.itens.length) ? ' — ' + a.itens.join('; ') : '';
    return `${marca} ${a.titulo}${det}`;
  });
  if (falhas.length) linhas.push(`  (não consegui checar: ${falhas.join('; ')})`);
  return linhas.join('\n');
}

/* WhatsApp é outra mídia, não o mesmo texto num campo diferente.
   Numa tela de celular, linha longa com ponto e vírgula vira parede: a
   pessoa abre, não acha o número, e fecha. Aqui cada item ganha a própria
   linha, o título vai em negrito e a severidade vira cor — que é o que o
   olho pega antes de ler. */
function resumirWhatsapp({ alertas, falhas }) {
  if (!alertas.length) {
    return falhas.length
      ? `✅ Nada urgente agora.\n\n_Não consegui checar: ${falhas.join('; ')}_`
      : '✅ Nada pedindo atenção agora.';
  }
  const icone = { urgente: '🔴', atencao: '🟡', info: '🔵' };
  const blocos = alertas.map(a => {
    const cabeca = `${icone[a.severidade] || '•'} *${a.titulo}*`;
    if (!a.itens || !a.itens.length) return cabeca;
    return cabeca + '\n' + a.itens.map(i => `      ${i}`).join('\n');
  });
  let txt = blocos.join('\n\n');
  if (falhas.length) txt += `\n\n_Não consegui checar: ${falhas.join('; ')}_`;
  return txt;
}

module.exports = { avaliar, resumir, resumirWhatsapp, SEV };
