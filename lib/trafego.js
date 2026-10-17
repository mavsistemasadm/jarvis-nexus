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
];

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.JARVIS_NEXUS_KEY };
