-- ══════════════════════════════════════════════════════════════════
-- confirmar_pagamento — baixa de uma conta por voz, via NEXUS.
--
-- RODE NO SQL EDITOR DO SUPABASE DO **grupo-mh-financeiro** — o projeto
-- que contem a tabela `movimentacoes`. Rodar no projeto errado devolve
-- 'relation "movimentacoes" does not exist'. Sem ele, a tag <pagamento_confirmar>
-- responde "função não encontrada" e nada é gravado.
--
-- POR QUE UM RPC E NÃO UM PATCH DIRETO NA TABELA.
-- Aquela base é um SaaS com ~130 clientes. Um PATCH com a service key
-- não tem nenhum filtro de dono: um erro de escopo escreve na conta de
-- outro perito. O RPC resolve o usuario_id a partir do p_email, do mesmo
-- jeito que resumo_mensal e lancar_movimentacao já fazem — o isolamento
-- vive no banco, não na boa vontade de quem chama.
--
-- A REGRA DA CORRESPONDÊNCIA ÚNICA.
-- Voz é ambígua ("paga o Supabase") e a baixa é difícil de desfazer.
-- A função só grava quando EXATAMENTE UMA conta em aberto bate com a
-- descrição. Zero ou duas ou mais → devolve erro e não toca em nada.
-- Errar para o lado de não fazer é barato; baixar a conta errada não é.
-- ══════════════════════════════════════════════════════════════════

create or replace function public.confirmar_pagamento(
  p_email          text,
  p_descricao      text,
  p_valor          numeric default null,
  p_data_pagamento date    default null,
  p_banco          text    default null,
  p_forma          text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_n     int;
  /* Campos soltos em vez de movimentacoes%rowtype: o %rowtype amarra a
     função à tabela já na compilação, e o erro que isso produz
     ("relation does not exist") aponta para a linha da declaração, não
     para a causa — que é estar no banco errado. */
  v_id    uuid;
  v_desc  text;
  v_valor numeric;
  v_data  date := coalesce(p_data_pagamento, current_date);
begin
  select id into v_user from usuarios where email = p_email;
  if v_user is null then
    return jsonb_build_object('erro', 'usuário não encontrado para esse e-mail');
  end if;

  -- candidatas: do dono, ativas, ainda em aberto
  select count(*) into v_n
    from movimentacoes m
   where m.usuario_id = v_user
     and coalesce(m.ativo, true)
     and m.data_pagamento is null
     and m.descricao ilike '%' || p_descricao || '%'
     and (p_valor is null or m.valor = p_valor);

  if v_n = 0 then
    return jsonb_build_object('erro',
      'nenhuma conta em aberto bate com "' || p_descricao || '"');
  end if;

  if v_n > 1 then
    return jsonb_build_object('erro',
      v_n || ' contas em aberto batem com "' || p_descricao ||
      '" — informe o valor exato ou uma descrição mais específica');
  end if;

  select m.id, m.descricao, m.valor into v_id, v_desc, v_valor
    from movimentacoes m
   where m.usuario_id = v_user
     and coalesce(m.ativo, true)
     and m.data_pagamento is null
     and m.descricao ilike '%' || p_descricao || '%'
     and (p_valor is null or m.valor = p_valor);

  -- `pagamento` guarda DATA nesta base (conferido: 200/200 dos registros
  -- preenchidos são data). A forma de pagamento vive em forma_pagamento.
  update movimentacoes
     set data_pagamento  = v_data,
         pagamento       = v_data,
         banco           = coalesce(p_banco, banco),
         forma_pagamento = coalesce(p_forma, forma_pagamento),
         status          = 'Pago',
         dias_atraso     = 0
   where id = v_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'descricao', v_desc,
    'valor', v_valor,
    'data_pagamento', v_data
  );
end;
$$;

grant execute on function public.confirmar_pagamento(
  text, text, numeric, date, text, text
) to anon, authenticated, service_role;
