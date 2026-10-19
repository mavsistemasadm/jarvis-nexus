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
/* Alvo: o anúncio (`anuncioId`), senão o conjunto (`conjuntoId`, ABO), senão a campanha. */
const alvo = (e) => (e.anuncioId ? { anuncioId: e.anuncioId } : e.conjuntoId ? { conjuntoId: e.conjuntoId } : { campanhaId: e.campanhaId });
acoes.registrar('trafego_pausar', (e) => acaoMeta({ acao: 'pausar', ...alvo(e) }));
acoes.registrar('trafego_ativar', (e) => acaoMeta({ acao: 'ativar', ...alvo(e) }));
acoes.registrar('trafego_orcamento', (e) => acaoMeta({ acao: 'orcamento', ...alvo(e), valorDia: e.valorDia }));
acoes.registrar('trafego_duplicar', (e) => acaoMeta({ acao: 'duplicar', conjuntoId: e.conjuntoId, valorDia: e.valorDia }));
acoes.registrar('trafego_excluir_posicionamento', (e) => acaoMeta({ acao: 'excluir_posicionamento', conjuntoId: e.conjuntoId, plataforma: e.plataforma, posicao: e.posicao }));
const qual = (i) => (i.anuncioId ? `o anúncio "${i.nome}"` : i.conjuntoId ? `o conjunto "${i.nome}"` : `a campanha "${i.nome}"`);
const reais = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ymdSP(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

const FERRAMENTAS = [
  {
    def: {
      name: 'trafego_meta',
      description: 'Meta Ads (Facebook/Instagram) num período: gasto, impressões, alcance, frequência, CPM, cliques, CTR, CPC, leads, início de checkout, compras e receita segundo o pixel, CPA, ROAS, gancho do vídeo (ganchoPct: quem passou dos 3 s sobre impressões) e retenção (retencaoPct: ThruPlay sobre quem passou dos 3 s), e se está rodando. nivel="campanha" (padrão), "conjunto" (no teste ABO cada conjunto é um criativo, com orçamento próprio em orcamentoDia) ou "anuncio". campanhaId/conjuntoId restringem. criativo=true (com nivel="anuncio") traz o texto, o título e a chamada de cada anúncio. quebra divide o recorte por "posicionamento", "idade", "genero" ou "horario" (é o que mostra onde cortar). O pixel subconta venda: confira as vendas reais com nexus_panorama.',
      input_schema: {
        type: 'object',
        properties: {
          nivel: { type: 'string', enum: ['campanha', 'conjunto', 'anuncio'], description: 'Padrão campanha.' },
          campanhaId: { type: 'string', description: 'Só esta campanha (id de trafego_meta).' },
          conjuntoId: { type: 'string', description: 'Só este conjunto.' },
          criativo: { type: 'boolean', description: 'Com nivel="anuncio": traz o texto do anúncio.' },
          quebra: { type: 'string', enum: ['posicionamento', 'idade', 'genero', 'horario'], description: 'Divide o recorte (conta, campanha ou conjunto) por esta dimensão.' },
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
      const nivel = ['conjunto', 'anuncio'].includes(i.nivel) ? i.nivel : null;
      const quebra = ['posicionamento', 'idade', 'genero', 'horario'].includes(i.quebra) ? i.quebra : null;
      const extra = (nivel ? `&nivel=${nivel}` : '') + (i.campanhaId ? `&campanhaId=${encodeURIComponent(i.campanhaId)}` : '')
        + (i.conjuntoId ? `&conjuntoId=${encodeURIComponent(i.conjuntoId)}` : '')
        + (quebra ? `&quebra=${quebra}` : '') + (i.criativo && nivel === 'anuncio' ? '&criativo=1' : '');
      const r = await fetch(`${URL_NEXUS}/api/admin/ads/meta-desempenho?de=${de}&ate=${ate}${extra}`, { headers: { 'x-jarvis-key': chave } });
      const d = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
      if (!r.ok && !d.erro) d.erro = `Nexus respondeu ${r.status}`;
      // Só o que gastou ou está rodando: parado sem gasto é ruído na voz.
      if (Array.isArray(d.fatias)) d.fatias = d.fatias.slice(0, 30);
      for (const k of ['campanhas', 'conjuntos', 'anuncios']) {
        if (Array.isArray(d[k])) d[k] = d[k].filter(c => c.rodando || c.gasto > 0).sort((a, b) => b.gasto - a.gasto).slice(0, 30);
      }
      return { periodo: { de, ate }, ...d, nota: 'Números do pixel. Venda real no banco: nexus_panorama.' };
    },
  },
  {
    def: {
      name: 'trafego_pausar',
      description: 'PROPÕE pausar uma campanha do Meta, um conjunto (conjuntoId, ex.: o criativo que perde no teste ABO) ou um anúncio só dentro do conjunto (anuncioId). Pegue o id e o nome em trafego_meta. Pausar se desfaz ativando.',
      input_schema: { type: 'object', properties: { campanhaId: { type: 'string' }, conjuntoId: { type: 'string' }, anuncioId: { type: 'string' }, nome: { type: 'string' } }, required: ['nome'] },
    },
    run: (i, ctx) => acoes.propor('trafego_pausar', alvo(i), `Pausar ${qual(i)} no Meta`, ctx),
  },
  {
    def: {
      name: 'trafego_ativar',
      description: 'PROPÕE ativar (voltar a rodar) uma campanha, um conjunto (conjuntoId) ou um anúncio (anuncioId) do Meta que está pausado. Também é o que liga o conjunto criado por trafego_duplicar.',
      input_schema: { type: 'object', properties: { campanhaId: { type: 'string' }, conjuntoId: { type: 'string' }, anuncioId: { type: 'string' }, nome: { type: 'string' } }, required: ['nome'] },
    },
    run: (i, ctx) => acoes.propor('trafego_ativar', alvo(i), `Ativar ${qual(i)} no Meta`, ctx),
  },
  {
    def: {
      name: 'trafego_orcamento',
      description: 'PROPÕE mudar o orçamento diário, em reais, de uma campanha (CBO, orçamento na campanha) ou de um conjunto (conjuntoId; ABO, orçamento em cada conjunto, como no teste de criativos). No máximo 3 vezes o atual numa mudança. Diga o valor atual e o novo no resumo.',
      input_schema: {
        type: 'object',
        properties: { campanhaId: { type: 'string' }, conjuntoId: { type: 'string' }, nome: { type: 'string' }, valorDia: { type: 'number' }, valorAtual: { type: 'number' } },
        required: ['nome', 'valorDia'],
      },
    },
    run: (i, ctx) => acoes.propor('trafego_orcamento', { ...alvo(i), valorDia: i.valorDia },
      `Orçamento diário d${i.conjuntoId ? 'o conjunto' : 'a campanha'} "${i.nome}": ${i.valorAtual ? `de ${reais(i.valorAtual)} ` : ''}para ${reais(i.valorDia)}`, ctx),
  },
  {
    def: {
      name: 'trafego_duplicar',
      description: 'PROPÕE duplicar um conjunto do Meta que está ganhando (escala horizontal: um conjunto novo com os mesmos anúncios e público, sem mexer no que já aprendeu). A cópia nasce PAUSADA, com o nome terminando em [ESCALA], e com o orçamento de origem ou valorDia (até 3x o de origem). Depois de criada, ligar é trafego_ativar com o conjuntoNovoId.',
      input_schema: { type: 'object', properties: { conjuntoId: { type: 'string' }, nome: { type: 'string' }, valorDia: { type: 'number' } }, required: ['conjuntoId', 'nome'] },
    },
    run: (i, ctx) => acoes.propor('trafego_duplicar', { conjuntoId: i.conjuntoId, valorDia: i.valorDia },
      `Duplicar o conjunto "${i.nome}" no Meta (a cópia nasce pausada${i.valorDia ? `, com ${reais(i.valorDia)} por dia` : ', com o mesmo orçamento'})`, ctx),
  },
  {
    def: {
      name: 'trafego_excluir_posicionamento',
      description: 'PROPÕE tirar um posicionamento de um conjunto do Meta (ex.: plataforma "instagram", posicao "story"; sem posicao tira a plataforma inteira). Use quando trafego_meta com quebra="posicionamento" mostrar um lugar que gasta e não converte. REINICIA o aprendizado do conjunto: diga isso no resumo. Só funciona com posicionamento manual; no automático (Advantage+) a ação é recusada e o caminho é o Gerenciador.',
      input_schema: {
        type: 'object',
        properties: {
          conjuntoId: { type: 'string' }, nome: { type: 'string' },
          plataforma: { type: 'string', enum: ['facebook', 'instagram', 'audience_network', 'messenger'] },
          posicao: { type: 'string', description: 'Como vem na quebra: feed, story, reels, marketplace, video_feeds, search, explore, an_classic...' },
        },
        required: ['conjuntoId', 'nome', 'plataforma'],
      },
    },
    run: (i, ctx) => acoes.propor('trafego_excluir_posicionamento', { conjuntoId: i.conjuntoId, plataforma: i.plataforma, posicao: i.posicao },
      `Tirar ${i.posicao ? `${i.plataforma} ${i.posicao}` : `todo o ${i.plataforma}`} do conjunto "${i.nome}" no Meta. O conjunto volta para o aprendizado.`, ctx),
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.JARVIS_NEXUS_KEY };
