-- ══════════════════════════════════════════════════════════════════
-- tarefas_pessoais — o que o Marlos pede para o Jarvis lembrar (20/10/2026).
-- "me lembra às 15h de ligar pro advogado", "anota: renovar o seguro sexta".
-- No Supabase do próprio Jarvis. Diferente de tarefas_codigo (trabalho para
-- o Claude Code) e de memories (fatos duradouros).
--
--   quando  → hora do aviso no WhatsApp (lembrete). Pode ser nulo.
--   dia     → o dia da tarefa, quando não tem hora ("sexta"). Pode ser nulo.
--   repetir → diario | dias_uteis | semanal | mensal. Depois do aviso, o
--             `quando` anda para a próxima vez e a tarefa continua aberta.
-- ══════════════════════════════════════════════════════════════════
create table if not exists public.tarefas_pessoais (
  id          uuid primary key default gen_random_uuid(),
  texto       text not null,
  quando      timestamptz,
  dia         date,
  repetir     text check (repetir in ('diario', 'dias_uteis', 'semanal', 'mensal')),
  estado      text not null default 'aberta' check (estado in ('aberta', 'feita', 'descartada')),
  avisado_em  timestamptz,
  criada_em   timestamptz not null default now(),
  fechada_em  timestamptz
);
create index if not exists tarefas_pessoais_aviso_idx on public.tarefas_pessoais (quando) where estado = 'aberta' and avisado_em is null;
create index if not exists tarefas_pessoais_estado_idx on public.tarefas_pessoais (estado, dia);
-- Fechada como as outras (sql/seguranca.sql): RLS sem policy, só a service key.
alter table public.tarefas_pessoais enable row level security;

-- ══════════════════════════════════════════════════════════════════
-- O DISPARO DOS LEMBRETES, a cada 5 minutos.
-- O cron da Vercel não serve aqui: no plano Hobby ele roda no máximo uma vez
-- por dia. Quem chama /api/lembretes é o próprio Supabase (pg_cron + pg_net).
-- Troque SEU-JARVIS e SEU_CRON_SECRET (o mesmo CRON_SECRET da Vercel) e rode:
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
-- select cron.schedule('jarvis-lembretes', '*/5 * * * *', $$
--   select net.http_get(
--     url := 'https://SEU-JARVIS/api/lembretes',
--     headers := jsonb_build_object('authorization', 'Bearer SEU_CRON_SECRET')
--   );
-- $$);
--
-- Para conferir:  select * from cron.job_run_details order by start_time desc limit 5;
-- Para desligar:  select cron.unschedule('jarvis-lembretes');
-- ══════════════════════════════════════════════════════════════════
