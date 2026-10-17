// Manda ao Jarvis os .md que mudaram neste push (ou todos, no disparo manual).
// Ver .github/workflows/jarvis-cerebro.yml.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const sh = (c) => execSync(c, { encoding: 'utf8' }).trim()
const projeto = process.env.PROJETO
const antes = process.env.ANTES || ''
const tudo = process.env.TUDO === 'true' || !antes || /^0+$/.test(antes)

const arquivos = []
const apagados = []
if (tudo) {
  for (const c of sh("git ls-files '*.md'").split('\n').filter(Boolean)) arquivos.push(c)
} else {
  for (const linha of sh(`git diff --name-status ${antes} HEAD -- '*.md'`).split('\n').filter(Boolean)) {
    const [estado, ...resto] = linha.split('\t')
    const caminho = resto[resto.length - 1]
    if (estado.startsWith('D')) apagados.push(caminho)
    else {
      if (estado.startsWith('R')) apagados.push(resto[0])
      arquivos.push(caminho)
    }
  }
}

const corpo = {
  projeto,
  apagados,
  arquivos: arquivos.filter(c => !c.includes('node_modules/')).map(c => ({
    caminho: c, sha: sh(`git rev-parse HEAD:${JSON.stringify(c).slice(1, -1)}`), conteudo: readFileSync(c, 'utf8'),
  })),
}
console.log(`${projeto}: ${corpo.arquivos.length} alterado(s), ${apagados.length} apagado(s)`)
if (!corpo.arquivos.length && !apagados.length) process.exit(0)

const r = await fetch('https://jarvis-nexus.vercel.app/api/cerebro-receber', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-cerebro-key': process.env.JARVIS_CEREBRO_KEY },
  body: JSON.stringify(corpo),
})
const texto = await r.text()
console.log(r.status, texto.slice(0, 300))
if (!r.ok) process.exit(1)
