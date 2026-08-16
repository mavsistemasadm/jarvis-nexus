/* NEXUS → camada de leitura dos negócios do Grupo MH.

   Três bases distintas, cada uma com um isolamento diferente — e a diferença
   importa, porque errar aqui devolve dado de outra pessoa:

     FINANCEIRO (grupo-mh-financeiro) → SaaS multi-tenant. Isolado por p_email
                                        dentro das RPCs. Nunca lemos a tabela
                                        direto: a RPC é quem aplica o filtro.
     OPERA      (mh-gestao)           → multi-tenant por usuario_id. O id vem
                                        SEMPRE do ambiente, nunca do request.
     PERITOS    (nexus-peritosacademy)→ é o próprio negócio, sem tenant.

   Tudo aqui é somente leitura. Escrita continua no fluxo de confirmação
   em duas etapas do chat.js.                                              */

/* ---------------- configuração ---------------- */

const FIN = {
  url: process.env.FIN_TEST_URL || process.env.FINANCEIRO_SUPABASE_URL,
  key: process.env.FINANCEIRO_SUPABASE_KEY || process.env.FINANCEIRO_SUPABASE_SERVICE_KEY,
  email: process.env.FINANCEIRO_USER_EMAIL
};

const OPERA = {
  url: process.env.OPERA_SUPABASE_URL,
  key: process.env.OPERA_SUPABASE_KEY || process.env.OPERA_SUPABASE_SERVICE_KEY,
  /* fixo no servidor — se viesse do request, uma resposta mal formada leria
     (ou escreveria) na conta de outro perito */
  userId: process.env.OPERA_USER_ID
};

const PERITOS = {
  url: process.env.PERITOS_SUPABASE_URL,
  key: process.env.PERITOS_SUPABASE_KEY || process.env.PERITOS_SUPABASE_SERVICE_KEY
};

/* Os outros quatro produtos do ecossistema. Só leitura agregada — aqui o
   Marlos é dono do produto, não usuário dele. */
const PRODUTOS = {
  academy:      { url: process.env.ACADEMY_SUPABASE_URL,      key: process.env.ACADEMY_SUPABASE_KEY || process.env.ACADEMY_SUPABASE_SERVICE_KEY },
  ponto:        { url: process.env.PONTO_SUPABASE_URL,        key: process.env.PONTO_SUPABASE_KEY || process.env.PONTO_SUPABASE_SERVICE_KEY },
  galacticos:   { url: process.env.GALACTICOS_SUPABASE_URL,   key: process.env.GALACTICOS_SUPABASE_KEY || process.env.GALACTICOS_SUPABASE_SERVICE_KEY },
  acheumperito: { url: process.env.ACHEUMPERITO_SUPABASE_URL, key: process.env.ACHEUMPERITO_SUPABASE_KEY || process.env.ACHEUMPERITO_SUPABASE_SERVICE_KEY }
};

const temFin = () => !!(FIN.url && FIN.key && FIN.email);
const temOpera = () => !!(OPERA.url && OPERA.key && OPERA.userId);
const temPeritos = () => !!(PERITOS.url && PERITOS.key);
/* Produto que o Marlos não quer acompanhar. Sem isto, um produto fora do
   radar apareceria como "não configurado" a cada pergunta — e falta de
   configuração é problema, decisão não é. PRODUTOS_IGNORADOS=ponto,galacticos */
