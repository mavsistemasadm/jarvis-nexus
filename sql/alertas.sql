-- ══════════════════════════════════════════════════════════════════
-- alertas — memória do vigia, no Supabase do PRÓPRIO NEXUS
-- (o mesmo de SUPABASE_URL, onde já vivem users/sessions/messages).
--
-- Serve a uma coisa só: saber se um aviso já foi entregue. Sem esta
-- tabela a rotina continua funcionando, mas repete o mesmo alerta a
-- cada rodada — e um alerta repetido é um alerta que ele aprende a
-- ignorar.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.alertas (
  id          uuid primary key default gen_random_uuid(),
  hash        text not null,              -- impressão digital do resumo
  resumo      text,
  quantidade  int  default 0,
  entregue_em timestamptz not null default now(),
  criado_em   timestamptz not null default now()
);

-- a consulta do dedupe é sempre hash + janela de tempo
create index if not exists alertas_hash_entregue_idx
  on public.alertas (hash, entregue_em desc);

alter table public.alertas enable row level security;

-- Mesmo modelo das outras tabelas do NEXUS: só o servidor fala com ela,
-- usando a anon key. Não há dado de terceiro aqui — só o texto do aviso.
drop policy if exists alertas_todos on public.alertas;
create policy alertas_todos on public.alertas
  for all using (true) with check (true);
