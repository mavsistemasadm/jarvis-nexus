/* NEXUS → briefing: o bom dia (18/10/2026).

   O que o Jarvis entrega na primeira conversa do dia e, às 8h, no WhatsApp.
   Formato aprovado pelo dono em 18/10/2026:

     1. abertura (bom dia, como está, a música: fica no chat, não aqui)
     2. o que precisa dele HOJE: prazos e compromissos, contas do dia e
        atrasadas, lançamentos esperando classificação, quem espera resposta
        no WhatsApp, ações do Jarvis esperando o "sim"
     3. o dinheiro de ontem: vendas do Nexus, o que entrou, checkouts
        abandonados para o Lucas
     4. tráfego: gasto de ontem, cliques, compras, anúncio parado ou
        reprovado, e os prazos do diário de tráfego
     5. Academy e Opera, SÓ se houver novidade
     6. uma recomendação: a coisa mais importante do dia
     Segunda-feira: o resumo da semana anterior junto.

   ⚠️ CABE EM UM MINUTO FALADO. Só entra o que mudou desde ontem ou pede ação
   hoje; bloco sem novidade não é dito. O detalhe vem quando ele pedir.

   ⚠️ FONTE QUE FALHOU NÃO VIRA "ESTÁ TUDO LIMPO". Cada coleta é isolada: o
   erro volta marcado, e as regras mandam dizer que não deu para verificar.
   Foi o defeito do resumo_do_dia em produção (o WhatsApp sem credencial
   saiu como "fila limpa", com sete pessoas esperando).                     */

const negocios = require('./negocios');

function ymdSP(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}
function diaDaSemanaSP(d) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(d);
}

// Corta o JSON de cada fonte: o briefing precisa do que importa, e um
// panorama inteiro de 30 KB só deixaria a resposta lenta e cara.
function enxuto(v, max = 7000) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > max ? s.slice(0, max) + '…(cortado)' : s;
}

async function tentar(fn) {
  try { return await fn(); }
  catch (e) { return { erro: String(e.message || e) }; }
}

function ferramenta(lista, nome) {
  const f = (lista || []).find((x) => x.def && x.def.name === nome);
  return f ? (input) => f.run(input || {}) : null;
}

/** O que ficou em aberto nas entradas mais recentes do diário de tráfego.
    Oito entradas, não três: num dia de muitas anotações, a troca de
    campanha de ontem caía fora e o bom dia chamava a pausa de "sem registro". */
async function pendenciasDoTrafego() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { erro: 'cérebro sem Supabase configurado' };
  const q = 'cerebro_secoes?projeto=eq.nexus-peritosacademy&arquivo=eq.docs/trafego/diario.md'
    + '&ordem=gte.1&ordem=lte.8&order=ordem.asc&select=titulo,conteudo';
  const r = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  if (!r.ok) return { erro: `cérebro ${r.status}` };
  const secoes = await r.json();
  return secoes.map((s) => {
    const i = s.conteudo.indexOf('O que ficou em aberto');
    return { entrada: s.titulo.split(' > ').pop(), em_aberto: (i >= 0 ? s.conteudo.slice(i) : s.conteudo).slice(0, 1200) };
  });
}

