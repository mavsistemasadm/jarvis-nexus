/* ══════════════════════════════════════════════════════
   O NEXUS E A ACADEMY POR INTEIRO (17/10/2026)

   Duas funções no banco de cada produto montam o panorama com as definições
   certas (o que é venda, o que é checkout abandonado, o que é aluno ativo):
   jarvis_nexus_panorama (repo nexus-peritosacademy, supabase/),
   jarvis_academy_panorama (repo peritos-academy, supabase/migrations/) e
   jarvis_opera_panorama (repo mh-gestao, supabase/migrations/0186).
   O Jarvis só chama. As regras ficam lá, ao lado do produto, e não aqui.
   ══════════════════════════════════════════════════════ */
function cfg(prefixo) {
  return {
    url: (process.env[`${prefixo}_SUPABASE_URL`] || '').replace(/\/+$/, ''),
    key: process.env[`${prefixo}_SUPABASE_KEY`] || process.env[`${prefixo}_SUPABASE_SERVICE_KEY`],
  };
}

async function rpc(prefixo, funcao, corpo = {}) {
  const c = cfg(prefixo);
  if (!c.url || !c.key) return { erro: `${prefixo.toLowerCase()} não configurado` };
  const r = await fetch(`${c.url}/rest/v1/rpc/${funcao}`, {
    method: 'POST',
    headers: { apikey: c.key, authorization: `Bearer ${c.key}`, 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) return { erro: `${funcao} ${r.status}: ${(await r.text()).slice(0, 200)}` };
  return r.json();
}

const disponivel = () => !!(cfg('PERITOS').url || cfg('ACADEMY').url || cfg('OPERA').url);

/* A ordem do bom dia (19/10/2026): o dono escolhe qual relatório ouvir
   primeiro (Nexxus, MH ou Academy). A escolha é guardada em `integracoes`
   (chave bom_dia) e, depois de alguns dias, o Jarvis sugere a de costume. */
async function integracao(chave, valor) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (valor === undefined) {
    const r = await fetch(`${url}/rest/v1/integracoes?chave=eq.${chave}&limit=1`, { headers: h });
    const [l] = r.ok ? await r.json() : [];
    return l && l.valor ? l.valor : null;
  }
  await fetch(`${url}/rest/v1/integracoes?on_conflict=chave`, {
    method: 'POST', headers: { ...h, prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ chave, valor, atualizada_em: new Date().toISOString() }),
  });
  return valor;
}

/** A ordem de costume: a empresa escolhida primeiro na maioria dos últimos 7 bons dias (com 3 ou mais escolhas). */
async function ordemPreferida() {
  const v = (await integracao('bom_dia')) || {};
  const ult = (v.escolhas || []).slice(-7);
  if (ult.length < 3) return { ordem_de_costume: null, escolhas_recentes: ult.length };
  const cont = {};
  for (const e of ult) cont[e.primeira] = (cont[e.primeira] || 0) + 1;
  const [primeira, vezes] = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
  return { ordem_de_costume: vezes >= Math.ceil(ult.length / 2) ? primeira : null, escolhas_recentes: ult.length };
}

const FERRAMENTAS = [
  {
    def: {
      name: 'mh_comercial',
      description: 'O comercial da MH Cálculos agora (só a MH): orçamentos parados (quantos, quanto em R$, há quantos dias, de quem, por qual canal), clientes esperando documento, cálculos fechados (ontem, 7 dias e no mês, com valor), pagamentos (recebido ontem, cobranças vencidas), o agente da MH no WhatsApp (pessoas que escreveram ontem e hoje, contatos novos, orçamentos enviados, quem passou para o Marlos e quem espera ele agora) e a régua do orçamento (toques de WhatsApp e e-mails de hoje, enviados e respostas em 7 dias). Para "relatório da MH", "como está a MH?", "quantos orçamentos parados?".',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => {
      const usuario = process.env.OPERA_USER_ID;
      if (!usuario) return { erro: 'OPERA_USER_ID não configurado' };
      return rpc('OPERA', 'jarvis_mh_comercial', { p_usuario: usuario });
    },
  },
  {
    def: {
      name: 'bom_dia_ordem',
      description: 'Guarda qual relatório o Marlos escolheu ouvir PRIMEIRO no bom dia de hoje (nexxus, mh ou academy). Chame assim que ele responder a pergunta do bom dia. Depois de alguns dias, o Jarvis passa a sugerir a ordem de costume.',
      input_schema: { type: 'object', properties: { primeira: { type: 'string', enum: ['nexxus', 'mh', 'academy'] } }, required: ['primeira'] },
    },
    run: async (i) => {
      const v = (await integracao('bom_dia')) || {};
      const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const escolhas = (v.escolhas || []).filter((e) => e.dia !== hoje).concat([{ dia: hoje, primeira: i.primeira }]).slice(-30);
      await integracao('bom_dia', { ...v, escolhas });
      return { ok: true };
    },
  },
  {
    def: {
      name: 'nexus_panorama',
      description: 'O negócio do Nexus num período (dias de Brasília): vendas novas por plano e as últimas, upgrades, cancelamentos com motivo, inadimplência, base atual por tier, régua de cobrança, checkout iniciado/pago/abandonado (com quem abandonou e se já foi contatado), esteiras de email em andamento, desempenho de email (sobre entregues), contatos novos e descadastros, indicações. NÃO traz MRR: diga que o MRR certo é o do Asaas.',
      input_schema: { type: 'object', properties: { dias: { type: 'number', description: 'Período em dias, padrão 7. "Este mês" ≈ dia do mês.' } } },
    },
    run: (i) => rpc('PERITOS', 'jarvis_nexus_panorama', { p_dias: Math.max(1, Math.min(365, Number(i.dias) || 7)) }),
  },
  {
    def: {
      name: 'opera_panorama',
      description: 'O Opera do Marlos: cobranças em aberto e vencidas (com quem e quanto, e as paradas esperando CPF), recebido no período, comercial (oportunidades abertas por etapa, valor no funil, vendas e perdas com motivo, negociações paradas, próximas ações vencidas), conversas do agente de WhatsApp esperando ele, processos ativos com prazos de entrega e honorários a receber, e demandas terceirizadas. Para "o que tenho a receber?", "como está o comercial?", "tem prazo estourando?".',
      input_schema: { type: 'object', properties: { dias: { type: 'number', description: 'Período para vendas, perdas e recebido. Padrão 30.' } } },
    },
    run: (i) => {
      const usuario = process.env.OPERA_USER_ID;
      if (!usuario) return { erro: 'OPERA_USER_ID não configurado' };
      return rpc('OPERA', 'jarvis_opera_panorama', { p_usuario: usuario, p_dias: Math.max(1, Math.min(365, Number(i.dias) || 30)) });
    },
  },
  {
    def: {
      name: 'academy_panorama',
      description: 'A Peritos Academy agora: alunos (perfis, ativos 7/30 dias, novos, quantos pararam de estudar), aprendizado da semana (aulas concluídas, certificados), pendências do professor (dúvidas sem resposta e desafios esperando correção, com nomes) e as próximas lives com reservas e inscritos.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => rpc('ACADEMY', 'jarvis_academy_panorama'),
  },
];

module.exports = { FERRAMENTAS, disponivel, ordemPreferida };
