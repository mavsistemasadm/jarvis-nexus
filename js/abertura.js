/* ============================================================
   A ENTRADA (20/10/2026)

   Pedido do dono: "algo mais Hollywood". Ao tocar para ativar:

   1. Sequência de inicialização: cantos de mira, linhas que checam cada
      sistema com o estado REAL (window.painelPronto, de js/painel.js),
      barra de progresso, coluna de código correndo. Varredura ao fundo e
      um tom por sistema checado.
   2. O vídeo da abertura (js/nucleo.js): a rede se conecta e acende o
      núcleo.
   3. Impacto cinematográfico e "JARVIS ONLINE" com falha de
      holograma. Ele cumprimenta pela hora e diz se algum sistema caiu.
   4. Os painéis se montam (body.pronto, css/style.css).

   Os sons são gravados (js/sons.js, media/sons/): varredura na checagem,
   tom de confirmação por sistema, whoosh na passagem, subida enquanto o
   núcleo se forma e o impacto no "JARVIS ONLINE". Desligar "Abertura ao
   ligar" ou "reduzir movimento" pula direto para o fim.

   ⚠️ Um sistema fora do ar aparece como OFFLINE em âmbar e entra na fala.
   A entrada não esconde problema para ficar bonita.
   ============================================================ */
(function () {
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- sons: gravados, de js/sons.js ---- */
  const som = (nome, vol, atraso) => (window.Sons ? Sons.tocar(nome, vol, atraso) : () => {});

  /* ---- a cena ---- */
  function montar() {
    const el = document.createElement('div');
    el.id = 'sequencia';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <span class="canto c1"></span><span class="canto c2"></span><span class="canto c3"></span><span class="canto c4"></span>
      <div class="seq-topo"><span class="seq-marca">JARVIS</span><span>SEQUÊNCIA DE INICIALIZAÇÃO</span><span class="seq-id">GRUPO MH · ${new Date().toLocaleDateString('pt-BR')}</span></div>
      <div class="seq-centro">
        <div class="seq-mira"><span></span><span></span><span></span></div>
        <div class="seq-linhas"></div>
        <div class="seq-progresso"><div class="seq-barra"><span></span></div><span class="seq-pct">000%</span></div>
      </div>
      <div class="seq-hex"></div>`;
    document.body.appendChild(el);
    // a coluna de código que corre ao lado
    const hex = el.querySelector('.seq-hex');
    const linha = () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, '0')).join(' ');
    hex.textContent = Array.from({ length: 40 }, linha).join('\n');
    const corre = setInterval(() => { hex.textContent = linha() + '\n' + hex.textContent.split('\n').slice(0, 39).join('\n'); }, 70);
    return { el, parar: () => clearInterval(corre) };
  }

  function linhaSeq(lista, nome) {
    const l = document.createElement('div');
    l.className = 'seq-linha';
    l.innerHTML = `<span class="nome">${nome}</span><span class="pontos"></span><span class="estado">CARREGANDO</span>`;
    lista.appendChild(l);
    return (estado, ok = true) => { const e = l.querySelector('.estado'); e.textContent = estado; e.classList.add(ok ? 'ok' : 'off'); };
  }

  function progresso(el, ate, ms) {
    const barra = el.querySelector('.seq-barra span'), pct = el.querySelector('.seq-pct');
    const de = Number(pct.dataset.v || 0), ini = performance.now();
    return new Promise((fim) => {
      const passo = (agora) => {
        const k = Math.min(1, (agora - ini) / ms);
        const v = Math.round(de + (ate - de) * k);
        barra.style.width = v + '%'; pct.textContent = String(v).padStart(3, '0') + '%'; pct.dataset.v = v;
        k < 1 ? requestAnimationFrame(passo) : fim();
      };
      requestAnimationFrame(passo);
    });
  }

  function saudacao(sistemas) {
    const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })) % 24;
    const ola = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    const fora = (sistemas || []).filter((s) => !s.ok).map((s) => s.nome.charAt(0) + s.nome.slice(1).toLowerCase());
    if (!sistemas) return `${ola}, Marlos. Núcleo online.`;
    if (!fora.length) return `${ola}, Marlos. Todos os sistemas online.`;
    return `${ola}, Marlos. Sistemas online, exceto ${fora.join(' e ').replace(' e ', fora.length > 2 ? ', ' : ' e ')}.`;
  }

  async function iniciar(pronto) {
    const ligada = !(document.getElementById('aberturaOn') && !document.getElementById('aberturaOn').checked);
    if (reduzir || !ligada || !window.Nucleo) {
      const d = await Promise.race([window.painelPronto || Promise.resolve(null), espera(1500)]);
      if (window.Nucleo) Nucleo.abertura(() => pronto(null));
      else pronto(null);
      return;
    }
    const cena = montar();
    const lista = cena.el.querySelector('.seq-linhas');
    if (window.Sons) await Sons.prontos(1200);
    await espera(250);
    const pararVarredura = som('varredura', 0.4);

    const base = [
      ['NÚCLEO NEURAL', 'ONLINE'], ['SÍNTESE DE VOZ', 'ONLINE'],
      ['RECONHECIMENTO DE FALA', (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'ONLINE' : 'SÓ TEXTO'],
      ['MEMÓRIA DE LONGO PRAZO', 'ONLINE'],
    ];
    progresso(cena.el, 38, 1100);
    for (const [nome, estado] of base) {
      const marcar = linhaSeq(lista, nome);
      await espera(150); marcar(estado, estado === 'ONLINE'); som(estado === 'ONLINE' ? 'ok' : 'offline', 0.3);
      await espera(110);
    }
    // os sistemas de verdade: o que o painel conseguiu ler
    const d = await Promise.race([window.painelPronto || Promise.resolve(null), espera(2600)]);
    const sistemas = d && window.sistemasDoPainel ? window.sistemasDoPainel(d) : null;
    progresso(cena.el, 100, 1200);
    for (const s of sistemas || [{ nome: 'SISTEMAS DO GRUPO MH', ok: false }]) {
      const marcar = linhaSeq(lista, s.nome === 'META' ? 'META ADS' : s.nome === 'GOOGLE' ? 'GOOGLE ADS' : s.nome);
      await espera(130);
      marcar(sistemas ? (s.ok ? 'ONLINE' : 'OFFLINE') : 'SEM RESPOSTA', s.ok); som(s.ok ? 'ok' : 'offline', s.ok ? 0.32 : 0.5);
      await espera(90);
    }
    await espera(350);
    pararVarredura();
    som('whoosh', 0.75);
    som('subida', 0.55, 0.5);
    cena.el.classList.add('saindo');
    setTimeout(() => { cena.parar(); cena.el.remove(); }, 900);

    // o vídeo do núcleo nascendo; no fim, o impacto
    Nucleo.abertura(async () => {
      som('impacto', 0.95);
      if (window.Nucleo) Nucleo.pulso();
      const titulo = document.createElement('div');
      titulo.id = 'online';
      titulo.setAttribute('aria-hidden', 'true');
      titulo.innerHTML = '<span class="t">JARVIS ONLINE</span><span class="s"></span>';
      titulo.querySelector('.s').textContent = saudacao(sistemas);
      document.body.appendChild(titulo);
      await espera(1700);
      titulo.classList.add('saindo');
      setTimeout(() => titulo.remove(), 800);
      pronto(saudacao(sistemas));
    });
  }

  window.Abertura = { iniciar };
})();
