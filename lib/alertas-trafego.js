/* ══════════════════════════════════════════════════════
   ALERTAS DE TRÁFEGO NO BOM DIA (19/10/2026)

   Pedido do dono: em vez de um agente de tráfego separado, o bom dia confere
   sozinho poucas coisas no Meta e no Google e só fala se algo estiver
   errado. Motivo: a campanha formação de peritos ficou uma semana ativa e
   sem aparecer no Google (saldo vencido) e ninguém viu, porque ninguém
   perguntou.

   As regras são CONTA, não opinião do modelo: o modelo só diz em voz o que
   esta lista trouxe. Três:

   1. ATIVA E SEM GASTAR: campanha ligada com gasto zero nos últimos 3 dias
      completos. Se TODAS as ativas de uma conta do Google estão assim, vira
      um alerta só da conta (quase sempre é pagamento: a API no nível
      Explorer não lê faturamento, então é inferência e o texto diz isso).
   2. GASTANDO SEM VENDA (só Meta): R$ 150 ou mais em 7 dias sem compra e
      sem início de checkout no pixel. O Google fica de fora porque as
      conversões dele ainda não são confiáveis (docs/trafego/google-ads.md).
      Campanha de tráfego, remarketing de "encher" ou WhatsApp não vende
      pelo pixel por desenho, e não entra.
   4. VALE ESCALAR (Meta): onde mora o orçamento, ligado, 3 compras ou mais
      em 7 dias, CPA até o alvo (R$ 135, NEXUS_CPA_ALVO) e frequência abaixo
      de 2,5. Sugere +20%, que é o passo que não devolve ao aprendizado.
   3. CPC DISPAROU: custo por clique dos últimos 3 dias acima de 1,6 vez o
      dos 14 dias antes, com cliques suficientes nos dois lados para não
      ser ruído (5 e 20).

   Só entra campanha ligada AGORA. Pausada de propósito não é alarme, e o
   primeiro teste (19/10/2026) mostrou o ruído: as campanhas de 12/10, trocadas
   pelo teste ABO de 18/10, geravam alerta de CPC e de "sem venda".

   Fonte que falhou volta em `falhas`, nunca some: o bom dia diz que não
   conseguiu verificar.
   ══════════════════════════════════════════════════════ */

const DIA = 86400000;
const ymdSP = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const reais = (v) => `R$ ${Math.round(Number(v) || 0).toLocaleString('pt-BR')}`;
const cpc = (v) => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;

const SEM_VENDA_POR_DESENHO = /trafego|tráfego|whats|wpp|msg|mensag|engaj|enche|alcance|video|vídeo/i;
const MIN_SEM_VENDA = 150;
// Escalar (19/10/2026, pedido do dono: "queria poder escutar que pode aumentar
// a verba"). CPA alvo = o histórico da assinatura em padroes.md (R$ 135,13);
// acima disso crescer não é vantagem. Troca por env sem deploy de código.
const CPA_ALVO = Number(process.env.NEXUS_CPA_ALVO) || 135;
const MIN_COMPRAS_ESCALAR = 3;
const FREQ_MAX_ESCALAR = 2.5;
const FATOR_CPC = 1.6;

function janelas(agora = new Date()) {
  const dia = (n) => ymdSP(new Date(agora.getTime() - n * DIA));
  return {
    recente: { de: dia(3), ate: dia(1) },   // 3 dias completos
    semana: { de: dia(7), ate: dia(1) },
    base: { de: dia(17), ate: dia(4) },     // os 14 dias antes
  };
}

function cpcSubiu(recente, base) {
  if (!recente || !base) return null;
  if (recente.cliques < 5 || base.cliques < 20) return null;
  const agora = recente.gasto / recente.cliques;
  const antes = base.gasto / base.cliques;
  return antes > 0 && agora > antes * FATOR_CPC ? { agora, antes } : null;
}

async function doGoogle(j, alertas, falhas) {
  let g;
  try { g = require('./google-ads'); } catch { return; }
  if (!g.disponivel()) return;
  const [rec, base] = await Promise.all([
    g.desempenho({ nivel: 'campanha', ...j.recente }),
    g.desempenho({ nivel: 'campanha', ...j.base }),
  ]);
  if (rec.erro) { falhas.push(`Google Ads: ${rec.erro}`); return; }
  for (const conta of rec.contas || []) {
    if (conta.erro) { falhas.push(`Google Ads ${conta.conta}: ${conta.erro}`); continue; }
    const ativas = (conta.campanhas || []).filter(c => c.status === 'ativa');
    const paradas = ativas.filter(c => !c.gasto && !c.impressoes);
    if (ativas.length && paradas.length === ativas.length) {
      alertas.push({
        fonte: 'Google', conta: conta.conta, tipo: 'conta_parada',
        texto: `Google, ${conta.conta}: nenhuma das ${ativas.length} campanha(s) ativa(s) apareceu nos últimos 3 dias. Quase sempre é pagamento ou saldo da conta.`,
      });
    } else {
      for (const c of paradas) {
        alertas.push({ fonte: 'Google', conta: conta.conta, campanha: c.nome, tipo: 'sem_gasto',
          texto: `Google, ${conta.conta}: "${c.nome}" está ativa e não gastou nada nos últimos 3 dias.` });
      }
    }
    const daBase = ((base.contas || []).find(x => x.contaId === conta.contaId) || {}).campanhas || [];
    for (const c of ativas) {
      const s = cpcSubiu(c, daBase.find(x => x.id === c.id));
      if (s) alertas.push({ fonte: 'Google', conta: conta.conta, campanha: c.nome, tipo: 'cpc',
        texto: `Google, ${conta.conta}: o clique de "${c.nome}" subiu de ${cpc(s.antes)} para ${cpc(s.agora)} nos últimos 3 dias.` });
    }
  }
}

