#!/usr/bin/env node
// Sincroniza o cérebro dos projetos à mão (o cron diário faz o mesmo: api/cerebro-sync.js).
//
//   GITHUB_TOKEN=$(gh auth token) SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     node scripts/sincronizar-cerebros.mjs
//
// ⚠️ O GITHUB_TOKEN fica na máquina de quem roda.
import { createRequire } from 'node:module'
const { sincronizar } = createRequire(import.meta.url)('../lib/cerebro-sync.js')
const r = await sincronizar({
  githubToken: process.env.GITHUB_TOKEN,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY,
})
console.log(`\n${r.arquivos} arquivos, ${r.secoes} seções.`)
