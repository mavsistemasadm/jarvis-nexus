/* ══════════════════════════════════════════════════════
   "ABRE UMA TAREFA DE CÓDIGO" (17/10/2026)

   O Jarvis não mexe em código. Ele abre uma issue no repositório certo, com o
   contexto da conversa e a etiqueta `jarvis`, e quem faz o trabalho é o Claude
   Code, numa sessão com o dono. PROPÕE e espera o sim (lib/acoes.js).

   Precisa de GITHUB_TOKEN_TAREFAS: token fine-grained com "Issues: Read and
   write" nos repositórios abaixo, e nada mais. Sem ele a ferramenta nem
   aparece para o modelo.
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

acoes.registrar('abrir_tarefa_codigo', async (e) => {
  const repo = REPOS[e.produto];
  if (!repo) return { erro: `produto desconhecido: ${e.produto}` };
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
  if (!r.ok) return { erro: `GitHub ${r.status}: ${d.message || ''}` };
  return { ok: true, numero: d.number, url: d.html_url };
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

module.exports = { FERRAMENTAS, disponivel: () => !!process.env.GITHUB_TOKEN_TAREFAS };
