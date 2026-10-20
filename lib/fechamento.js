/* NEXUS → fechamento: o fim do dia (20/10/2026).

   O par do bom dia. O vigia das 16h só avisa o que está errado; isto fecha o
   dia: o que foi feito, o que ficou, o que vem amanhã e uma prioridade.

     1. feito hoje: tarefas pessoais concluídas e o que o Jarvis gravou com o
        "sim" dele (diário de ações)
     2. ficou: tarefas de hoje ainda abertas, ações esperando o "sim", e o que
        o vigia acha (contas, quem espera resposta, assinaturas)
     3. amanhã: tarefas e lembretes, compromissos e prazos do Opera
     4. o dia em números: vendas do Nexus e o comercial da MH, uma linha
     5. a prioridade de amanhã cedo

   Chega no WhatsApp às 18h30 dos dias úteis (/api/fim-do-dia), ou na hora
   em que ele pedir "fecha meu dia" (ferramenta fechamento_do_dia). Pedido na
   conversa grava a mesma marca, e o das 18h30 fica calado.

   ⚠️ Mesma regra do bom dia: fonte que falhou não vira "tudo limpo".       */

const briefing = require('./briefing');
const negocios = require('./negocios');

const ymdSP = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const marca = () => `fim-do-dia:${ymdSP(new Date())}`;

function ferramenta(lista, nome) {
  const f = (lista || []).find((x) => x.def && x.def.name === nome);
  return f ? (input) => f.run(input || {}) : null;
}

async function coletar() {
  // ⚠️ require com o caminho escrito: a Vercel só empacota o que enxerga.
  // Com require(variável) o arquivo fica fora do deploy (20/10/2026).
  const pessoais = (() => { try { return require('./tarefas-pessoais'); } catch { return null; } })();
  const acoes = (() => { try { return require('./acoes'); } catch { return null; } })();
  const vigia = (() => { try { return require('./vigia'); } catch { return null; } })();
  const panoramas = (() => { try { return require('./panoramas'); } catch { return null; } })();
  const temPessoais = pessoais && pessoais.disponivel();
  const temAcoes = acoes && acoes.disponivel();
  const nexus = panoramas && ferramenta(panoramas.FERRAMENTAS, 'nexus_panorama');
  const mh = panoramas && ferramenta(panoramas.FERRAMENTAS, 'mh_comercial');
  const hoje = ymdSP(new Date());

  const fontes = {
    tarefas_feitas_hoje: temPessoais ? () => pessoais.feitasHoje() : null,
    tarefas_que_ficaram: temPessoais ? () => pessoais.deHoje() : null,
    tarefas_de_amanha: temPessoais ? () => pessoais.deAmanha() : null,
    // o diário de ações cobre 24h; fica só o que é de hoje em Brasília
    jarvis_gravou_hoje: temAcoes ? async () => {
      const { executadas } = await acoes.recentes(1);
      return (executadas || []).filter((a) => ymdSP(new Date(a.criada_em)) === hoje).map(({ resumo }) => resumo);
    } : null,
    acoes_esperando_sim: temAcoes ? () => acoes.pendentesRecentes() : null,
    // dias: 2 = hoje e amanhã; os itens trazem a data
    agenda_hoje_e_amanha: () => negocios.executar('agenda_prazos', { dias: 2 }),
    vigia: vigia ? async () => vigia.resumir(await vigia.avaliar()) : null,
    nexus_hoje: nexus ? () => nexus({ dias: 1 }) : null,
    mh_comercial: mh ? () => mh({}) : null,
  };

  const dados = { hoje, dia_da_semana: new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }) };
  const nomes = Object.keys(fontes).filter((k) => fontes[k]);
  const resultados = await Promise.all(nomes.map((k) => briefing.tentar(fontes[k])));
  nomes.forEach((k, i) => { dados[k] = resultados[i]; });
  const nao = Object.keys(fontes).filter((k) => !fontes[k]);
  if (nao.length) dados.NAO_CONFIGURADO = nao;
  return dados;
}

const REGRAS = `O FECHAMENTO DO DIA (o par do bom dia). Quatro partes, nesta ordem, cada uma só se tiver conteúdo:
1. Feito hoje: tarefas_feitas_hoje e jarvis_gravou_hoje, agrupado ("3 lançamentos classificados", não um por um). Reconheça em meia frase, sem bajular.
2. Ficou: tarefas_que_ficaram (pelo nome, as atrasadas primeiro), acoes_esperando_sim, e do vigia só o que pede ação dele (contas vencidas ou vencendo, quem espera resposta, prazo perto).
3. Amanhã: tarefas_de_amanha (com a hora do lembrete) e os compromissos e prazos de amanhã em agenda_hoje_e_amanha. Prazo fatal, audiência e entrega de laudo sempre entram.
4. O dia em números, uma linha: vendas e o que entrou no Nexus hoje (nexus_hoje, só as de hoje), e na MH os cálculos fechados ou orçamentos novos de hoje (mh_comercial). Zero ou normal não é dito.
Feche com UMA prioridade para amanhã cedo, e por quê, em uma frase.
Regras:
- Fonte com "erro" ou em NAO_CONFIGURADO: diga que não conseguiu verificar aquilo. Nunca diga que está vazio sem ter olhado.
- Número arredondado, sem centavos. Sem travessão.
- Dia sem nada em uma parte: pule a parte, não diga "nada".`;

const FORMATO_WHATSAPP = 'Saída para WhatsApp, lida no celular no fim do dia. Comece com "*Fechando o dia*". Blocos curtos com título em negrito do WhatsApp: *Feito*, *Ficou*, *Amanhã*, e a linha dos números. Itens com "•". Sem #, sem tabela, sem travessão. Ele não responde por aqui: não faça pergunta, termine com a prioridade de amanhã. No máximo uns 900 caracteres.';

async function textoParaWhatsapp() {
  const dados = await coletar();
  const texto = await briefing.escrever(
    `Você é o Jarvis, assistente pessoal do Marlos Henrique (dono do Grupo MH: Nexus, Peritos Academy, Opera, MH Cálculos). Escreve o fechamento do dia dele.\n${REGRAS}\n${FORMATO_WHATSAPP}`,
    `Dados reais de agora:\n\n${briefing.dadosComoTexto(dados)}\n\nEscreva o fechamento do dia.`,
  );
  return { texto, dados };
}

/* grava a marca do dia: o das 18h30 não repete o que ele já ouviu */
async function marcarFeito(resumo) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/alertas`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ hash: marca(), resumo: String(resumo || '').slice(0, 2000), quantidade: 1, entregue_em: new Date().toISOString() }),
  }).catch(() => {});
}

const FERRAMENTAS = [
  {
    def: {
      name: 'fechamento_do_dia',
      description: 'O fechamento do dia: o que foi feito, o que ficou, o que vem amanhã e a prioridade. Use quando ele pedir "fecha meu dia", "como foi o dia?", "o que ficou pra amanhã?". Devolve os dados e as regras de como falar. Na voz, frases corridas, uns 60 segundos; os detalhes aparecem na tela. No fim, ofereça passar para amanhã as tarefas que ficaram (tarefa_atualizar).',
      input_schema: { type: 'object', properties: {} },
    },
    run: async () => {
      const dados = await coletar();
      await marcarFeito('pedido na conversa');
      return { regras: REGRAS, dados };
    },
  },
];

module.exports = { coletar, textoParaWhatsapp, marca, marcarFeito, FERRAMENTAS };
