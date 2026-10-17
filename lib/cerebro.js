/* ══════════════════════════════════════════════════════
   O CÉREBRO DOS PROJETOS (17/10/2026)

   CLAUDE.md, AGENTS.md e docs/*.md de todos os repositórios, cortados por
   título e indexados na tabela cerebro_secoes (sql/cerebro.sql) por
   scripts/sincronizar-cerebros.mjs. É a regra REAL de cada coisa: negócio,
   marketing, tráfego, cobrança, produto. O Jarvis só lê.
   ══════════════════════════════════════════════════════ */
const URL = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = () => (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
const disponivel = () => !!(URL() && KEY());

async function rest(caminho, opcoes = {}) {
  const r = await fetch(`${URL()}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: { apikey: KEY(), authorization: `Bearer ${KEY()}`, 'content-type': 'application/json', ...(opcoes.headers || {}) },
  });
  if (!r.ok) throw new Error(`cérebro ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const PROJETOS = {
  'nexus-peritosacademy': 'Nexus (o negócio: assinaturas, cobrança, emails, marketing, tráfego, lançamentos)',
  'peritos-academy': 'Peritos Academy (cursos, alunos, acesso, gamificação, lives)',
  'mh-gestao': 'Opera (CRM, processos, agente comercial de WhatsApp, terceirização, cérebros de vendas)',
  'grupo-mh-financeiro': 'Financeiro MH',
  'acheumperito': 'Ache um Perito (marketplace perito e advogado)',
  'ponto-perito': 'MH Ponto (cartão ponto)',
  'galacticos-ia': 'Os Galácticos (IA)',
  'mh-calculos-site': 'Site da MH Cálculos',
  'jarvis-nexus': 'O próprio Jarvis',
};

const FERRAMENTAS = [
  {
    def: {
      name: 'cerebro_buscar',
      description: 'Busca nos documentos de orientação de TODOS os projetos (regras de negócio, marketing, tráfego pago, cobrança, emails, produto, decisões com data). Use para "como funciona", "por que", "qual a regra", "o que decidimos sobre", "qual a estratégia". Devolve as seções mais relevantes com um trecho; leia a inteira com cerebro_ler. Projetos: ' + Object.entries(PROJETOS).map(([k, v]) => `${k} = ${v}`).join('; '),
      input_schema: {
        type: 'object',
        properties: {
          pergunta: { type: 'string', description: 'Palavras-chave da dúvida, em português.' },
          projeto: { type: 'string', enum: Object.keys(PROJETOS), description: 'Opcional: restringe a um projeto.' },
        },
        required: ['pergunta'],
      },
    },
    run: async (i) => {
      const linhas = await rest('rpc/cerebro_buscar', { method: 'POST', body: JSON.stringify({ p_pergunta: i.pergunta, p_projeto: i.projeto || null, p_limite: 6 }) });
      return { resultados: linhas.map(l => ({ id: l.id, projeto: l.projeto, arquivo: l.arquivo, titulo: l.titulo, trecho: l.trecho })) };
    },
  },
  {
    def: {
      name: 'cerebro_ler',
      description: 'Lê a seção inteira de um documento, pelo id devolvido em cerebro_buscar.',
      input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    run: async (i) => {
      const [s] = await rest(`cerebro_secoes?id=eq.${encodeURIComponent(i.id)}&select=projeto,arquivo,titulo,conteudo,atualizado_em`);
      if (!s) return { erro: 'seção não encontrada' };
      return { ...s, conteudo: s.conteudo.slice(0, 12000) };
    },
  },
  {
    def: {
      name: 'cerebro_indice',
      description: 'Os documentos e os títulos principais de um projeto. Use para descobrir o que existe antes de buscar, ou para "o que tem documentado sobre o Nexus?".',
      input_schema: { type: 'object', properties: { projeto: { type: 'string', enum: Object.keys(PROJETOS) } }, required: ['projeto'] },
    },
    run: async (i) => {
      const linhas = await rest(`cerebro_secoes?projeto=eq.${encodeURIComponent(i.projeto)}&select=arquivo,titulo,ordem&order=arquivo,ordem&limit=3000`);
      const porArquivo = {};
      for (const l of linhas) {
        // Só o primeiro nível do título: o índice inteiro não cabe numa resposta.
        const topo = l.titulo.split(' > ').slice(0, 2).join(' > ');
        (porArquivo[l.arquivo] = porArquivo[l.arquivo] || new Set()).add(topo);
      }
      return { projeto: i.projeto, documentos: Object.entries(porArquivo).map(([arquivo, t]) => ({ arquivo, titulos: [...t].slice(0, 40) })) };
    },
  },
];

module.exports = { FERRAMENTAS, disponivel };
