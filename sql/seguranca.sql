-- ══════════════════════════════════════════════════════════════════
-- O banco do Jarvis fechado (17/10/2026)
--
-- Até aqui users, sessions, messages, memories e routines estavam SEM RLS,
-- e alertas/acoes/cerebro_secoes com policy "using (true)": quem tivesse a
-- chave anon lia as conversas e as memórias do dono. O Jarvis passou a usar
-- a chave de serviço (SUPABASE_SERVICE_KEY), que ignora RLS. Então: RLS
-- ligada em tudo e NENHUMA policy. Só o servidor do Jarvis entra.
-- ══════════════════════════════════════════════════════════════════
alter table public.users          enable row level security;
alter table public.sessions       enable row level security;
alter table public.messages       enable row level security;
alter table public.memories       enable row level security;
alter table public.routines       enable row level security;
alter table public.alertas        enable row level security;
alter table public.acoes          enable row level security;
alter table public.cerebro_secoes enable row level security;

drop policy if exists alertas_todos  on public.alertas;
drop policy if exists acoes_todos    on public.acoes;
drop policy if exists cerebro_todos  on public.cerebro_secoes;

revoke execute on function public.cerebro_buscar(text, text, int) from anon, authenticated, public;
