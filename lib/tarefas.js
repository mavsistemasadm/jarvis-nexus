/* ══════════════════════════════════════════════════════
   "ABRE UMA TAREFA DE CÓDIGO" (17/10/2026)

   O Jarvis não mexe em código. Ele registra a tarefa (tabela tarefas_codigo,
   sql/tarefas.sql), que aparece em /memorias.html, e quem faz o trabalho é o
   Claude Code, numa sessão com o dono. PROPÕE e espera o sim (lib/acoes.js).

   Com GITHUB_TOKEN_TAREFAS (token fine-grained com Issues, Pull requests e
   Contents em Read and write nos repositórios abaixo), também abre a issue no
   repositório do produto. Sem ele, fica só registrada.

   O CLAUDE CODE NO GITHUB (23/10/2026). Nos repositórios de REPOS_COM_CLAUDE,
   o workflow .github/workflows/claude-jarvis.yml roda o Claude Code quando a
   issue ganha a etiqueta `jarvis`: ele faz o trabalho numa branch, abre um
   pull request e comenta na issue. Nunca publica: quem faz o merge é
   `publicar_tarefa_codigo`, que PROPÕE e espera o sim do dono.
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

/** Onde o Claude Code atende as issues sozinho (workflow claude-jarvis.yml). */
const REPOS_COM_CLAUDE = new Set(['nexus-peritosacademy', 'peritos-academy', 'mh-gestao', 'grupo-mh-financeiro', 'jarvis-nexus']);

const db = require('./supabase');

async function gh(caminho, opcoes = {}) {
  const r = await fetch(`https://api.github.com/repos/mavsistemasadm/${caminho}`, {
    ...opcoes,
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN_TAREFAS}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', ...(opcoes.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
}

/** O pull request que o Claude Code abriu para a issue (branch claude/issue-N-…, ou o corpo cita #N). */
async function prDaIssue(repo, numero) {
  const r = await gh(`${repo}/pulls?state=all&per_page=30&sort=created&direction=desc`);
  if (!r.ok || !Array.isArray(r.d)) return null;
  return r.d.find(p => String(p.head && p.head.ref || '').startsWith(`claude/issue-${numero}-`)
    || new RegExp(`#${numero}\\b`).test(String(p.body || ''))) || null;
}

const situacaoDoPr = (p) => !p ? null : {
  numero: p.number, titulo: p.title, url: p.html_url,
  estado: p.merged_at ? 'publicado' : p.state === 'closed' ? 'fechado sem publicar' : 'aberto, esperando o sim',
};

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
  return {
    ok: true, registrada: true, numero: d.number, url: d.html_url,
    nota: REPOS_COM_CLAUDE.has(repo)
      ? 'O Claude Code já começou no GitHub; em alguns minutos abre um pull request. Use tarefas_codigo_andamento para saber.'
      : 'Neste repositório o Claude Code não roda sozinho: a tarefa espera uma sessão com o Marlos.',
  };
});

// Publicar = fazer o merge do pull request na main (que põe no ar).
acoes.registrar('publicar_tarefa_codigo', async (e) => {
  const repo = REPOS[e.produto];
  if (!repo) return { erro: `produto desconhecido: ${e.produto}` };
  if (!process.env.GITHUB_TOKEN_TAREFAS) return { erro: 'sem GITHUB_TOKEN_TAREFAS no Jarvis' };
  const pr = await gh(`${repo}/pulls/${Number(e.pr)}`);
  if (!pr.ok) return { erro: `pull request não encontrado (${pr.status})` };
  if (pr.d.merged_at) return { ok: true, ja_publicado: true, url: pr.d.html_url };
  if (pr.d.state !== 'open') return { erro: 'o pull request está fechado' };
  const m = await gh(`${repo}/pulls/${Number(e.pr)}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: 'squash' }) });
  if (!m.ok) return { erro: `o GitHub recusou publicar (${m.status}): ${m.d.message || ''}` };
  return { ok: true, publicado: true, url: pr.d.html_url, nota: 'Entrou na main; o deploy da Vercel começa sozinho em seguida.' };
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
  {
    def: {
      name: 'tarefas_codigo_andamento',
      description: 'Como estão as tarefas de código abertas pelo Jarvis: se o Claude Code já respondeu, o que ele disse por último e se há pull request (aberto esperando o sim, publicado ou fechado). Use para "ficou pronto?", "o Claude Code já fez?".',
      input_schema: { type: 'object', properties: { limite: { type: 'number', description: 'Quantas tarefas recentes (padrão 5).' } } },
    },
    run: async (i) => {
      const n = Math.min(Math.max(Number(i.limite) || 5, 1), 15);
      const tarefas = await db.query('tarefas_codigo', `select=produto,titulo,issue_url,criada_em&order=criada_em.desc&limit=${n}`);
      if (!Array.isArray(tarefas)) return { erro: 'não consegui ler as tarefas' };
      if (!process.env.GITHUB_TOKEN_TAREFAS) return { tarefas, nota: 'Sem GITHUB_TOKEN_TAREFAS: só sei que foram registradas.' };
      const saida = [];
      for (const t of tarefas) {
        const m = String(t.issue_url || '').match(/github\.com\/mavsistemasadm\/([^/]+)\/issues\/(\d+)/);
        if (!m) { saida.push({ produto: t.produto, titulo: t.titulo, situacao: 'só registrada, sem issue' }); continue; }
        const [, repo, numero] = m;
        const [issue, comentarios, pr] = await Promise.all([
          gh(`${repo}/issues/${numero}`), gh(`${repo}/issues/${numero}/comments?per_page=50`), prDaIssue(repo, numero),
        ]);
        const doClaude = Array.isArray(comentarios.d) ? comentarios.d.filter(c => /bot|github-actions|claude/i.test(c.user && c.user.login || '')) : [];
        const ultimo = doClaude.length ? String(doClaude[doClaude.length - 1].body || '') : '';
        saida.push({
          produto: t.produto, titulo: t.titulo, issue: Number(numero), issue_aberta: issue.d.state === 'open',
          claude_respondeu: !!ultimo, ultima_resposta: ultimo.replace(/\s+/g, ' ').slice(0, 600),
          pull_request: situacaoDoPr(pr),
        });
      }
      return { tarefas: saida };
    },
  },
  {
    def: {
      name: 'publicar_tarefa_codigo',
      description: 'PROPÕE publicar o pull request que o Claude Code abriu para uma tarefa (merge na main, que vai ao ar pela Vercel). Use só quando o Marlos pedir para publicar; antes, diga o que o pull request muda (tarefas_codigo_andamento). Se o PR disser que há migração de banco a aplicar, avise que ela NÃO é aplicada por aqui.',
      input_schema: {
        type: 'object',
        properties: {
          produto: { type: 'string', enum: Object.keys(REPOS) },
          pr: { type: 'number', description: 'Número do pull request.' },
          titulo: { type: 'string', description: 'O que o pull request faz, em poucas palavras, para o resumo.' },
        },
        required: ['produto', 'pr'],
      },
    },
    run: (i, ctx) => acoes.propor('publicar_tarefa_codigo', i, `Publicar no ${i.produto} o pull request #${i.pr}${i.titulo ? ` (${i.titulo})` : ''}`, ctx),
  },
];

module.exports = { FERRAMENTAS, disponivel: () => !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) };
