-- ══════════════════════════════════════════════════════════════════
-- cerebro_secoes — o que cada projeto sabe (17/10/2026)
-- No Supabase do PRÓPRIO Jarvis (projeto Jarvis-Nexus).
--
-- Os CLAUDE.md, AGENTS.md e docs/*.md de todos os repositórios, cortados por
-- título. É assim que o Jarvis responde "como funciona a régua de cobrança?"
-- com a regra real, e não de memória. Quem escreve é
-- scripts/sincronizar-cerebros.mjs, lendo a versão publicada (main) no
-- GitHub. O Jarvis só lê, e NÃO tem credencial do GitHub.
--
-- Busca em português sem acento: por voz, "credito" e "crédito" são a mesma
-- palavra.
-- ══════════════════════════════════════════════════════════════════

create extension if not exists unaccent;

do $$ begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_sem_acento') then
    create text search configuration public.pt_sem_acento (copy = pg_catalog.portuguese);
    alter text search configuration public.pt_sem_acento
      alter mapping for hword, hword_part, word with unaccent, portuguese_stem;
  end if;
end $$;

create table if not exists public.cerebro_secoes (
  id            uuid primary key default gen_random_uuid(),
  projeto       text not null,
  arquivo       text not null,
  titulo        text not null,
  ordem         int  not null,
  conteudo      text not null,
  atualizado_em timestamptz not null default now(),
  busca tsvector generated always as (
    setweight(to_tsvector('public.pt_sem_acento', coalesce(titulo, '')), 'A') ||
    setweight(to_tsvector('public.pt_sem_acento', coalesce(conteudo, '')), 'B')
  ) stored
);

create index if not exists cerebro_busca_idx on public.cerebro_secoes using gin (busca);
create index if not exists cerebro_projeto_idx on public.cerebro_secoes (projeto, arquivo, ordem);

alter table public.cerebro_secoes enable row level security;
drop policy if exists cerebro_todos on public.cerebro_secoes;
create policy cerebro_todos on public.cerebro_secoes for all using (true) with check (true);

-- A busca: as seções mais relevantes, com o trecho que casou.
create or replace function public.cerebro_buscar(p_pergunta text, p_projeto text default null, p_limite int default 6)
returns table (id uuid, projeto text, arquivo text, titulo text, trecho text, relevancia real)
language sql stable
set search_path = public
as $$
  -- Qualquer palavra, e não todas: uma pergunta falada tem palavras que não
  -- estão no texto ("por que o aluno vê cadeado"). Quem casa mais palavras
  -- sobe pelo ts_rank_cd.
  with q as (
    select coalesce(nullif(to_tsquery('public.pt_sem_acento', coalesce(nullif(array_to_string(array(
      select lexeme from unnest(to_tsvector('public.pt_sem_acento', p_pergunta))
    ), ' | '), ''), 'x_vazio_x')), ''), websearch_to_tsquery('public.pt_sem_acento', p_pergunta)) as tq
  )
  select s.id, s.projeto, s.arquivo, s.titulo,
         ts_headline('public.pt_sem_acento', s.conteudo, q.tq,
                     'MaxWords=60, MinWords=25, MaxFragments=2, FragmentDelimiter=" … "') as trecho,
         -- ts_rank com normalização pelo tamanho (1): sem ela, a seção longa que
         -- repete as palavras passa na frente da seção curta que responde.
         ts_rank(s.busca, q.tq, 1) as relevancia
  from cerebro_secoes s, q
  where s.busca @@ q.tq and (p_projeto is null or s.projeto = p_projeto)
  order by relevancia desc
  limit least(greatest(p_limite, 1), 12)
$$;