/** Busca tudo, em paralelo. Nunca lança: fonte em erro volta como `{erro}`. */
async function coletar() {
  const agora = new Date();
  const ontem = ymdSP(new Date(agora.getTime() - 86400000));
  const segunda = diaDaSemanaSP(agora).startsWith('segunda');

  const panoramas = (() => { try { return require('./panoramas'); } catch { return null; } })();
  const fin = (() => { try { return require('./financeiro-app'); } catch { return null; } })();
  const trafego = (() => { try { return require('./trafego'); } catch { return null; } })();
  const acoes = (() => { try { return require('./acoes'); } catch { return null; } })();
  const vigia = (() => { try { return require('./vigia'); } catch { return null; } })();
  const alertasTrafego = (() => { try { return require('./alertas-trafego'); } catch { return null; } })();
  const googleAds = (() => { try { return require('./google-ads'); } catch { return null; } })();

  const nexus = panoramas && ferramenta(panoramas.FERRAMENTAS, 'nexus_panorama');
  const opera = panoramas && ferramenta(panoramas.FERRAMENTAS, 'opera_panorama');
  const academy = panoramas && ferramenta(panoramas.FERRAMENTAS, 'academy_panorama');
  const conferencia = fin && fin.configurado && fin.configurado() && ferramenta(fin.FERRAMENTAS, 'financeiro_conferencia');
  const meta = trafego && trafego.disponivel() && ferramenta(trafego.FERRAMENTAS, 'trafego_meta');

  const tarefas = {
    hoje_contas_agenda_whatsapp: () => negocios.executar('resumo_do_dia', {}),
    conferencia_financeira: conferencia ? async () => {
      const d = await conferencia();
      // Para o bom dia basta a contagem e os maiores; a lista inteira é para a conferência.
      if (d && Array.isArray(d.itens)) {
        const maiores = [...d.itens].sort((a, b) => Math.abs(b.valor || 0) - Math.abs(a.valor || 0)).slice(0, 3)
          .map(({ favorecido, valor, data, tipo }) => ({ favorecido, valor, data, tipo }));
        return { total: d.total ?? d.itens.length, maiores };
      }
      return d;
    } : null,
    acoes_esperando_sim: acoes && acoes.disponivel() ? () => acoes.pendentesRecentes() : null,
    // ⚠️ dias: 2, e não 1. O panorama conta dias de Brasília A PARTIR DE HOJE:
    // com 1, às 8h ele trazia só a madrugada de hoje e o bom dia dizia "não
    // consegui confirmar as vendas de ontem". Com 2 vêm ontem e hoje; as
    // listas trazem a data de cada item.
    nexus_ontem_e_hoje: nexus ? () => nexus({ dias: 2 }) : null,
    opera: opera ? () => opera({ dias: 2 }) : null,
    academy: academy ? () => academy() : null,
    trafego_ontem: meta ? () => meta({ de: ontem, ate: ontem }) : null,
    trafego_pendencias_do_diario: () => pendenciasDoTrafego(),
    trafego_alertas: alertasTrafego ? () => alertasTrafego.avaliar() : null,
    vigia: vigia ? async () => vigia.resumir(await vigia.avaliar()) : null,
  };
  if (segunda) {
    if (nexus) tarefas.nexus_semana_passada = () => nexus({ dias: 7 });
    if (meta) tarefas.trafego_semana_passada = () => meta({ dias: 7 });
    if (googleAds && googleAds.disponivel()) tarefas.google_semana_passada = () => googleAds.desempenho({ nivel: 'campanha', dias: 7 });
  }

  const dados = { hoje: ymdSP(agora), dia_da_semana: diaDaSemanaSP(agora), ontem };
  const nomes = Object.keys(tarefas).filter((k) => tarefas[k]);
  const resultados = await Promise.all(nomes.map((k) => tentar(tarefas[k])));
  nomes.forEach((k, i) => { dados[k] = resultados[i]; });
  const nao = Object.keys(tarefas).filter((k) => !tarefas[k]);
  if (nao.length) dados.NAO_CONFIGURADO = nao;
  return dados;
}

function dadosComoTexto(dados) {
  return Object.entries(dados).map(([k, v]) => `### ${k}\n${enxuto(v)}`).join('\n\n');
}

