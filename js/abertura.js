/* ============================================================
   A ENTRADA (20/10/2026)

   Pedido do dono: "algo mais Hollywood". Ao tocar para ativar:

   1. Sequência de inicialização: cantos de mira, linhas que checam cada
      sistema com o estado REAL (window.painelPronto, de js/painel.js),
      barra de progresso, coluna de código correndo. Som de subida e um
      bipe por linha.
   2. O vídeo da abertura (js/nucleo.js): a rede se conecta e acende o
      núcleo.
   3. Impacto: estrondo, acorde brilhante e "JARVIS ONLINE" com falha de
      holograma. Ele cumprimenta pela hora e diz se algum sistema caiu.
   4. Os painéis se montam (body.pronto, css/style.css).

   O som é sintetizado na hora (Web Audio, as funções de som do app.js):
   nada para baixar. Desligar "Abertura ao ligar" ou "reduzir movimento"
   pula direto para o fim.

   ⚠️ Um sistema fora do ar aparece como OFFLINE em âmbar e entra na fala.
   A entrada não esconde problema para ficar bonita.
   ============================================================ */
(function () {
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const somLigado = () => typeof AC !== 'undefined' && AC && document.getElementById('sfxOn').checked;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- sons ---- */
  function bipe(freq = 2100, vol = 0.035, dur = 0.03) {
    if (!somLigado()) return;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + dur + 0.01);
  }
  function subida(dur) {
    if (!somLigado()) return;
    const t = AC.currentTime;
    // ruído que sobe de tom
    const b = AC.createBuffer(1, Math.floor(AC.sampleRate * dur), AC.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = AC.createBufferSource(); s.buffer = b;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(5200, t + dur);
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.92); g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(f); f.connect(g); g.connect(AC.destination); s.start(t);
    // um grave que sobe junto
    const o = AC.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(220, t + dur);
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const go = AC.createGain(); go.gain.setValueAtTime(0.0001, t); go.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.9); go.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp); lp.connect(go); go.connect(AC.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function acorde() {
    if (!somLigado()) return;
    const t = AC.currentTime;
    [220, 329.63, 440, 554.37, 659.25, 880].forEach((fq, i) => {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = fq;
      o.detune.value = (i - 2.5) * 4;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.08 + i * 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + 3.3);
    });
  }
  function impacto() { if (typeof boom === 'function') boom(1); acorde(); }

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
    if (!sistemas) return `${ola}, senhor. Núcleo online.`;
    if (!fora.length) return `${ola}, senhor. Todos os sistemas online.`;
    return `${ola}, senhor. Sistemas online, exceto ${fora.join(' e ').replace(' e ', fora.length > 2 ? ', ' : ' e ')}.`;
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
    await espera(350);
    subida(3.4);

    const base = [
      ['NÚCLEO NEURAL', 'ONLINE'], ['SÍNTESE DE VOZ', 'ONLINE'],
      ['RECONHECIMENTO DE FALA', (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'ONLINE' : 'SÓ TEXTO'],
      ['MEMÓRIA DE LONGO PRAZO', 'ONLINE'],
    ];
    progresso(cena.el, 38, 1100);
    for (const [nome, estado] of base) {
      const marcar = linhaSeq(lista, nome); bipe(1800);
      await espera(150); marcar(estado, estado === 'ONLINE'); bipe(2600, 0.025);
      await espera(110);
    }
    // os sistemas de verdade: o que o painel conseguiu ler
    const d = await Promise.race([window.painelPronto || Promise.resolve(null), espera(2600)]);
    const sistemas = d && window.sistemasDoPainel ? window.sistemasDoPainel(d) : null;
    progresso(cena.el, 100, 1200);
    for (const s of sistemas || [{ nome: 'SISTEMAS DO GRUPO MH', ok: false }]) {
      const marcar = linhaSeq(lista, s.nome === 'META' ? 'META ADS' : s.nome === 'GOOGLE' ? 'GOOGLE ADS' : s.nome);
      bipe(1800);
      await espera(130);
      marcar(sistemas ? (s.ok ? 'ONLINE' : 'OFFLINE') : 'SEM RESPOSTA', s.ok); bipe(s.ok ? 2600 : 900, 0.03, s.ok ? 0.03 : 0.08);
      await espera(90);
    }
    await espera(450);
    cena.el.classList.add('saindo');
    setTimeout(() => { cena.parar(); cena.el.remove(); }, 900);

    // o vídeo do núcleo nascendo; no fim, o impacto
    Nucleo.abertura(async () => {
      impacto();
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

  window.Abertura = { iniciar, bipe };
})();
