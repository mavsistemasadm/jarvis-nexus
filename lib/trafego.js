/* ══════════════════════════════════════════════════════
   TRÁFEGO PAGO NO META (17/10/2026)

   Lê o mesmo desempenho que a aba Tráfego do admin do Nexus mostra
   (/api/admin/ads/meta-desempenho, com x-jarvis-key): campanhas classificadas
   por produto, nenhuma escondida, gasto, cliques, leads, compras e receita
   que o PIXEL viu.

   ⚠️ O pixel não vê tudo (venda por WhatsApp, Pix pago depois). A venda real
   é a do banco: nexus_panorama. Compare os dois antes de concluir que uma
   campanha não vendeu.
   ══════════════════════════════════════════════════════ */
const URL_NEXUS = 'https://www.nexuspericial.com.br';
const acoes = require('./acoes');

/* Ação numa campanha pela rota do Nexus (/api/admin/ads/meta-acao), que só
   mexe em campanha, nunca cria nem apaga, e recusa orçamento acima de 3x o
   atual. Do lado de cá, toda ação propõe e espera o sim (lib/acoes.js). */
async function acaoMeta(corpo) {
  const chave = process.env.JARVIS_NEXUS_KEY;
  if (!chave) return { erro: 'JARVIS_NEXUS_KEY não configurada' };
  const r = await fetch(`${URL_NEXUS}/api/admin/ads/meta-acao`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis-key': chave }, body: JSON.stringify(corpo),
  });
  const d = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
  if (!r.ok && !d.erro) d.erro = `Nexus respondeu ${r.status}`;
  return d;
}
acoes.registrar('trafego_pausar', (e) => acaoMeta({ acao: 'pausar', campanhaId: e.campanhaId }));
acoes.registrar('trafego_ativar', (e) => acaoMeta({ acao: 'ativar', campanhaId: e.campanhaId }));
acoes.registrar('trafego_orcamento', (e) => acaoMeta({ acao: 'orcamento', campanhaId: e.campanhaId, valorDia: e.valorDia }));
const reais = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ymdSP(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

const FERRAMENTAS = [
  {
    def: {
      name: 'trafego_meta',
      description: 'Campanhas do Meta Ads (Facebook/Instagram) num período: gasto, impressões, cliques, CTR, CPC, leads, início de checkout, compras e receita segundo o pixel, CPA e ROAS, por campanha e produto, e se está rodando. Para "como está o tráfego", "quanto gastei em anúncio", "qual campanha está indo mal". O pixel subconta venda: confira as vendas reais com nexus_panorama.',
      input_schema: {
        type: 'object',
        properties: {
          dias: { type: 'number', description: 'Últimos N dias (padrão 7), em dias de Brasília. Ignorado se de/ate vierem.' },
          de: { type: 'string', description: 'AAAA-MM-DD' },
          ate: { type: 'string', description: 'AAAA-MM-DD' },
        },
      },
    },
    run: async (i) => {
      const chave = process.env.JARVIS_NEXUS_KEY;
      if (!chave) return { erro: 'JARVIS_NEXUS_KEY não configurada' };
      const hoje = new Date();
      const ate = i.ate || ymdSP(hoje);
      const de = i.de || ymdSP(new Date(hoje.getTime() - (Math.max(1, Number(i.dias) || 7) - 1) * 86400000));
      const r = await fetch(`${URL_NEXUS}/api/admin/ads/meta-desempenho?de=${de}&ate=${ate}`, { headers: { 'x-jarvis-key': chave } });
      const d = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
      if (!r.ok && !d.erro) d.erro = `Nexus respondeu ${r.status}`;
      if (Array.isArray(d.campanhas)) {
        // Só o que gastou ou está rodando: campanha parada sem gasto é ruído na voz.
        d.campanhas = d.campanhas.filter(c => c.rodando || c.gasto > 0)
          .sort((a, b) => b.gasto - a.gasto).slice(0, 25);
      }
      return { periodo: { de, ate }, ...d, nota: 'Números do pixel. Venda real no banco: nexus_panorama.' };
    },
  },
  {
    def: {
      name: 'trafego_pausar',
      description: 'PROPÕE pausar uma campanha do Meta. Pegue o id e o nome em trafego_meta. Pausar se desfaz ativando.',
      input_schema: { type: 'object', properties: { campanhaId: { type: 'string' }, nome: { type: 'string' } }, required: ['campanhaId', 'nome'] },
    },
    run: (i, ctx) => acoes.propor('trafego_pausar', { campanhaId: i.campanhaId }, `Pausar a campanha "${i.nome}" no Meta`, ctx),
  },
  {
    def: {
      name: 'trafego_ativar',
      description: 'PROPÕE ativar (voltar a rodar) uma campanha do Meta pausada.',
      input_schema: { type: 'object', properties: { campanhaId: { type: 'string' }, nome: { type: 'string' } }, required: ['campanhaId', 'nome'] },
    },
    run: (i, ctx) => acoes.propor('trafego_ativar', { campanhaId: i.campanhaId }, `Ativar a campanha "${i.nome}" no Meta`, ctx),
  },
  {
    def: {
      name: 'trafego_orcamento',
      description: 'PROPÕE mudar o orçamento diário de uma campanha do Meta, em reais. Só funciona em campanha com orçamento próprio, e no máximo 3 vezes o atual numa mudança. Diga o valor atual e o novo no resumo.',
      input_schema: {
        type: 'object',
        properties: { campanhaId: { type: 'string' }, nome: { type: 'string' }, valorDia: { type: 'number' }, valorAtual: { type: 'number' } },
        required: ['campanhaId', 'nome', 'valorDia'],
      },
    },
    run: (i, ctx) => acoes.propor('trafego_orcamento', { campanhaId: i.campanhaId, valorDia: i.valorDia },
      `Orçamento diário da campanha "${i.nome}": ${i.valorAtual ? `de ${reais(i.valorAtual)} ` : ''}para ${reais(i.valorDia)}`, ctx),
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.JARVIS_NEXUS_KEY };
