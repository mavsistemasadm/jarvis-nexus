-- ══════════════════════════════════════════════════════════════════
-- integracoes: credenciais que o dono autorizou por OAuth (18/10/2026)
--
-- Primeira: o YouTube (chave 'youtube'), com o refresh token que deixa o
-- Jarvis agendar as lives do canal. É segredo: RLS ligada e NENHUMA
-- policy, então só a chave de serviço do servidor lê e escreve.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.integracoes (
  chave          text primary key,
  valor          jsonb not null,
  atualizada_em  timestamptz not null default now()
);

alter table public.integracoes enable row level security;
