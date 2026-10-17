/* ══════════════════════════════════════════════════════
   O NEXUS E A ACADEMY POR INTEIRO (17/10/2026)

   Duas funções no banco de cada produto montam o panorama com as definições
   certas (o que é venda, o que é checkout abandonado, o que é aluno ativo):
   jarvis_nexus_panorama (repo nexus-peritosacademy, supabase/) e
   jarvis_academy_panorama (repo peritos-academy, supabase/migrations/).
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

const disponivel = () => !!(cfg('PERITOS').url || cfg('ACADEMY').url);

const FERRAMENTAS = [
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
      name: 'academy_panorama',
      description: 'A Peritos Academy agora: alunos (perfis, ativos 7/30 dias, novos, quantos pararam de estudar), aprendizado da semana (aulas concluídas, certificados), pendências do professor (dúvidas sem resposta e desafios esperando correção, com nomes) e as próximas lives com reservas e inscritos.',
      input_schema: { type: 'object', properties: {} },
    },
    run: () => rpc('ACADEMY', 'jarvis_academy_panorama'),
  },
];

module.exports = { FERRAMENTAS, disponivel };
