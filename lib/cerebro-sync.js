/* ══════════════════════════════════════════════════════
   Sincronização do cérebro dos projetos (17/10/2026).
   Usada pelo script local (scripts/sincronizar-cerebros.mjs) e pelo cron
   diário (api/cerebro-sync.js). Lê a branch main de cada repositório no
   GitHub e regrava a tabela cerebro_secoes, projeto por projeto.
   ══════════════════════════════════════════════════════ */
const REPOS = [
  'nexus-peritosacademy', 'peritos-academy', 'mh-gestao', 'grupo-mh-financeiro',
  'acheumperito', 'ponto-perito', 'galacticos-ia', 'jarvis-nexus', 'mh-calculos-site',
]
const DONO = 'mavsistemasadm'

// Fora do índice: cópia antiga (backup, histórico) e conversa real de cliente
// (dado pessoal). O resto de .md é orientação e entra.
const FORA = [
  /node_modules\//, /^migracao\//, /CHANGELOG/i, /LICENSE/i,
  /^docs\/HISTORICO\.md$/, /^docs\/AGENTS-backup\.md$/, /^docs\/conversas-vendas-mh\.md$/,
  /^ios\//, /^android\//, /fixtures\//, /^public\//,
]
const MIN_BYTES = 200        // CLAUDE.md de uma linha ("@AGENTS.md") e README de template
const MAX_SECAO = 9000       // seção maior que isso é cortada por parágrafo

let GH = ''
let SB = ''
let KEY = ''

async function gh(caminho, raw = false) {
  const r = await fetch(`https://api.github.com/${caminho}`, {
    headers: { authorization: `Bearer ${GH}`, accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' },
  })
  if (!r.ok) throw new Error(`GitHub ${r.status} em ${caminho}`)
  return raw ? r.text() : r.json()
}

async function sb(metodo, caminho, corpo) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, {
    method: metodo,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  if (!r.ok) throw new Error(`Supabase ${r.status} em ${caminho}: ${(await r.text()).slice(0, 200)}`)
}

/** Corta o markdown por título (#, ##, ###), guardando o caminho dos títulos. */
function secoes(texto, arquivo) {
  const linhas = texto.split('\n')
  const pilha = []
  const saida = []
  let atual = { titulo: arquivo, linhas: [] }
  let emCodigo = false
  const fechar = () => {
    const conteudo = atual.linhas.join('\n').trim()
    if (conteudo.length < 40) return
    if (conteudo.length <= MAX_SECAO) { saida.push({ titulo: atual.titulo, conteudo }); return }
    // Seção enorme: em pedaços por parágrafo, cada um com o mesmo título.
    let pedaco = ''
    let n = 1
    for (const par of conteudo.split(/\n{2,}/)) {
      if ((pedaco + '\n\n' + par).length > MAX_SECAO && pedaco) {
        saida.push({ titulo: `${atual.titulo} (parte ${n++})`, conteudo: pedaco.trim() })
        pedaco = ''
      }
      pedaco += (pedaco ? '\n\n' : '') + par
    }
    if (pedaco.trim()) saida.push({ titulo: n > 1 ? `${atual.titulo} (parte ${n})` : atual.titulo, conteudo: pedaco.trim() })
  }
  for (const l of linhas) {
    if (/^\s*```/.test(l)) emCodigo = !emCodigo
    const m = !emCodigo && /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l)
    if (m) {
      fechar()
      const nivel = m[1].length
      pilha.length = nivel - 1
      pilha[nivel - 1] = m[2].replace(/[*_`]/g, '')
      atual = { titulo: pilha.filter(Boolean).join(' > '), linhas: [] }
    } else {
      atual.linhas.push(l)
    }
  }
  fechar()
  return saida
}


async function sincronizar({ githubToken, supabaseUrl, supabaseKey, log = console.log }) {
  GH = githubToken; SB = (supabaseUrl || '').replace(/\/+$/, ''); KEY = supabaseKey
  if (!GH || !SB || !KEY) throw new Error('faltam o token do GitHub ou a configuração do Supabase')
  let totalArquivos = 0
  let totalSecoes = 0
for (const repo of REPOS) {
  const arvore = await gh(`repos/${DONO}/${repo}/git/trees/main?recursive=1`)
  const arquivos = arvore.tree.filter(t => t.type === 'blob' && t.path.endsWith('.md') && t.size >= MIN_BYTES && !FORA.some(r => r.test(t.path)))
  // Incremental: só baixa o documento cujo sha mudou. Documento que sumiu do
  // repositório sai do índice.
  const r = await fetch(`${SB}/rest/v1/cerebro_secoes?projeto=eq.${repo}&select=arquivo,sha`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } })
  const atuais = new Map(((await r.json()) || []).map(x => [x.arquivo, x.sha]))
  const vivos = new Set(arquivos.map(a => a.path))
  for (const arquivo of atuais.keys()) {
    if (!vivos.has(arquivo)) await sb('DELETE', `cerebro_secoes?projeto=eq.${repo}&arquivo=eq.${encodeURIComponent(arquivo)}`)
  }
  let n = 0
  for (const a of arquivos) {
    if (atuais.get(a.path) === a.sha) continue
    // README de template do create-next-app não é orientação de ninguém.
    if (a.path === 'README.md' && a.size === 1450) continue
    const texto = await gh(`repos/${DONO}/${repo}/contents/${encodeURI(a.path)}?ref=main`, true)
    await sb('DELETE', `cerebro_secoes?projeto=eq.${repo}&arquivo=eq.${encodeURIComponent(a.path)}`)
    const lista = secoes(texto, a.path).map((s, i) => ({ projeto: repo, arquivo: a.path, titulo: s.titulo.slice(0, 500), ordem: i, conteudo: s.conteudo, sha: a.sha }))
    for (let i = 0; i < lista.length; i += 200) await sb('POST', 'cerebro_secoes', lista.slice(i, i + 200))
    n += lista.length
    totalArquivos++
  }
  totalSecoes += n
  log(`${repo}: ${arquivos.length} arquivo(s), ${n} seções`)
}
log(`Total: ${totalArquivos} arquivos, ${totalSecoes} seções.`)
  return { arquivos: totalArquivos, secoes: totalSecoes }
}

module.exports = { sincronizar }
