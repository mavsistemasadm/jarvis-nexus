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

  const pessoais = (() => { try { const t = require('./tarefas-pessoais'); return t.disponivel() ? t : null; } catch { return null; } })();

  const tarefas = {
    hoje_contas_agenda_whatsapp: () => negocios.executar('resumo_do_dia', {}),
    // As tarefas e lembretes que ele mesmo pediu (20/10/2026), com as atrasadas.
    tarefas_pessoais_hoje: pessoais ? () => pessoais.deHoje() : null,
    // Antecipação de ontem (19/10/2026): o custo não aparece em lugar nenhum
    // sem isto, e em julho/2026 somou R$ 7.572 sem o dono saber.
    antecipacoes_ontem: fin && fin.configurado && fin.configurado() ? () => {
      const f = ferramenta(fin.FERRAMENTAS, 'financeiro_antecipacoes');
      return f ? f({ de: ontem, ate: ontem }) : null;
    } : null,
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
    // O que os automáticos mandam hoje (19/10/2026): pedido do dono, "hoje serão
    // enviadas 5 mensagens para recuperar assinaturas, um email disso para a base X".
    programado_hoje: process.env.JARVIS_NEXUS_KEY ? async () => {
      const r = await fetch('https://www.nexuspericial.com.br/api/jarvis/agenda-do-dia', { headers: { 'x-jarvis-key': process.env.JARVIS_NEXUS_KEY } });
      const d = await r.json().catch(() => ({ erro: `resposta inválida (${r.status})` }));
      if (!r.ok && !d.erro) d.erro = `Nexus respondeu ${r.status}`;
      return d;
    } : null,
    reconquista: (() => { try { const r = require('./reconquista'); return r.disponivel() ? () => r.painel() : null; } catch { return null; } })(),
    // O relatório da MH (19/10/2026): comercial, agente e régua do orçamento.
    mh_comercial: panoramas && ferramenta(panoramas.FERRAMENTAS, 'mh_comercial') ? () => ferramenta(panoramas.FERRAMENTAS, 'mh_comercial')({}) : null,
    // A meta do mês por empresa (Financeiro, Cadastros, Empresas).
    metas_do_mes: fin && fin.configurado && fin.configurado() && ferramenta(fin.FERRAMENTAS, 'financeiro_metas') ? () => ferramenta(fin.FERRAMENTAS, 'financeiro_metas')({}) : null,
    // O Google Ads de ontem, todo dia (as duas contas: Nexus e MH Cálculos).
    google_ontem: googleAds && googleAds.disponivel() ? () => googleAds.desempenho({ nivel: 'campanha', de: ontem, ate: ontem }) : null,
    // A música: o Spotify está conectado e com aparelho aberto?
    spotify: () => require('../api/spotify').status(),
    // Qual relatório ele costuma ouvir primeiro.
    ordem_do_bom_dia: panoramas && panoramas.ordemPreferida ? () => panoramas.ordemPreferida() : null,
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

const REGRAS = `O BOM DIA (formato aprovado pelo Marlos em 19/10/2026, refaz o de 18/10).

COMO ACONTECE, NA CONVERSA:
A) Na abertura, depois do cumprimento, faça as DUAS perguntas juntas: que música para começar o dia, e qual relatório ele quer ouvir primeiro: Nexxus, MH ou Academy. Se ordem_do_bom_dia.ordem_de_costume existir, sugira ("começo pela MH, como sempre?"). Se spotify.conectado for false, NÃO pergunte a música: diga em meia frase que o Spotify ainda não está conectado. Se estiver conectado mas sem aparelho ativo, peça para abrir o Spotify no celular ou no computador.
B) Quando ele responder, chame bom_dia_ordem com a escolha, toque a música (tag do Spotify) e entregue PRIMEIRO "o que precisa de você hoje", em no máximo 3 frases, valendo para as três empresas: as tarefas pessoais de hoje (tarefas_pessoais_hoje, as atrasadas primeiro), prazos e compromissos de hoje e amanhã, contas que vencem hoje e as atrasadas, ações esperando o "sim" dele, quem espera resposta, e na reconquista quem precisa dele (precisamDoMarlos ou oferta para liberar à mão). Se ele não escolher, comece pela MH.
C) Depois o relatório escolhido (abaixo), e termine perguntando "quer a próxima?" com o nome da seguinte. Ao fim dos três (ou quando ele disser que basta), feche com UMA recomendação: a coisa mais importante do dia, e por quê.

OS TRÊS RELATÓRIOS, todos no mesmo esqueleto: a meta do mês (metas_do_mes: "a MH está em R$ X de R$ Y, Z%, faltam N dias"; sem meta cadastrada, diga em meia frase que dá para cadastrar no Financeiro em Cadastros, Empresas), o comercial, o tráfego e o que sai sozinho hoje.

MH Cálculos (mh_comercial, google_ontem da conta da MH):
- Comercial: orçamentos parados (quantos, quanto em R$, os mais antigos pelo nome), quem espera documento, cálculos fechados ontem e no mês com valor.
- O agente da MH: quantas pessoas escreveram ontem, contatos novos, orçamentos enviados, quem passou para ele e quem espera ele agora.
- Dinheiro: o que foi pago ontem e as cobranças vencidas.
- Tráfego: o Google Ads da MH ontem (gasto, cliques, conversões).
- Sai sozinho hoje: toques de orçamento no WhatsApp e lembretes por e-mail (regua_do_orcamento), e quantos responderam na semana.

Nexxus (nexus_ontem_e_hoje, antecipacoes_ontem, trafego_ontem, trafego_alertas, google_ontem da conta Nexus/Peritos, programado_hoje, reconquista):
- Dinheiro: se antecipacoes_ontem tiver quantidade maior que zero, comece por ela ("ontem você antecipou R$ X e a taxa foi R$ Y, Z%"); assinantes novos, upgrades, cancelamentos, o que entrou, checkouts abandonados para o Lucas recuperar.
- Cobrança e reconquista: quem atrasou, quem respondeu, quem voltou ou aceitou a condição de retorno. Se envioLigado for false, NÃO diga que mensagens foram enviadas.
- Tráfego: Meta e Google de ontem (gasto, cliques, compras), os alertas de trafego_alertas e o prazo próximo das pendências do diário de tráfego.
- Sai sozinho hoje (programado_hoje): e-mails agendados (assunto, para quem, quantas pessoas, a hora), esteiras, régua de cobrança (quantos avisos e quantos por WhatsApp), reconquista (se simulacao for true, "estão prontas mas o envio está desligado"), WhatsApp do diagnóstico.

Peritos Academy (academy):
- Alunos: novos, ativos, quem parou de estudar.
- Hoje: live ou evento, dúvidas sem resposta, desafios esperando correção.
- Sai sozinho hoje: e-mails e convites da Academy, se houver em programado_hoje.
- Tráfego: só se houver campanha da Academy rodando.

NA TELA: ao entregar o relatório da MH, chame mh_comercial (os orçamentos parados com nome, dias e valor aparecem num cartão). No tráfego do Nexxus, chame trafego_meta e trafego_google de ontem para a tabela aparecer. Na voz, só o destaque.

AÇÃO PRONTA: termine cada relatório com UMA ação que você pode fazer, quando houver uma clara, perguntando se ele quer ("tem 3 orçamentos parados há mais de 5 dias, quer que eu mande o lembrete agora?", "o conjunto X gastou R$ 80 sem vender, pauso?"). Só ofereça o que suas ferramentas fazem; o "sim" dele passa pela confirmação de sempre.

Se for segunda-feira, a semana passada (nexus_semana_passada, trafego_semana_passada, google_semana_passada) entra no relatório de cada empresa, em uma frase.
Regras:
- Cada relatório cabe em 60 a 90 segundos falados. Número arredondado, sem centavos.
- Fale o que MUDOU ou saiu do normal ("o dobro de ontem", "40% a mais sem vender"); o que é zero ou normal não é dito. Os detalhes (nomes, valores, listas) aparecem nos cartões da tela: na voz, só o destaque e "está na tela".
- Bloco vazio não é dito.
- Fonte com "erro" ou em NAO_CONFIGURADO: diga que não conseguiu verificar aquilo. Nunca diga que está vazio ou limpo sem ter olhado.
- O pixel do Meta subconta venda: venda real é a do nexus_ontem_e_hoje, que cobre ontem e a madrugada de hoje (cada venda tem a data: fale das de ontem).
- trafego_alertas é conta feita, não palpite: cada item de "alertas" entra no bloco de tráfego, uma frase cada, ANTES dos números de ontem (o de conta parada primeiro). Alerta do tipo "escalar" é boa notícia: diga como oportunidade, com o valor de hoje e o sugerido. Lista vazia: não fale de alerta nenhum. "falhas": diga que não conseguiu verificar aquela plataforma. Se a pendência do diário explicar o alerta (pausa ou troca de propósito), diga isso junto em vez de alarmar.
- Campanha do Meta com rodando=false que gastou ontem foi desligada ontem: procure a troca no diário; não diga que está parada sem explicação.
- Campanha pausada ou sem gasto NÃO é alarme por si: confira nas pendências do diário de tráfego se foi pausada de propósito (troca de campanha, teste novo em análise). Só é alarme campanha que deveria rodar e não roda, ou anúncio reprovado.
- Sem travessão no texto.`;

const FORMATO = {
  voz: 'Saída falada: frases corridas, sem lista, sem markdown.',
  // No WhatsApp não há pergunta: ele não falou com o Jarvis até as 9h, então
  // vai o essencial das três empresas de uma vez (19/10/2026).
  whatsapp: 'Saída para WhatsApp, lida no celular às 9h porque ele ainda não falou com o Jarvis hoje. NÃO faça as perguntas da abertura. Comece com "Bom dia, Marlos!" e o que precisa dele hoje em duas linhas (as tarefas pessoais de hoje entram aqui, pelo nome). Depois três blocos curtos, *MH*, *Nexxus* e *Academy* (título em negrito do WhatsApp), cada um com a meta do mês e as duas coisas mais importantes. Sem #, sem tabela, sem travessão. Termine com a recomendação do dia. No máximo uns 1.100 caracteres.',
};

/** O bloco que entra no sistema da primeira conversa do dia (chat por voz). */
async function blocoParaChat() {
  const dados = await coletar();
  return `\n\n== PRIMEIRA CONVERSA DO DIA: O BOM DIA ==\nEsta é a primeira interação de hoje. Siga o COMO ACONTECE abaixo: a abertura faz as duas perguntas (música e qual relatório primeiro) e o bom dia vem quando ele responder. Se ele já pediu outra coisa, responda e depois ofereça o bom dia.\n${REGRAS}\n${FORMATO.voz}\n\nDADOS REAIS DE AGORA:\n${dadosComoTexto(dados)}`;
}

/** Uma chamada ao modelo que devolve só o texto. Também é a do fechamento
    do dia (lib/fechamento.js). */
async function escrever(system, conteudo) {
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
      system,
      messages: [{ role: 'user', content: conteudo }],
    }),
  });
  const data = await r.json();
  if (!r.ok || !Array.isArray(data.content)) throw new Error(`modelo ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const texto = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!texto) throw new Error('modelo devolveu texto vazio');
  return texto;
}

/** O texto pronto, escrito pelo modelo, para mandar no WhatsApp. */
async function textoParaWhatsapp() {
  const dados = await coletar();
  const texto = await escrever(
    `Você é o Jarvis, assistente pessoal do Marlos Henrique (dono do Grupo MH: Nexus, Peritos Academy, Opera, MH Cálculos). Escreve o bom dia dele.\n${REGRAS}\n${FORMATO.whatsapp}`,
    `Dados reais de agora:\n\n${dadosComoTexto(dados)}\n\nEscreva o bom dia.`,
  );
  return { texto, dados };
}

module.exports = { coletar, blocoParaChat, textoParaWhatsapp, escrever, dadosComoTexto, tentar, REGRAS };