const IGNORADOS = String(process.env.PRODUTOS_IGNORADOS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const temProduto = (p) => !IGNORADOS.includes(p) && !!(PRODUTOS[p] && PRODUTOS[p].url && PRODUTOS[p].key);
const temAlgumProduto = () => Object.keys(PRODUTOS).some(temProduto);

/* ---------------- helpers ---------------- */

function headers(cfg) {
  return {
    'apikey': cfg.key,
    'authorization': `Bearer ${cfg.key}`,
    'content-type': 'application/json'
  };
}

async function rpc(cfg, fn, params = {}) {
  const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: headers(cfg), body: JSON.stringify(params)
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function tabela(cfg, path) {
  const r = await fetch(`${cfg.url}/rest/v1/${path}`, { headers: headers(cfg) });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const finRpc = (fn, extra = {}) => rpc(FIN, fn, { p_email: FIN.email, ...extra });

/* hoje no fuso de Brasília — o servidor roda em UTC, e depois da meia-noite
   UTC "hoje" já é amanhã aqui; um prazo de hoje sumiria da agenda */
function hoje() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

const diasDesde = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/* corta listas longas antes de irem pro contexto do modelo */
function limitar(arr, n = 15) {
  if (!Array.isArray(arr)) return arr;
  if (arr.length <= n) return arr;
  return arr.slice(0, n).concat([{ _nota: `... e mais ${arr.length - n} itens` }]);
}

/* ---------------- FINANCEIRO ---------------- */

const financeiro = {
  async resumo(ano_mes) {
    const [resumo, meta] = await Promise.all([
      finRpc('resumo_mensal', ano_mes ? { p_ano_mes: ano_mes } : {}),
      finRpc('faturamento_vs_meta', ano_mes ? { p_ano_mes: ano_mes } : {}).catch(() => null)
    ]);
    const out = { mes: ano_mes || 'atual', por_empresa: resumo };
    /* meta zerada = tabela `metas` não preenchida, não meta batida.
       Sem esse aviso o NEXUS anuncia "0% da meta" como se fosse resultado. */
    if (meta && meta.length) {
      const temMeta = meta.some(m => Number(m.meta) > 0);
      out.meta = temMeta ? meta : { aviso: 'Nenhuma meta cadastrada para este mês — não fale sobre % de meta.' };
    }
    return out;
  },

  async contas(tipo = 'a_vencer', dias = 7) {
    if (tipo === 'em_atraso') return { em_atraso: limitar(await finRpc('contas_em_atraso'), 20) };
    return { a_vencer_em_dias: dias, contas: limitar(await finRpc('contas_a_vencer', { p_dias: dias }), 20) };
  },

  async movimentacoes(ano_mes, limit = 25) {
    return limitar(await finRpc('movimentacoes_mes', {
      ...(ano_mes ? { p_ano_mes: ano_mes } : {}), p_limit: limit
    }), limit);
  },

  async topDespesas(ano_mes, limit = 10) {
    return finRpc('top_despesas', { ...(ano_mes ? { p_ano_mes: ano_mes } : {}), p_limit: limit });
  },

  empresas() { return finRpc('listar_empresas'); }
};

/* ---------------- OPERA (mh-gestao) ---------------- */

const opera = {
  /* A tela da agenda mostra eventos que NÃO existem na tabela: ela deriva
     prazos de processo e follow-ups em tempo real. Ler só `eventos` responde
     "1 compromisso" quando a tela mostra 7 — então a derivação é replicada
     aqui, igual a app/(app)/agenda/page.tsx. */
  async agenda(dias = 14) {
    const uid = OPERA.userId;
    const hj = hoje();
    const [eventos, processos, oportunidades] = await Promise.all([
      tabela(OPERA, `eventos?usuario_id=eq.${uid}&concluido=eq.false&data_evento=gte.${hj}&select=titulo,tipo,data_evento,local,dia_todo,processo_id&order=data_evento`),
      tabela(OPERA, `processos?usuario_id=eq.${uid}&status=not.in.(concluido,arquivado,suspenso)&prazo_entrega=not.is.null&select=id,numero,titulo,tipo_acao,prazo_entrega,data_entrega,status,atuacao`),
      tabela(OPERA, `oportunidades?usuario_id=eq.${uid}&etapa=not.in.(venda_realizada,perdido)&select=id,titulo,etapa,valor_estimado,atualizado_em,negocio`)
    ]);

    const comEvento = new Set(eventos.filter(e => e.processo_id).map(e => e.processo_id));
    const prazos = processos
      .filter(p => p.prazo_entrega && !p.data_entrega && !comEvento.has(p.id))
      .map(p => ({
        tipo: 'prazo_processo',
        titulo: `${String(p.numero || '').startsWith('PRE-') ? 'Pré-judicial' : p.numero} · ${p.tipo_acao}`,
        data_evento: p.prazo_entrega,
        atuacao: p.atuacao,
        origem: 'derivado do processo'
      }));

    const followups = oportunidades
      .map(o => ({ o, d: diasDesde(o.atualizado_em) }))
      .filter(x => x.d >= 5)
      .map(x => ({
        tipo: 'followup',
        titulo: `Follow-up: ${x.o.titulo}`,
        etapa: x.o.etapa,
        valor_estimado: x.o.valor_estimado,
        parado_ha_dias: x.d,
        origem: 'oportunidade parada há 5+ dias'
      }));

    const limite = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
    const marcados = eventos
      .filter(e => String(e.data_evento).slice(0, 10) <= limite)
      .map(e => ({ tipo: e.tipo, titulo: e.titulo, data_evento: e.data_evento, local: e.local, origem: 'agendado' }));

    return {
      janela_dias: dias,
      hoje: hj,
      compromissos_marcados: marcados,
      prazos_de_processo: prazos.filter(p => p.data_evento <= limite),
      followups_pendentes: limitar(followups, 12),
      total: marcados.length + prazos.length + followups.length
    };
  },

  async whatsapp() {
    const uid = OPERA.userId;
    const [contatos, conversas] = await Promise.all([
      tabela(OPERA, `wpp_contatos?usuario_id=eq.${uid}&nao_lidas=gt.0&arquivado=eq.false&select=nome,telefone,nao_lidas,ultima_mensagem,ultima_msg_em&order=ultima_msg_em.desc&limit=25`),
      tabela(OPERA, `agent_conversations?usuario_id=eq.${uid}&escalar_humano=eq.true&select=status,area_identificada,tipo_calculo,valor_pagamento,ultima_atividade_at&order=ultima_atividade_at.desc&limit=15`)
    ]);
    return {
      aguardando_resposta: limitar(contatos.map(c => ({
        nome: c.nome, telefone: c.telefone, nao_lidas: c.nao_lidas,
        ultima_mensagem: String(c.ultima_mensagem || '').slice(0, 120),
        ha_dias: diasDesde(c.ultima_msg_em)
      })), 15),
      escalados_para_humano: conversas
    };
  },

  async pipeline() {
    const ops = await tabela(OPERA, `oportunidades?usuario_id=eq.${OPERA.userId}&etapa=neq.perdido&select=titulo,etapa,valor_estimado,negocio,origem,atualizado_em&order=atualizado_em.desc&limit=80`);
    const porEtapa = {};
    let total = 0;
    for (const o of ops) {
      const e = o.etapa || 'sem_etapa';
      porEtapa[e] = porEtapa[e] || { qtd: 0, valor: 0 };
      porEtapa[e].qtd++;
      porEtapa[e].valor += Number(o.valor_estimado || 0);
      if (o.etapa !== 'venda_realizada') total += Number(o.valor_estimado || 0);
    }
    return {
      por_etapa: porEtapa,
      valor_em_negociacao: Math.round(total * 100) / 100,
      abertas: limitar(ops.filter(o => o.etapa !== 'venda_realizada').map(o => ({
        titulo: o.titulo, etapa: o.etapa, valor: o.valor_estimado,
        negocio: o.negocio, parado_ha_dias: diasDesde(o.atualizado_em)
      })), 15)
    };
  },

  async processos() {
    const p = await tabela(OPERA, `processos?usuario_id=eq.${OPERA.userId}&status=not.in.(concluido,arquivado)&select=numero,titulo,tipo_acao,atuacao,status,prazo_entrega,honorario_valor,honorario_pago,vara,comarca&order=prazo_entrega.asc.nullslast&limit=40`);
    return {
      total: p.length,
      processos: limitar(p.map(x => ({
        ...x,
        numero: String(x.numero || '').startsWith('PRE-') ? 'pré-judicial' : x.numero,
        atuacao: x.atuacao === 'perito_juizo' ? 'perito do juízo' : 'perito contratado'
      })), 25)
    };
  }
};

/* ---------------- PERITOS (dashboard do Nexus) ---------------- */

const peritos = {
  /* Deliberadamente sem MRR. lib/metricas-negocio.ts do nexus-peritosacademy
     documenta um erro ainda não corrigido: 16 assinantes do tier `infinity`
     entram com preço 0, deixando ~R$1.278/mês fora do cálculo. Enquanto isso
     não for decidido, o NEXUS não fala MRR — melhor não responder do que
     responder errado com voz de autoridade. */
  async assinaturas(dias = 30) {
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    const eventos = await tabela(PERITOS, `assinatura_eventos?ocorrido_em=gte.${desde}&select=tipo,tier,ciclo,email,ocorrido_em,origem&order=ocorrido_em.desc&limit=60`);
    const contagem = {};
    for (const e of eventos) contagem[e.tipo] = (contagem[e.tipo] || 0) + 1;
    return {
      periodo_dias: dias,
      resumo: contagem,
      eventos: limitar(eventos, 25),
      nota: 'MRR indisponível de propósito — há uma divergência conhecida no cálculo (tier infinity). Não estime MRR.'
    };
  }
};

/* ---------------- OUTROS PRODUTOS DO ECOSSISTEMA ----------------

   Academy, Ponto, Galácticos e AcheUmPerito. Aqui o Marlos é o dono, não o
   usuário — a pergunta é "como está o produto", não "o que preciso fazer".

   CADA NÚMERO DAQUI FOI CONFERIDO CONTRA A BASE ANTES DE VIRAR CÓDIGO, e três
   campos que pareciam úteis não servem:
     - ponto.profiles.ultimo_acesso_em está VAZIO nos 125 registros;
     - academy.perfis.xp_semana tem valor em 1 de 502;
     - acheumperito não tem NENHUMA transação (0 oportunidades/contratos/pagamentos).
   Reportar "0 usuários ativos" a partir de um campo não alimentado é pior do
   que não reportar: parece medição e é ausência de medição. Por isso cada
   produto devolve `sem_sinal`, dizendo o que NÃO dá para afirmar.            */

/* conta linhas sem trazer nenhuma — só lê o header content-range */
async function contar(cfg, path) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${cfg.url}/rest/v1/${path}${sep}select=id&limit=1`, {
    headers: { ...headers(cfg), 'prefer': 'count=exact' }
  });
  if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status}`);
  return Number(String(r.headers.get('content-range') || '').split('/').pop()) || 0;
}

const produtos = {
  async academy() {
    const c = PRODUTOS.academy;
    const em30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const [perfis, acessos, vitalicios, comPrazo, vencendo, cursos, migrados] = await Promise.all([
      contar(c, 'perfis'),
      contar(c, 'acessos_conteudo?ativo=eq.true'),
      contar(c, 'acessos_conteudo?ativo=eq.true&vitalicio=eq.true'),
      contar(c, 'acessos_conteudo?ativo=eq.true&expira_em=not.is.null'),
      contar(c, `acessos_conteudo?ativo=eq.true&expira_em=gte.${hoje()}&expira_em=lte.${em30}`),
      contar(c, 'cursos'),
      contar(c, 'migracao_alunos')
    ]);
    return {
      produto: 'Peritos Academy',
      perfis_cadastrados: perfis,
      acessos_ativos: acessos,
      dos_quais_vitalicios: vitalicios,
      com_data_de_expiracao: comPrazo,
      expirando_em_30_dias: vencendo,
      cursos_publicados: cursos,
      alunos_migrados: migrados,
      sem_sinal: `Engajamento (xp_semana, estudo_semana_seg) só tem valor em 1 de ${perfis} perfis — NÃO afirme quantos alunos estudaram na semana. Certificados, matrículas e dúvidas estão zerados na base.`
    };
  },

  /* quem perde acesso em breve — acionável, ao contrário da contagem seca */
  async academyAcessos(dias = 30) {
    const c = PRODUTOS.academy;
    const ate = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
    const lista = await tabela(c, `acessos_conteudo?ativo=eq.true&expira_em=gte.${hoje()}&expira_em=lte.${ate}&select=expira_em,origem,escopo,perfis(nome)&order=expira_em&limit=40`);
    return {
      janela_dias: dias,
      total: lista.length,
      vencendo: limitar(lista.map(a => ({
        nome: (a.perfis && a.perfis.nome) || 'sem nome no perfil',
        expira_em: a.expira_em,
        origem: a.origem,
        escopo: a.escopo
      })), 20)
    };
  },

  async ponto() {
    const c = PRODUTOS.ponto;
    const [usuarios, batidas, cartoes, semCredito] = await Promise.all([
      contar(c, 'profiles'),
      contar(c, 'batidas'),
      contar(c, 'cartoes_ponto'),
      contar(c, 'profiles?creditos_disponiveis=lte.0')
    ]);
    return {
      produto: 'Ponto do Perito',
      usuarios_cadastrados: usuarios,
      cartoes_de_ponto: cartoes,
      batidas_processadas: batidas,
      usuarios_sem_credito: semCredito,
      sem_sinal: `ultimo_acesso_em está vazio nos ${usuarios} registros — NÃO afirme quantos usuários estão ativos ou acessaram recentemente.`
    };
  },

  async galacticos() {
    const c = PRODUTOS.galacticos;
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const d7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const [usuarios, ativos30, conversas, conv30, conv7] = await Promise.all([
      contar(c, 'usuarios'),
      contar(c, `usuarios?ultimo_acesso_em=gte.${d30}`),
      contar(c, 'conversations'),
      contar(c, `conversations?created_at=gte.${d30}`),
      contar(c, `conversations?created_at=gte.${d7}`)
    ]);
    return {
      produto: 'Galácticos IA',
      usuarios_cadastrados: usuarios,
      acessaram_nos_ultimos_30_dias: ativos30,
      conversas_total: conversas,
      conversas_30_dias: conv30,
      conversas_7_dias: conv7
    };
  },

  async acheumperito() {
    const c = PRODUTOS.acheumperito;
    const [perfis, peritos, oportunidades, contratos, pagamentos, disputas] = await Promise.all([
      contar(c, 'profiles'),
      contar(c, 'perito_profiles'),
      contar(c, 'opportunities'),
      contar(c, 'contracts'),
      contar(c, 'payments'),
      contar(c, 'disputes')
    ]);
    const parado = !oportunidades && !contratos && !pagamentos;
    return {
      produto: 'AcheUmPerito',
      perfis: perfis,
      peritos_cadastrados: peritos,
      oportunidades: oportunidades,
      contratos: contratos,
      pagamentos: pagamentos,
      disputas: disputas,
      ...(parado ? {
        situacao: 'O marketplace tem oferta cadastrada mas NENHUMA transação: zero oportunidades, contratos e pagamentos. Isso não é falha de leitura — a base está assim. Diga isso claramente se ele perguntar.'
      } : {})
    };
  },

  /* panorama dos quatro, cada um isolado do erro do outro */
  async status() {
    const out = {};
    const nomes = Object.keys(PRODUTOS).filter(temProduto);
    await Promise.all(nomes.map(async (n) => {
      try { out[n] = await produtos[n](); }
      catch (e) { out[n] = { produto: n, erro: String(e.message || e) }; }
    }));
    /* fora do radar por decisão não é lacuna: não reporta */
    const faltando = Object.keys(PRODUTOS).filter(n => !temProduto(n) && !IGNORADOS.includes(n));
    if (faltando.length) out._nao_configurados = faltando;
    return out;
  }
};

/* ---------------- ESCRITA ----------------
   Nada aqui é chamado como ferramenta. A escrita só acontece depois da
   confirmação explícita por voz, pelo fluxo de tags do chat.js — o modelo
   resume, pergunta "confirma?", e só então emite a tag.                   */

const escrever = {
  /* Baixa de conta. Depende do RPC em sql/confirmar_pagamento.sql:
     enquanto ele não existir no banco, isto responde com erro claro em vez
     de tentar um PATCH direto (que não teria isolamento por dono). */
  async confirmarPagamento(d) {
    if (!temFin()) throw new Error('financeiro não configurado');
    const out = await rpc(FIN, 'confirmar_pagamento', {
      p_email: FIN.email,
      p_descricao: d.descricao,
      p_valor: d.valor != null ? Number(d.valor) : null,
      p_data_pagamento: d.data_pagamento || null,
      p_banco: d.banco || null,
      p_forma: d.forma_pagamento || null
    }).catch(e => {
      if (/PGRST202|does not exist|Could not find the function/i.test(String(e.message))) {
        throw new Error('a função confirmar_pagamento ainda não existe no banco do financeiro — rode sql/confirmar_pagamento.sql no Supabase');
      }
      throw e;
    });
    if (out && out.erro) throw new Error(out.erro);
    return out;
  },

  /* Compromisso na agenda do Opera. Só titulo e data são obrigatórios —
     é o mesmo mínimo que a tela exige. */
  async criarEvento(d) {
    if (!temOpera()) throw new Error('opera não configurado');
    if (!d.titulo || !d.data) throw new Error('título e data são obrigatórios');
    const diaTodo = d.dia_todo !== false && !d.hora;
    const dataHora = diaTodo ? `${d.data}T00:00:00` : `${d.data}T${d.hora || '09:00'}:00`;
    const r = await fetch(`${OPERA.url}/rest/v1/eventos`, {
      method: 'POST',
      headers: { ...headers(OPERA), 'prefer': 'return=representation' },
      body: JSON.stringify({
        usuario_id: OPERA.userId,          /* fixo — nunca vem da fala */
        tipo: d.tipo || 'outro',
        titulo: d.titulo,
        data_evento: dataHora,
        dia_todo: diaTodo,
        local: d.local || null,
        alerta_ativo: d.alerta_dias != null,
        alerta_dias: d.alerta_dias != null ? Number(d.alerta_dias) : 0,
        alerta_2_ativo: false,
        alerta_2_dias: 0,
        concluido: false
      })
    });
    if (!r.ok) throw new Error(`agenda: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json())[0];
  },

  /* Cálculo judicial. Espelha o wizard de 3 etapas de /processos/novo.
     `status` é DERIVADO da atuação, nunca perguntado — é a convenção do
     sistema, e quebrá-la deixa o processo fora do kanban certo. */
  async criarProcesso(d) {
    if (!temOpera()) throw new Error('opera não configurado');
    const atuacao = d.atuacao === 'perito_juizo' ? 'perito_juizo' : 'perito_contratado';
    if (!d.tipo_acao) throw new Error('tipo de cálculo é obrigatório');
    const r = await fetch(`${OPERA.url}/rest/v1/processos`, {
      method: 'POST',
      headers: { ...headers(OPERA), 'prefer': 'return=representation' },
      body: JSON.stringify({
        usuario_id: OPERA.userId,
        numero: d.numero || ('PRE-' + Date.now()),   /* sem número = pré-judicial */
        titulo: d.titulo || null,
        tipo_acao: d.tipo_acao,
        atuacao,
        status: atuacao === 'perito_juizo' ? 'em_andamento' : 'calculo_fechado',
        vara: d.vara || null,
        tribunal: d.tribunal || null,
        comarca: d.comarca || null,
        valor_causa: d.valor_causa != null ? Number(d.valor_causa) : null,
        prazo_entrega: d.prazo_entrega || null,
        data_nomeacao: d.data_nomeacao || null,
        honorario_tipo: d.honorario_tipo || null,
        honorario_valor: d.honorario_valor != null ? Number(d.honorario_valor) : null,
        deposito_judicial: !!d.deposito_judicial,
        observacoes: d.observacoes || null,
        contato_nome: d.contato_nome || null,
        telefone_contato: d.contato_telefone ? String(d.contato_telefone).replace(/\D/g, '') : null,
        email_contato: d.contato_email || null
      })
    });
    if (!r.ok) throw new Error(`processo: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json())[0];
  }
};

/* ---------------- ferramentas expostas ao modelo ---------------- */

const FERRAMENTAS = [
  {
    fonte: temFin,
    def: {
      name: 'financeiro_resumo',
      description: 'Situação financeira do mês por empresa do Grupo MH (Ecossistema Nexus, MH Cálculos, Peritos Academy, Pró-Labore): receitas, despesas e saldo. Use quando perguntarem "como está o mês", "como está o caixa", "quanto faturei", ou sobre resultado de uma empresa.',
      input_schema: {
        type: 'object',
        properties: { ano_mes: { type: 'string', description: 'Mês no formato AAAA-MM. Omita para o mês atual.' } }
      }
    },
    run: (i) => financeiro.resumo(i.ano_mes)
  },
  {
    fonte: temFin,
    def: {
      name: 'financeiro_contas',
      description: 'Contas a vencer nos próximos dias ou contas já em atraso. Use quando perguntarem "o que vence", "o que está atrasado", "tem conta pra pagar".',
      input_schema: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: ['a_vencer', 'em_atraso'], description: 'Padrão: a_vencer' },
          dias: { type: 'integer', description: 'Janela em dias para a_vencer. Padrão 7.' }
        }
      }
    },
    run: (i) => financeiro.contas(i.tipo, i.dias)
  },
  {
    fonte: temFin,
    def: {
      name: 'financeiro_movimentacoes',
      description: 'Lista os lançamentos (receitas e despesas) do mês, com descrição, valor e status. Use quando pedirem detalhe do que entrou ou saiu, ou para conferir se algo foi lançado.',
      input_schema: {
        type: 'object',
        properties: {
          ano_mes: { type: 'string', description: 'AAAA-MM. Omita para o mês atual.' },
          limit: { type: 'integer', description: 'Padrão 25.' }
        }
      }
    },
    run: (i) => financeiro.movimentacoes(i.ano_mes, i.limit)
  },
  {
    fonte: temFin,
    def: {
      name: 'financeiro_top_despesas',
      description: 'Maiores despesas do mês agrupadas por categoria. Use quando perguntarem onde o dinheiro está indo ou o que mais pesa no custo.',
      input_schema: {
        type: 'object',
        properties: { ano_mes: { type: 'string' }, limit: { type: 'integer' } }
      }
    },
    run: (i) => financeiro.topDespesas(i.ano_mes, i.limit)
  },
  {
    fonte: temOpera,
    def: {
      name: 'agenda_prazos',
      description: 'Agenda do Opera (mh-gestao): compromissos marcados, prazos de entrega de processos e follow-ups de negociações paradas. Use quando perguntarem sobre agenda, prazos, audiências, entregas de laudo ou o que tem pela frente.',
      input_schema: {
        type: 'object',
        properties: { dias: { type: 'integer', description: 'Janela em dias. Padrão 14.' } }
      }
    },
    run: (i) => opera.agenda(i.dias)
  },
  {
    fonte: temOpera,
    def: {
      name: 'whatsapp_pendentes',
      description: 'Conversas de WhatsApp aguardando resposta (mensagens não lidas) e conversas que o agente escalou para atendimento humano. Use quando perguntarem quem está esperando resposta, se tem cliente parado ou como está o atendimento.',
      input_schema: { type: 'object', properties: {} }
    },
    run: () => opera.whatsapp()
  },
  {
    fonte: temOpera,
    def: {
      name: 'pipeline_comercial',
      description: 'Oportunidades comerciais por etapa do funil, com valor em negociação e há quantos dias cada uma está parada. Use quando perguntarem sobre vendas, propostas, orçamentos ou quanto tem na mesa.',
      input_schema: { type: 'object', properties: {} }
    },
    run: () => opera.pipeline()
  },
  {
    fonte: temOpera,
    def: {
      name: 'processos_ativos',
      description: 'Processos e cálculos judiciais em andamento, com tipo de atuação (perito do juízo ou contratado), status, prazo e honorários. Use quando perguntarem sobre processos, laudos ou cálculos em aberto.',
      input_schema: { type: 'object', properties: {} }
    },
    run: () => opera.processos()
  },
  {
    fonte: temPeritos,
    def: {
      name: 'assinaturas_nexus',
      description: 'Movimentação de assinaturas da plataforma Nexus/Peritos Academy: quem assinou, fez upgrade, cancelou ou regularizou. Use quando perguntarem sobre assinantes novos, cancelamentos ou como está a base. NÃO use para MRR — o cálculo tem divergência conhecida.',
      input_schema: {
        type: 'object',
        properties: { dias: { type: 'integer', description: 'Período em dias. Padrão 30.' } }
      }
    },
    run: (i) => peritos.assinaturas(i.dias)
  },
  {
    fonte: temAlgumProduto,
    def: {
      name: 'produtos_status',
      description: 'Panorama dos outros produtos do ecossistema: Peritos Academy (alunos e acessos), Ponto do Perito, Galácticos IA e AcheUmPerito. Use quando perguntarem "como estão meus produtos", sobre alunos, usuários de um produto específico, ou o tamanho da base. Respeite o campo "sem_sinal" de cada produto: ele diz o que NÃO pode ser afirmado.',
      input_schema: { type: 'object', properties: {} }
    },
    run: () => produtos.status()
  },
  {
    fonte: () => temProduto('academy'),
    def: {
      name: 'academy_acessos_vencendo',
      description: 'Alunos da Peritos Academy cujo acesso expira nos próximos dias, com nome e data. Use quando perguntarem quem vai perder acesso, quem precisa renovar, ou sobre vencimentos da Academy.',
      input_schema: {
        type: 'object',
        properties: { dias: { type: 'integer', description: 'Janela em dias. Padrão 30.' } }
      }
    },
    run: (i) => produtos.academyAcessos(i.dias)
  },
  {
    fonte: () => temFin() || temOpera() || temPeritos(),
    def: {
      name: 'resumo_do_dia',
      description: 'Panorama cruzando todas as fontes de uma vez: contas vencendo e atrasadas, agenda da semana, quem espera resposta no WhatsApp e assinaturas recentes. Use para "o que precisa de mim hoje", "me dá o resumo", "como estão as coisas" ou no briefing da manhã.',
      input_schema: { type: 'object', properties: {} }
    },
    run: async () => {
      const partes = {};
      const tentar = async (chave, fn) => {
        try { partes[chave] = await fn(); }
        catch (e) { partes[chave] = { erro: String(e.message || e) }; }
      };
      /* Fonte não configurada precisa aparecer, não sumir. Sem isto o resumo
         devolve só o que existe, e "não perguntei" vira "não tem" — foi
         exatamente o que aconteceu em produção: o WhatsApp ficou de fora por
         falta de credencial e a resposta saiu "a fila está limpa", com sete
         pessoas esperando. Ausência de fonte é informação, não silêncio. */
      const faltando = [];
      if (!temFin()) faltando.push('financeiro (contas, faturamento)');
      if (!temOpera()) faltando.push('Opera (agenda, prazos, WhatsApp, comercial)');
      if (!temPeritos()) faltando.push('assinaturas do Nexus');
      if (faltando.length) {
        partes.NAO_VERIFICADO = {
          fontes: faltando,
          instrucao: 'Estas fontes NÃO foram consultadas por falta de configuração no servidor. NÃO diga que estão vazias, limpas ou sem pendências — você não olhou. Diga que não conseguiu verificar.'
        };
      }
      await Promise.all([
        temFin() && tentar('contas_a_vencer', () => financeiro.contas('a_vencer', 5)),
        temFin() && tentar('contas_em_atraso', () => financeiro.contas('em_atraso')),
        temFin() && tentar('financeiro_do_mes', () => financeiro.resumo()),
        temOpera() && tentar('agenda', () => opera.agenda(7)),
        temOpera() && tentar('whatsapp', () => opera.whatsapp()),
        temPeritos() && tentar('assinaturas', () => peritos.assinaturas(7))
      ].filter(Boolean));
      return partes;
    }
  }
];

/* só expõe a ferramenta se a fonte dela estiver configurada — prometer um dado
   que o servidor não consegue buscar rende resposta inventada */
function ferramentasDisponiveis() {
  return FERRAMENTAS.filter(f => f.fonte()).map(f => f.def);
}

async function executar(nome, input = {}) {
  const t = FERRAMENTAS.find(f => f.def.name === nome);
  if (!t) return { erro: `ferramenta desconhecida: ${nome}` };
  if (!t.fonte()) return { erro: `fonte de "${nome}" não configurada neste ambiente` };
  try {
    return await t.run(input || {});
  } catch (e) {
    console.error(`[nexus] ferramenta ${nome} falhou:`, e.message);
    /* devolve o erro pro modelo em vez de derrubar a resposta: ele avisa o
       usuário que a fonte falhou em vez de inventar um número */
    return { erro: String(e.message || e) };
  }
}

function statusFontes() {
  const s = { financeiro: temFin(), opera: temOpera(), peritos: temPeritos() };
  for (const p of Object.keys(PRODUTOS)) s[p] = temProduto(p);
  return s;
}

module.exports = { ferramentasDisponiveis, executar, statusFontes, escrever, financeiro, opera, peritos, produtos };
