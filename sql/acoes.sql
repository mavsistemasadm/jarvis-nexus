-- ══════════════════════════════════════════════════════════════════
-- acoes — o que o Jarvis propôs e o que ele fez (17/10/2026)
-- No Supabase do PRÓPRIO Jarvis (projeto Jarvis-Nexus, SUPABASE_URL).
--
-- Toda escrita passa por aqui em dois tempos: a ferramenta PROPÕE (linha
-- `pendente`, com o resumo do que vai acontecer) e só `confirmar_acao`
-- EXECUTA. O servidor recusa confirmar uma ação criada na mesma requisição:
-- entre propor e executar precisa existir uma fala do dono. Ver lib/acoes.js.
--
-- A mesma tabela é o diário: "o que você lançou essa semana?" lê daqui.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.acoes (
  id           uuid primary key default gen_random_uuid(),
  ferramenta   text not null,
  entrada      jsonb not null default '{}'::jsonb,
  resumo       text not null,
  estado       text not null default 'pendente'
               check (estado in ('pendente', 'executada', 'cancelada', 'falhou', 'expirada')),
  resultado    jsonb,
  origem       text,
  criada_em    timestamptz not null default now(),
  decidida_em  timestamptz
);

create index if not exists acoes_estado_criada_idx on public.acoes (estado, criada_em desc);

alter table public.acoes enable row level security;

-- Mesmo modelo das outras tabelas do Jarvis: só o servidor fala com ela,
-- pela chave que vive na Vercel e nunca vai ao navegador.
drop policy if exists acoes_todos on public.acoes;
create policy acoes_todos on public.acoes for all using (true) with check (true);
