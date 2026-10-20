/* NEXUS → tela: o que a voz muda nos painéis (20/10/2026).

   "Mostra o tráfego da última semana", "põe o financeiro de setembro": a
   ferramenta só anota o período em ctx.painel; o /api/chat devolve isso no
   fim da resposta (data.painel) e a tela (js/painel.js, definirPeriodo)
   recarrega financeiro e tráfego naquele período. Ao recarregar a página,
   volta ao mês corrente: o padrão pedido pelo dono é sempre o mês.        */

const valida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

const FERRAMENTAS = [
  {
    def: {
      name: 'painel_periodo',
      description: 'Muda o período dos painéis de financeiro e tráfego na tela do Jarvis. Use quando ele pedir para MOSTRAR ou PÔR na tela um período ("mostra o tráfego da última semana", "põe o financeiro de setembro", "volta pro mês"). Sem de/ate volta ao mês corrente. Para RESPONDER números do período por voz, use também financeiro_caixa ou trafego_meta.',
      input_schema: {
        type: 'object',
        properties: {
          de: { type: 'string', description: 'AAAA-MM-DD' },
          ate: { type: 'string', description: 'AAAA-MM-DD' },
          rotulo: { type: 'string', description: 'Como aparece na tela, curto: "7 dias", "setembro", "mês anterior".' },
        },
      },
    },
    run: async (i, ctx) => {
      if ((i.de && !valida(i.de)) || (i.ate && !valida(i.ate))) return { erro: 'datas em AAAA-MM-DD' };
      const painel = i.de ? { de: i.de, ate: i.ate || i.de, rotulo: String(i.rotulo || '').slice(0, 24) || null } : { mes: true };
      if (ctx) ctx.painel = painel;
      return { ok: true, painel };
    },
  },
];

module.exports = { FERRAMENTAS };
