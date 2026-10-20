/* ============================================================
   O HUD EM VOLTA DO NÚCLEO (20/10/2026)

   Desenha os sete painéis com o que /api/painel devolve, o relógio, os
   sistemas conectados no topo e as barras de voz. Atualiza ao abrir, a cada
   2 minutos e depois de cada resposta (window.atualizarPainel, chamado pelo
   app.js). A abertura (js/abertura.js) lê window.painelPronto para mostrar o
   estado real de cada sistema na sequência de inicialização.

   ⚠️ Fonte com erro mostra "não consegui verificar" e o motivo, nunca zero
   nem vazio: o painel parado em "nada" quando a fonte caiu é exatamente o
   defeito que o bom dia já teve em produção.
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reais = (v) => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
  const num = (v, casas = 0) => (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ICONE_ALERTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>';
  const curtoEmpresa = (e) => String(e || '').replace(/^Ecossistema /, '').replace(/^Peritos /, '').replace(/^Despesas /, '');

  /* ---- relógio ---- */
  function relogio() {
    const d = new Date();
    $('relogio').querySelector('.hora').textContent = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    $('relogio').querySelector('.data').textContent = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: 'short' })
      .replace(/\./g, '').replace(',', ' ·').toUpperCase();
  }
  relogio(); setInterval(relogio, 20000);

  /* ---- barras de voz ---- */
  const ondas = $('ondas');
  for (let i = 0; i < 44; i++) {
    const b = document.createElement('span');
    b.style.height = (8 + Math.round(26 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)))) + 'px';
    b.style.animationDuration = (0.35 + ((i * 37) % 30) / 100).toFixed(2) + 's';
    b.style.animationDelay = (-((i * 53) % 70) / 100).toFixed(2) + 's';
    b.style.opacity = (0.4 + 0.6 * Math.sin((i / 43) * Math.PI)).toFixed(2);
    ondas.appendChild(b);
  }

  /* ---- número que conta até o valor ---- */
  function contar(el, valor, fmt = reais) {
    const de = Number(el.dataset.valor || 0);
    el.dataset.valor = valor;
    if (reduzir || de === valor) { el.textContent = fmt(valor); return; }
    const ini = performance.now();
    const passo = (agora) => {
      const k = Math.min(1, (agora - ini) / 1300);
      el.textContent = fmt(de + (valor - de) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }
  const reaisSinal = (v) => (v < 0 ? '−' : '') + reais(Math.abs(v));
  const contarTodos = (raiz) => raiz.querySelectorAll('[data-conta]').forEach((el) => contar(el, Number(el.dataset.conta), el.dataset.fmt === 'n' ? (v) => num(v) : reaisSinal));

  const falhou = (d) => !d || d.erro;
  const semDado = (d) => `<p class="falha">Não consegui verificar agora.${d && d.erro ? `<span class="motivo">${esc(d.erro)}</span>` : ''}</p>`;
  const corpo = (id) => $(id).querySelector('.corpo');
  const tile = (rot, valor, extra, cls = '') => `<div class="tile ${cls}"><span class="rot">${rot}</span><span class="mono v">${valor}</span>${extra ? `<span class="det">${extra}</span>` : ''}</div>`;

  /* ---- 01 tarefas ---- */
  function tarefas(d) {
    const el = corpo('pTarefas');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    if (!d.itens.length) return (el.innerHTML = '<p class="vazio">Nada anotado para hoje. Diga "me lembra de…".</p>');
    el.innerHTML = d.itens.map((t) => {
      const feita = t.estado === 'feita';
      const marca = feita ? '<span class="tag">FEITA</span>' : t.atrasada ? '<span class="tag ambar">ATRASADA</span>'
        : t.aviso ? `<span class="tag">${esc(t.aviso.replace(/^hoje às /, '').toUpperCase())}</span>` : '';
      return `<label class="tarefa${feita ? ' feita' : ''}"><input type="checkbox" data-id="${esc(t.id)}"${feita ? ' checked' : ''}><span class="txt">${esc(t.texto)}</span>${marca}</label>`;
    }).join('');
  }

  /* ---- 02 agenda ---- */
  function agenda(d) {
    const el = corpo('pAgenda');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    const parados = d.negociacoes_paradas ? `<p class="mais ambar">${d.negociacoes_paradas} ${d.negociacoes_paradas === 1 ? 'negociação parada' : 'negociações paradas'} há 7 dias ou mais</p>` : '';
    if (!d.itens.length) return (el.innerHTML = '<p class="vazio">Nada marcado para hoje e amanhã.</p>' + parados);
    el.innerHTML = d.itens.map((e) => {
      const hora = String(e.quando).length > 10 ? new Date(e.quando).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="evento${e.critico ? ' critico' : ''}"><span class="quando">${e.hoje ? (hora || 'HOJE') : 'AMANHÃ'}</span><div class="linha"><span class="titulo">${esc(e.titulo)}</span><span class="tipo">${esc(e.tipo.toUpperCase())}${e.local ? ' · ' + esc(e.local) : ''}</span></div></div>`;
    }).join('') + (d.total > d.itens.length ? `<p class="mais">e mais ${d.total - d.itens.length}</p>` : '') + parados;
  }

  /* ---- 03 atendimento ---- */
  function atendimento(d) {
    const el = corpo('pAtendimento');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    el.innerHTML = `<div class="duplo">
        <div class="bloco${d.esperando ? ' ativo' : ''}"><span class="num" data-conta="${d.esperando}" data-fmt="n">0</span><span class="rot">ESPERANDO RESPOSTA</span></div>
        <div class="bloco${d.escalados ? ' ambar' : ''}"><span class="num" data-conta="${d.escalados}" data-fmt="n">0</span><span class="rot">O AGENTE PASSOU PARA VOCÊ</span></div>
      </div>`
      + d.pessoas.map((c) => `<div class="pessoa"><span>${esc(c.nome)}</span><span class="tag${c.ha_dias >= 1 ? ' ambar' : ''}">${c.ha_dias >= 1 ? c.ha_dias + 'd' : 'hoje'}</span></div>`).join('')
      + (d.casos.some((c) => c.assunto !== 'atendimento') ? d.casos.map((c) => `<div class="pessoa"><span>${esc(c.assunto)}</span>${c.valor ? `<span class="mono">${reais(c.valor)}</span>` : ''}</div>`).join('') : '');
    contarTodos(el);
  }

  /* ---- 04 financeiro ---- */
  function grafico(serie) {
    const max = Math.max(1, ...serie.map((p) => p.receitas));
    const W = 300, H = 64, passo = W / Math.max(1, serie.length - 1);
    if (!serie.length) return '';
    const pts = serie.map((p, i) => [i * passo, H - 6 - (p.receitas / max) * (H - 14)]);
    const linha = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const ult = pts[pts.length - 1];
    const barras = serie.map((p, i) => `<rect x="${(i * passo - 3).toFixed(1)}" y="${(H - 6 - (p.receitas / max) * (H - 14)).toFixed(1)}" width="6" height="${((p.receitas / max) * (H - 14)).toFixed(1)}" class="barra-dia"><title>${p.data.slice(8, 10)}/${p.data.slice(5, 7)}: ${reais(p.receitas)}</title></rect>`).join('');
    return `<svg class="grafico" viewBox="-4 0 308 ${H}" preserveAspectRatio="none" role="img" aria-label="Receitas dos últimos 14 dias">
      ${barras}
      <path d="${linha}L${W} ${H}L0 ${H}Z" class="area"/>
      <path d="${linha}" class="linha" pathLength="100"/>
      <circle cx="${ult[0]}" cy="${ult[1]}" r="3.5" class="ponto-final"/>
    </svg><div class="eixo"><span>${esc(serie.length ? serie[0].data.slice(8, 10) + '/' + serie[0].data.slice(5, 7) : '')}</span><span>${esc(serie.length ? serie[serie.length - 1].data.slice(8, 10) + '/' + serie[serie.length - 1].data.slice(5, 7) : '')}</span></div>`;
  }
  function financeiro(d) {
    const el = corpo('pFinanceiro');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    const t = d.tudo;
    const escopo = (rot, x) => x ? `<div class="escopo"><span class="rot">${rot}</span><span class="mono">${reais(x.receitas)} <small>−</small> ${reais(x.despesas)}</span><span class="mono ${x.saldo < 0 ? 'neg' : 'pos'}">${x.saldo < 0 ? '−' : ''}${reais(Math.abs(x.saldo))}</span></div>` : '';
    el.innerHTML = `<div class="destaque"><div><span class="rot">SALDO DO PERÍODO</span><span class="num grande ${t.saldo < 0 ? 'neg' : ''}" data-conta="${t.saldo}">R$ 0</span></div><span class="delta"><small>hoje</small> ${reais(d.hoje.receitas)}</span></div>`
      + grafico(d.serie)
      + `<div class="trio">${tile('RECEBIDO', `<span data-conta="${t.receitas}">R$ 0</span>`, '', 'pos')}${tile('PAGO', `<span data-conta="${t.despesas}">R$ 0</span>`)}${tile('SALDO', `${t.saldo < 0 ? '−' : ''}${reais(Math.abs(t.saldo))}`, '', t.saldo < 0 ? 'ambar' : 'pos')}</div>`
      + (d.empresas || d.pessoal ? `<div class="escopos">${escopo('EMPRESAS', d.empresas)}${escopo('PESSOAL', d.pessoal)}</div>` : '')
      + (d.por_empresa.length ? '<div class="metas"><span class="rot">RECEBIDO POR EMPRESA</span>' + d.por_empresa.map((e) => `<div class="meta-top"><span>${esc(curtoEmpresa(e.empresa))}</span><span class="mono">${reais(e.receitas)}</span></div>`).join('') + '</div>' : '')
      + '<p class="nota">Mesma conta do dashboard do Financeiro: só o que está pago, pela data de pagamento.</p>';
    contarTodos(el);
  }

  /* ---- 05 contas ---- */
  function contas(d) {
    const el = corpo('pContas');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    const bloco = (rot, b, cls) => falhou(b) ? `<div class="bloco"><span class="rot">${rot}</span><p class="falha">sem leitura</p></div>`
      : `<div class="bloco ${b.qtd ? cls : ''}"><span class="num" data-conta="${b.qtd}" data-fmt="n">0</span><span class="rot">${rot}</span><span class="mono soma">${reais(b.total)}</span></div>`;
    const linha = (c, tag) => `<div class="conta"><span class="txt">${esc(c.descricao)}<small>${esc(curtoEmpresa(c.empresa))}</small></span><span class="mono">${reais(c.valor)}</span>${tag}</div>`;
    let lista = '';
    if (d.hoje.qtd) lista += '<span class="rot sub">VENCEM HOJE</span>' + d.hoje.itens.map((c) => linha(c, '')).join('') + (d.hoje.qtd > d.hoje.itens.length ? `<p class="mais">e mais ${d.hoje.qtd - d.hoje.itens.length}</p>` : '');
    if (!falhou(d.atraso) && d.atraso.qtd) lista += '<span class="rot sub ambar">MAIORES VENCIDAS</span>' + d.atraso.itens.map((c) => linha(c, `<span class="tag ambar">${c.dias_atraso}d</span>`)).join('');
    el.innerHTML = `<div class="trio">${bloco('VENCIDAS', d.atraso, 'ambar')}${bloco('VENCEM HOJE', d.hoje, 'ativo')}${bloco('A VENCER 7 DIAS', d.semana, '')}</div>`
      + `<div class="duplo">${tile('A PAGAR · 7 DIAS', reais(d.a_pagar_7d))}${tile('A RECEBER · 7 DIAS', reais(d.a_receber_7d), '', 'pos')}</div>` + lista;
    contarTodos(el);
  }

  /* ---- 06 tráfego ---- */
  function trafego(d) {
    const el = corpo('pTrafego');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    const m = d.meta, g = d.google, n = d.nexus;
    let html = `<div class="plat-cab"><span class="rot">META ADS</span>${!falhou(m) ? `<span class="tag">${m.rodando} rodando</span>` : ''}</div>`;
    html += falhou(m) ? semDado(m) : `<div class="quad">${tile('GASTO', `<span data-conta="${m.gasto}">R$ 0</span>`, m.pct_orcamento != null ? `${m.pct_orcamento}% do orçamento` : '')}${tile('CLIQUES', num(m.cliques), `CTR ${num(m.ctr, 1)}%`)}${tile('COMPRAS', num(m.compras), m.cpa ? `CPA ${reais(m.cpa)}` : 'pelo pixel')}${tile('ROAS', m.roas ? num(m.roas, 1) + 'x' : '—', m.receita ? reais(m.receita) : '')}</div>`;
    html += `<div class="plat-cab"><span class="rot">GOOGLE ADS</span></div>`;
    html += falhou(g) ? semDado(g) : `<div class="trio">${tile('GASTO', reais(g.gasto))}${tile('CLIQUES', num(g.cliques), `CTR ${num(g.ctr, 1)}%`)}${tile('CONVERSÕES', num(g.conversoes, g.conversoes % 1 ? 1 : 0))}</div>`;
    html += `<div class="plat-cab"><span class="rot">VENDAS REAIS · NEXUS</span></div>`;
    html += falhou(n) ? semDado(n) : `<div class="trio">${tile('VENDAS HOJE', num(n.vendas), '', n.vendas ? 'pos' : '')}${tile('CHECKOUTS', `${num(n.checkouts_pagos)}/${num(n.checkouts_iniciados)}`, 'pagos/iniciados')}${tile('ABANDONOS', num(n.abandonados), '', n.abandonados ? 'ambar' : '')}</div>`;
    el.innerHTML = html;
    contarTodos(el);
  }

  /* ---- alertas ---- */
  let alertasAntes = -1;
  function alertas(d) {
    const el = corpo('pAlertas');
    const sec = $('pAlertas');
    if (falhou(d)) { sec.classList.remove('calmo'); return (el.innerHTML = semDado(d)); }
    sec.classList.toggle('calmo', !d.total);
    if (!d.total) {
      el.innerHTML = '<p class="vazio">Nada pedindo atenção agora.</p>' + (d.falhas && d.falhas.length ? `<p class="falha">Não verifiquei: ${esc(d.falhas.map((f) => f.split(':')[0]).join(', '))}</p>` : '');
    } else {
      el.innerHTML = d.itens.map((a) => `<div class="item-alerta${a.urgente ? ' urgente' : ''}">${ICONE_ALERTA}<span>${esc(a.titulo)}</span></div>`).join('')
        + (d.total > d.itens.length ? `<p class="mais">e mais ${d.total - d.itens.length}</p>` : '');
    }
    if (alertasAntes >= 0 && d.total > alertasAntes && window.Nucleo) Nucleo.alerta();
    alertasAntes = d.total;
  }

  /* pontos do topo: verde quando a fonte respondeu, âmbar quando falhou */
  function sistemas(d) {
    const lista = window.sistemasDoPainel(d);
    $('sistemas').innerHTML = lista.map((s, i) => `<li class="${s.ok ? 'ok' : 'off'}" title="${s.nome}: ${s.ok ? 'conectado' : esc(s.motivo || 'sem resposta')}"><span class="ponto" style="animation-delay:${i * 0.35}s"></span>${s.nome}</li>`).join('');
  }
  window.sistemasDoPainel = (d) => [
    { nome: 'FINANCEIRO', ok: !falhou(d.financeiro), motivo: d.financeiro && d.financeiro.erro },
    { nome: 'OPERA', ok: !falhou(d.agenda), motivo: d.agenda && d.agenda.erro },
    { nome: 'META', ok: d.trafego && !falhou(d.trafego.meta), motivo: d.trafego && d.trafego.meta && d.trafego.meta.erro },
    { nome: 'GOOGLE', ok: d.trafego && !falhou(d.trafego.google), motivo: d.trafego && d.trafego.google && d.trafego.google.erro },
    { nome: 'WHATSAPP', ok: !falhou(d.atendimento), motivo: d.atendimento && d.atendimento.erro },
    { nome: 'VIGIA', ok: !falhou(d.alertas), motivo: d.alertas && d.alertas.erro },
  ];

  /* ---- o período de financeiro e tráfego: sempre o mês ao abrir ---- */
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function intervalo(p) {
    const hoje = ymd(new Date());
    const [a, m] = hoje.split('-').map(Number);
    if (p === 'hoje') return { de: hoje, ate: hoje, rotulo: 'hoje' };
    if (p === '7d') return { de: ymd(new Date(Date.now() - 6 * 86400000)), ate: hoje, rotulo: '7 dias' };
    if (p === 'mes_anterior') {
      const ini = new Date(Date.UTC(a, m - 2, 1)), fim = new Date(Date.UTC(a, m - 1, 0));
      return { de: ini.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10), rotulo: MESES[ini.getUTCMonth()] };
    }
    return null; // o mês corrente: o padrão do servidor
  }
  let periodo = null; // null = mês corrente
  function marcarSeletor(chave, rotulo) {
    document.querySelectorAll('#periodo button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === chave)));
    const c = document.querySelector('#periodo .custom');
    c.hidden = chave !== 'custom'; c.textContent = chave === 'custom' ? rotulo : '';
    document.querySelectorAll('#pFinanceiro .per, #pTrafego .per').forEach((s) => { s.textContent = rotulo; });
  }
  $('periodo').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    periodo = intervalo(b.dataset.p);
    marcarSeletor(b.dataset.p, periodo ? periodo.rotulo : 'mês');
    atualizar();
  });
  /* chamado pelo app.js quando a voz pediu outro período (lib/tela.js) */
  window.definirPeriodo = (p) => {
    if (!p || p.mes) { periodo = null; marcarSeletor('mes', 'mês'); }
    else {
      periodo = { de: p.de, ate: p.ate || p.de, rotulo: p.rotulo || `${p.de.slice(8, 10)}/${p.de.slice(5, 7)} a ${(p.ate || p.de).slice(8, 10)}/${(p.ate || p.de).slice(5, 7)}` };
      marcarSeletor('custom', periodo.rotulo);
    }
    atualizar();
  };

  let carregando = null, deNovo = false;
  function atualizar() {
    // trocou o período no meio de uma leitura: lê de novo quando acabar
    if (carregando) { deNovo = true; return carregando; }
    carregando = (async () => {
      try {
        const qs = periodo ? `?de=${periodo.de}&ate=${periodo.ate}` : '';
        const r = await fetch('/api/painel' + qs, { credentials: 'same-origin' });
        if (r.status === 401) return null;
        const d = await r.json();
        const desenhar = [[tarefas, d.tarefas], [agenda, d.agenda], [atendimento, d.atendimento], [alertas, d.alertas],
          [financeiro, d.financeiro], [contas, d.contas], [trafego, d.trafego]];
        for (const [fn, dado] of desenhar) { try { fn(dado); } catch (e) { console.warn('[jarvis] painel:', e.message); } }
        sistemas(d);
        return d;
      } catch (e) {
        console.warn('[jarvis] painel indisponível:', e.message);
        return null;
      } finally {
        carregando = null;
        if (deNovo) { deNovo = false; atualizar(); }
      }
    })();
    return carregando;
  }

  /* o check da tela conclui de verdade, sem passar pelo modelo */
  $('pTarefas').addEventListener('change', async (e) => {
    const cb = e.target.closest('input[data-id]');
    if (!cb) return;
    cb.closest('.tarefa').classList.toggle('feita', cb.checked);
    try {
      await fetch('/api/painel', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: cb.checked ? 'concluir' : 'reabrir', id: cb.dataset.id }) });
    } catch (err) { cb.checked = !cb.checked; }
    atualizar();
  });

  $('painelBtn').addEventListener('click', () => document.body.classList.toggle('painel-aberto'));

  window.atualizarPainel = atualizar;
  window.painelPronto = atualizar();
  setInterval(atualizar, 120000);
})();
