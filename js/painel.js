/* ============================================================
   O HUD EM VOLTA DO NÚCLEO (20/10/2026)

   Desenha os seis painéis com o que /api/painel devolve, o relógio, os
   sistemas conectados no topo e as barras de voz. Atualiza ao abrir, a cada
   2 minutos e depois de cada resposta (window.atualizarPainel, chamado pelo
   app.js).

   ⚠️ Fonte com erro mostra "não consegui verificar", nunca zero nem vazio:
   o painel parado em "nada" quando a fonte caiu é exatamente o defeito que o
   bom dia já teve em produção.
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reais = (v) => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ICONE_ALERTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>';

  /* ---- relógio ---- */
  function relogio() {
    const d = new Date();
    const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: 'short' })
      .replace(/\./g, '').replace(',', ' ·').toUpperCase();
    $('relogio').querySelector('.hora').textContent = hora;
    $('relogio').querySelector('.data').textContent = data;
  }
  relogio(); setInterval(relogio, 20000);

  /* ---- barras de voz ---- */
  const ondas = $('ondas');
  for (let i = 0; i < 40; i++) {
    const b = document.createElement('span');
    const h = 8 + Math.round(26 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)));
    b.style.height = h + 'px';
    b.style.animationDuration = (0.35 + ((i * 37) % 30) / 100).toFixed(2) + 's';
    b.style.animationDelay = (-((i * 53) % 70) / 100).toFixed(2) + 's';
    b.style.opacity = (0.4 + 0.6 * Math.sin((i / 39) * Math.PI)).toFixed(2);
    ondas.appendChild(b);
  }

  /* ---- número que conta até o valor ---- */
  function contar(el, valor) {
    const de = Number(el.dataset.valor || 0);
    el.dataset.valor = valor;
    if (reduzir || de === valor) { el.textContent = reais(valor); return; }
    const ini = performance.now();
    const passo = (agora) => {
      const k = Math.min(1, (agora - ini) / 1200);
      el.textContent = reais(de + (valor - de) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  const falhou = (d) => !d || d.erro;
  const semDado = () => '<p class="falha">Não consegui verificar agora.</p>';
  const corpo = (id) => $(id).querySelector('.corpo');

  /* ---- os seis painéis ---- */
  function tarefas(d) {
    const el = corpo('pTarefas');
    if (falhou(d)) return (el.innerHTML = d && d.erro === 'não configurado' ? '<p class="vazio">Peça "me lembra de…" para começar a lista.</p>' : semDado(d));
    if (!d.itens.length) return (el.innerHTML = '<p class="vazio">Nada anotado para hoje.</p>');
    el.innerHTML = d.itens.map((t) => {
      const feita = t.estado === 'feita';
      const marca = feita ? '<span class="tag">FEITA</span>' : t.atrasada ? '<span class="tag ambar">ATRASADA</span>'
        : t.aviso ? `<span class="tag">${esc(t.aviso.replace(/^hoje às /, '').toUpperCase())}</span>` : '';
      return `<label class="tarefa${feita ? ' feita' : ''}"><input type="checkbox" data-id="${esc(t.id)}"${feita ? ' checked' : ''}><span class="txt">${esc(t.texto)}</span>${marca}</label>`;
    }).join('');
  }

  function agenda(d) {
    const el = corpo('pAgenda');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    if (!d.itens.length) return (el.innerHTML = '<p class="vazio">Nada marcado para hoje e amanhã.</p>');
    el.innerHTML = d.itens.map((e) => {
      const hora = String(e.quando).length > 10 ? new Date(e.quando).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '';
      const quando = e.hoje ? (hora || 'HOJE') : 'AMANHÃ';
      return `<div class="evento${e.critico ? ' critico' : ''}"><span class="quando">${quando}</span><div class="linha"><span class="titulo">${esc(e.titulo)}</span><span class="tipo">${esc(e.tipo.toUpperCase())}${e.local ? ' · ' + esc(e.local) : ''}</span></div></div>`;
    }).join('') + (d.total > d.itens.length ? `<p class="mais">e mais ${d.total - d.itens.length}</p>` : '');
  }

  function whatsapp(d) {
    const el = corpo('pWhatsapp');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    if (!d.total && !d.escalados) return (el.innerHTML = '<p class="vazio">Ninguém esperando resposta.</p>');
    el.innerHTML = `<div class="grande"><span class="num">${d.total}</span><span class="rot">${d.total === 1 ? 'conversa esperando' : 'conversas esperando'}${d.escalados ? ` · ${d.escalados} com o agente` : ''}</span></div>`
      + d.itens.map((c) => `<div class="pessoa"><span>${esc(c.nome)}</span><span class="tag${c.ha_dias >= 1 ? ' ambar' : ''}">${c.ha_dias >= 1 ? c.ha_dias + 'd' : 'hoje'}</span></div>`).join('');
  }

  function dinheiro(d) {
    const el = corpo('pDinheiro');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    if (!el.querySelector('.valor')) {
      el.innerHTML = '<div class="grande"><span class="num valor">R$ 0</span><span class="rot">entrou hoje</span></div><div class="divisao"></div><p class="saiu"></p>';
    }
    contar(el.querySelector('.valor'), d.receitas);
    el.querySelector('.divisao').innerHTML = d.por_empresa.length
      ? d.por_empresa.map((e) => `<div><span class="rot">${esc(String(e.empresa).replace(/^Ecossistema /, '').toUpperCase())}</span><span class="mono">${reais(e.valor)}</span></div>`).join('')
      : '<p class="vazio">Nenhuma receita lançada hoje ainda.</p>';
    el.querySelector('.saiu').textContent = d.despesas ? `Saiu ${reais(d.despesas)} hoje` : '';
  }

  function medidor(nome, m, extra) {
    if (falhou(m)) return `<div class="plat"><span class="rot">${nome}</span><p class="falha">sem leitura</p></div>`;
    return `<div class="plat"><span class="rot">${nome}</span><span class="mono grande-num">${reais(m.gasto)}</span><span class="det">${extra(m)}</span></div>`;
  }
  function trafego(d) {
    const el = corpo('pTrafego');
    if (falhou(d)) return (el.innerHTML = semDado(d));
    el.innerHTML = '<div class="plats">'
      + medidor('META', d.meta, (m) => `${m.compras || 0} ${m.compras === 1 ? 'compra' : 'compras'}${m.compras ? ' · CPA ' + reais(m.gasto / m.compras) : ''}`)
      + medidor('GOOGLE', d.google, (m) => `${(m.cliques || 0).toLocaleString('pt-BR')} cliques`)
      + '</div><p class="nota">Gasto de hoje. Venda pelo pixel; a real está no Nexus.</p>';
  }

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
    // alerta novo desde a última leitura: o núcleo acende em âmbar
    if (alertasAntes >= 0 && d.total > alertasAntes && window.Nucleo) Nucleo.alerta();
    alertasAntes = d.total;
  }

  /* pontos do topo: verde quando a fonte respondeu, âmbar quando falhou */
  function sistemas(d) {
    const lista = [
      ['FINANCEIRO', !falhou(d.dinheiro)], ['OPERA', !falhou(d.agenda)],
      ['META', d.trafego && !falhou(d.trafego.meta)], ['GOOGLE', d.trafego && !falhou(d.trafego.google)],
      ['WHATSAPP', !falhou(d.whatsapp)],
    ];
    $('sistemas').innerHTML = lista.map(([n, ok], i) => `<li class="${ok ? 'ok' : 'off'}" title="${n}: ${ok ? 'conectado' : 'sem resposta'}"><span class="ponto" style="animation-delay:${i * 0.35}s"></span>${n}</li>`).join('');
  }

  let carregando = false;
  async function atualizar() {
    if (carregando) return; carregando = true;
    try {
      const r = await fetch('/api/painel', { credentials: 'same-origin' });
      if (r.status === 401) return;
      const d = await r.json();
      tarefas(d.tarefas); agenda(d.agenda); whatsapp(d.whatsapp);
      dinheiro(d.dinheiro); trafego(d.trafego); alertas(d.alertas); sistemas(d);
    } catch (e) {
      console.warn('[jarvis] painel indisponível:', e.message);
    } finally { carregando = false; }
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
  atualizar();
  setInterval(atualizar, 120000);
})();
