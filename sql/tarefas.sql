-- ══════════════════════════════════════════════════════════════════
-- tarefas_codigo — o que o Marlos pediu por voz para o Claude Code fazer
-- (17/10/2026). No Supabase do próprio Jarvis. Aparece em /memorias.html;
-- com GITHUB_TOKEN_TAREFAS, vira issue no repositório do produto também.
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.tarefas_codigo (
  id          uuid primary key default gen_random_uuid(),
  produto     text not null,
  titulo      text not null,
  descricao   text not null,
  estado      text not null default 'aberta' check (estado in ('aberta', 'feita', 'descartada')),
  issue_url   text,
  criada_em   timestamptz not null default now(),
  fechada_em  timestamptz
);
create index if not exists tarefas_codigo_estado_idx on public.tarefas_codigo (estado, criada_em desc);
alter table public.tarefas_codigo enable row level security;