async function doMeta(j, alertas, falhas) {
  let t;
  try { t = require('./trafego'); } catch { return; }
  if (!t.disponivel()) return;
  const meta = t.FERRAMENTAS.find(f => f.def.name === 'trafego_meta');
  const [rec, sem, base, conj] = await Promise.all([
    meta.run(j.recente), meta.run(j.semana), meta.run(j.base), meta.run({ nivel: 'conjunto', ...j.semana }),
  ]);
  if (rec.erro) { falhas.push(`Meta: ${rec.erro}`); return; }
  // Só campanha rodando AGORA: a pausada de propósito (troca por outra,
  // como as de 12/10 trocadas pelo teste ABO de 18/10) não é alarme.
  for (const c of (rec.campanhas || []).filter(x => x.rodando)) {
    if (!c.gasto) alertas.push({ fonte: 'Meta', campanha: c.nome, tipo: 'sem_gasto',
      texto: `Meta: "${c.nome}" está ativa e não gastou nada nos últimos 3 dias.` });
    const s = cpcSubiu(c, ((base && base.campanhas) || []).find(x => x.id === c.id));
    if (s) alertas.push({ fonte: 'Meta', campanha: c.nome, tipo: 'cpc',
      texto: `Meta: o clique de "${c.nome}" subiu de ${cpc(s.antes)} para ${cpc(s.agora)} nos últimos 3 dias.` });
  }
  if (sem && !sem.erro) {
    for (const c of sem.campanhas || []) {
      if (c.rodando && c.gasto >= MIN_SEM_VENDA && !c.compras && !c.inicioCheckout && !SEM_VENDA_POR_DESENHO.test(c.nome || '')) {
        alertas.push({ fonte: 'Meta', campanha: c.nome, tipo: 'sem_venda',
          texto: `Meta: "${c.nome}" gastou ${reais(c.gasto)} em 7 dias sem nenhuma compra nem início de checkout no pixel. Confira as vendas reais antes de pausar.` });
      }
    }
  } else if (sem && sem.erro) falhas.push(`Meta (7 dias): ${sem.erro}`);

  // ESCALAR: onde mora o orçamento (campanha no CBO, conjunto no ABO), ligado,
  // vendendo dentro do CPA alvo e sem público cansado. Sugere +20%.
  const candidatos = [
    ...((sem && sem.campanhas) || []).filter(c => c.orcamentoDia).map(c => ({ ...c, oQue: 'campanha' })),
    ...((conj && conj.conjuntos) || []).filter(c => c.orcamentoDia).map(c => ({ ...c, oQue: 'conjunto' })),
  ];
  for (const c of candidatos) {
    if (!c.rodando || (c.compras || 0) < MIN_COMPRAS_ESCALAR || !c.cpa || c.cpa > CPA_ALVO) continue;
    if (c.frequencia && c.frequencia >= FREQ_MAX_ESCALAR) continue;
    const novo = Math.round(c.orcamentoDia * 1.2);
    alertas.push({ fonte: 'Meta', campanha: c.nome, tipo: 'escalar',
      texto: `Meta: ${c.oQue === 'conjunto' ? 'o conjunto' : 'a campanha'} "${c.nome}" fez ${c.compras} compras em 7 dias a ${reais(c.cpa)} cada (alvo ${reais(CPA_ALVO)}), frequência ${String(c.frequencia || 0).replace('.', ',')}. Vale subir o orçamento de ${reais(c.orcamentoDia)} para ${reais(novo)} por dia. Confira as vendas reais antes.` });
  }
}

/** { alertas: [{fonte, conta?, campanha?, tipo, texto}], falhas: [texto], periodo } */
async function avaliar(agora = new Date()) {
  const j = janelas(agora);
  const alertas = [], falhas = [];
  await Promise.all([
    doGoogle(j, alertas, falhas).catch(e => falhas.push(`Google Ads: ${e.message}`)),
    doMeta(j, alertas, falhas).catch(e => falhas.push(`Meta: ${e.message}`)),
  ]);
  return { periodo: j, alertas, falhas };
}

module.exports = { avaliar, janelas, cpcSubiu };