const REGRAS = `O BOM DIA (formato aprovado pelo Marlos em 18/10/2026).
Ordem, pulando o bloco que não tiver novidade:
1) O que precisa dele HOJE: prazos e compromissos de hoje e amanhã, contas que vencem hoje e as atrasadas, quantos lançamentos esperam classificação (financeiro), quem espera resposta no WhatsApp, ações suas esperando o "sim" dele.
2) O dinheiro de ontem: assinantes novos, upgrades, cancelamentos, o que entrou no caixa, checkouts abandonados para o Lucas recuperar.
3) Tráfego: quanto gastou ontem, cliques, compras, e anúncio parado ou reprovado. Lembre o prazo que estiver próximo nas pendências do diário de tráfego (ex.: "o teste de criativos fecha em 25/10").
4) Academy e Opera: SÓ se houver novidade (live hoje, dúvida de aluno sem resposta, proposta parada, cobrança vencida).
5) Feche com UMA recomendação: a coisa mais importante do dia, e por quê, numa frase.
Se for segunda-feira, um resumo curto da semana anterior (vendas, gasto em anúncio, caixa) entra antes da recomendação.
Regras:
- Cabe em cerca de um minuto falado. Número arredondado, sem centavos. Nada de listar tudo: os dois ou três itens que importam, o resto "tem mais, se quiser".
- Só o que mudou desde ontem ou pede ação hoje. Bloco vazio não é dito.
- Fonte com "erro" ou em NAO_CONFIGURADO: diga que não conseguiu verificar aquilo. Nunca diga que está vazio ou limpo sem ter olhado.
- O pixel do Meta subconta venda: venda real é a do nexus_ontem_e_hoje, que cobre ontem e a madrugada de hoje (cada venda tem a data: fale das de ontem).
- trafego_alertas é conta feita, não palpite: cada item de "alertas" entra no bloco de tráfego, uma frase cada, ANTES dos números de ontem (o de conta parada primeiro). Lista vazia: não fale de alerta nenhum. "falhas": diga que não conseguiu verificar aquela plataforma. Se a pendência do diário explicar o alerta (pausa ou troca de propósito), diga isso junto em vez de alarmar.
- Campanha do Meta com rodando=false que gastou ontem foi desligada ontem: procure a troca no diário; não diga que está parada sem explicação.
- Campanha pausada ou sem gasto NÃO é alarme por si: confira nas pendências do diário de tráfego se foi pausada de propósito (troca de campanha, teste novo em análise). Só é alarme campanha que deveria rodar e não roda, ou anúncio reprovado.
- Sem travessão no texto.`;

const FORMATO = {
  voz: 'Saída falada: frases corridas, sem lista, sem markdown.',
  whatsapp: 'Saída para WhatsApp, lida no celular às 8h: comece com "Bom dia, Marlos!" e uma linha curta. Depois blocos curtos, cada um com o título em *negrito* do WhatsApp (*assim*) e uma ou duas linhas. Sem #, sem tabela, sem travessão. Termine com a recomendação do dia. No máximo uns 900 caracteres.',
};

/** O bloco que entra no sistema da primeira conversa do dia (chat por voz). */
async function blocoParaChat() {
  const dados = await coletar();
  return `\n\n== PRIMEIRA CONVERSA DO DIA: O BOM DIA ==\nEsta é a primeira interação de hoje. Depois da abertura (cumprimento, como ele está, a música), entregue o bom dia abaixo, e só então responda o que ele pediu.\n${REGRAS}\n${FORMATO.voz}\n\nDADOS REAIS DE AGORA:\n${dadosComoTexto(dados)}`;
}

/** O texto pronto, escrito pelo modelo, para mandar no WhatsApp. */
async function textoParaWhatsapp() {
  const dados = await coletar();
  const r = await fetch(process.env.ANTHROPIC_TEST_URL || 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: process.env.NEXUS_MODEL || 'claude-opus-5-5',
      max_tokens: 4096,
      output_config: { effort: process.env.NEXUS_EFFORT || 'low' },
      fallbacks: 'default',
      system: `Você é o Jarvis, assistente pessoal do Marlos Henrique (dono do Grupo MH: Nexus, Peritos Academy, Opera, MH Cálculos). Escreve o bom dia dele.\n${REGRAS}\n${FORMATO.whatsapp}`,
      messages: [{ role: 'user', content: `Dados reais de agora:\n\n${dadosComoTexto(dados)}\n\nEscreva o bom dia.` }],
    }),
  });
  const data = await r.json();
  if (!r.ok || !Array.isArray(data.content)) throw new Error(`modelo ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const texto = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!texto) throw new Error('modelo devolveu texto vazio');
  return { texto, dados };
}

module.exports = { coletar, blocoParaChat, textoParaWhatsapp, REGRAS };
