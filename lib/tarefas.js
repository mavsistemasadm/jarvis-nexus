/* ══════════════════════════════════════════════════════
   "ABRE UMA TAREFA DE CÓDIGO" (17/10/2026)

   O Jarvis não mexe em código. Ele registra a tarefa (tabela tarefas_codigo,
   sql/tarefas.sql), que aparece em /memorias.html, e quem faz o trabalho é o
   Claude Code, numa sessão com o dono. PROPÕE e espera o sim (lib/acoes.js).

   Com GITHUB_TOKEN_TAREFAS (token fine-grained com "Issues: Read and write"
   nos repositórios abaixo, e nada mais), também abre a issue no repositório
   do produto. Sem ele, fica só registrada, e isso basta para o trabalho
   começar.
   ══════════════════════════════════════════════════════ */
const acoes = require('./acoes');

const REPOS = {
  nexus: 'nexus-peritosacademy',
  academy: 'peritos-academy',
  opera: 'mh-gestao',
  financeiro: 'grupo-mh-financeiro',
  ache: 'acheumperito',
  ponto: 'ponto-perito',
  galacticos: 'galacticos-ia',
  jarvis: 'jarvis-nexus',
  site_mh: 'mh-calculos-site',
};

const db = require('./supabase');

acoes.registrar('abrir_tarefa_codigo', async (e) => {
  const repo = REPOS[e.produto];
  if (!repo) return { erro: `produto desconhecido: ${e.produto}` };
  const [tarefa] = await db.insert('tarefas_codigo', { produto: e.produto, titulo: e.titulo, descricao: e.descricao });
  if (!process.env.GITHUB_TOKEN_TAREFAS) return { ok: true, registrada: true, id: tarefa && tarefa.id };
  const r = await fetch(`https://api.github.com/repos/mavsistemasadm/${repo}/issues`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN_TAREFAS}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: JSON.stringify({
      title: e.titulo,
      body: `${e.descricao}\n\n---\nAberta pelo Jarvis, a pedido do Marlos, em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
      labels: ['jarvis'],
    }),
  });
  const d = await r.json().catch(() => ({}));
  // A tarefa já está registrada: falhar no GitHub não a perde.
  if (!r.ok) return { ok: true, registrada: true, issue_erro: `GitHub ${r.status}: ${d.message || ''}` };
  if (tarefa && tarefa.id) await db.update('tarefas_codigo', { id: tarefa.id }, { issue_url: d.html_url });
  return { ok: true, registrada: true, numero: d.number, url: d.html_url };
});

const FERRAMENTAS = [
  {
    def: {
      name: 'abrir_tarefa_codigo',
      description: 'PROPÕE abrir uma tarefa de código (issue no GitHub) para um produto: defeito, ajuste de tela, recurso novo. Escreva a descrição como um pedido completo para um desenvolvedor: o que acontece, onde, o que deveria acontecer, e o que o Marlos disse. Quem executa é o Claude Code.',
      input_schema: {
        type: 'object',
        properties: {
          produto: { type: 'string', enum: Object.keys(REPOS) },
          titulo: { type: 'string', description: 'Curto e específico.' },
          descricao: { type: 'string' },
        },
        required: ['produto', 'titulo', 'descricao'],
      },
    },
    run: (i, ctx) => acoes.propor('abrir_tarefa_codigo', i, `Abrir tarefa no ${i.produto}: ${i.titulo}`, ctx),
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) };
