/* ============================================================
   O NÚCLEO (20/10/2026)

   Substitui a supernova em Three.js. Duas camadas:

   1. O vídeo (media/nucleo.mp4, gerado no Higgsfield): o núcleo de plasma e
      a rede neural, em loop. É a beleza de cinema, mas é fixo.
   2. A rede viva (canvas #rede): pontos e ligações finas em volta do
      núcleo, com pulsos de luz correndo para fora como sinapses. É o que
      reage: devagar em espera, mais quando ouve, em tempestade quando pensa,
      no ritmo da voz quando fala, âmbar quando chega um alerta.

   A abertura (media/abertura.mp4) toca uma vez ao ativar: a rede se conecta
   no escuro e acende o núcleo, terminando no primeiro quadro do loop.

   ⚠️ O CENTRO DA REDE VEM DO VÍDEO. O núcleo está em 50% × 45,7% do quadro e
   tem raio de 8,3% da largura. Com object-fit: cover, o quadro é escalado e
   cortado; `geometria()` refaz a conta a cada resize. Trocar o vídeo por
   outro com o núcleo em outro lugar = mudar NUCLEO_X/Y/R.
   ============================================================ */
(function () {
  const NUCLEO_X = 0.5, NUCLEO_Y = 0.457, NUCLEO_R = 0.083;
  const VIDEO_W = 1280, VIDEO_H = 716;

  const video = document.getElementById('nucleoVideo');
  const abertura = document.getElementById('aberturaVideo');
  const canvas = document.getElementById('rede');
  const ctx = canvas.getContext('2d');
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, r = 0;
  let nos = [], ligacoes = [], pulsos = [];
  let estado = 'idle', voz = 0, alerta = 0, energia = 0;
  let ultimo = performance.now(), acumulado = 0;

  function geometria() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const escala = Math.max(W / VIDEO_W, H / VIDEO_H);
    const vw = VIDEO_W * escala, vh = VIDEO_H * escala;
    cx = W / 2 + (NUCLEO_X - 0.5) * vw;
    cy = H / 2 + (NUCLEO_Y - 0.5) * vh;
    r = NUCLEO_R * vw;
    montarRede();
  }

  /* Rede em anel elíptico, mais densa perto do núcleo. Semente fixa: a rede
     é a mesma a cada abertura, como um rosto. */
  function montarRede() {
    let semente = 7;
    const aleat = () => { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; };
    nos = [];
    const total = W < 700 ? 60 : 110;
    for (let i = 0; i < total; i++) {
      const ang = aleat() * Math.PI * 2;
      const d = r * (1.12 + Math.pow(aleat(), 1.7) * 2.1);
      nos.push({ x: cx + Math.cos(ang) * d * 1.18, y: cy + Math.sin(ang) * d * 0.9, raio: 0.6 + aleat() * 1.3, fase: aleat() * 6.28, brilho: 0 });
    }
    ligacoes = [];
    const lim = r * 0.75;
    nos.forEach((a, i) => {
      nos.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) }))
        .filter((o) => o.j > i && o.d < lim).sort((p, q) => p.d - q.d).slice(0, 2)
        .forEach((o) => ligacoes.push({ a: i, b: o.j }));
    });
    // fios que nascem na borda do núcleo
    nos.forEach((n, i) => { if (i % 6 === 0) ligacoes.push({ a: -1, b: i }); });
  }

  const ponto = (i, ref) => (i === -1 ? { x: cx + (nos[ref].x - cx) * 0.42, y: cy + (nos[ref].y - cy) * 0.42 } : nos[i]);

  function dispararPulso() {
    if (!ligacoes.length) return;
    const l = ligacoes[Math.floor(Math.random() * ligacoes.length)];
    const ida = l.a === -1 || Math.random() < 0.6;
    pulsos.push({ l, t: 0, v: 0.6 + Math.random() * 0.9, ida });
  }

  function taxa() {
    if (estado === 'thinking') return 14;
    if (estado === 'speaking') return 3 + voz * 12;
    if (estado === 'listening') return 3.5;
    return 0.9;
  }

  function desenhar(agora) {
    requestAnimationFrame(desenhar);
    const dt = Math.min(0.05, (agora - ultimo) / 1000); ultimo = agora;

    // envelope de fala: a mesma onda da supernova, sílaba a sílaba
    const s = agora / 1000;
    const alvoVoz = estado === 'speaking' ? Math.max(0.15, (Math.sin(s * 4.6) * 0.5 + 0.5) * (Math.sin(s * 1.35) * 0.35 + 0.65)) : 0;
    voz += (alvoVoz - voz) * 0.15;
    const alvoEnergia = estado === 'thinking' ? 1 : estado === 'speaking' ? 0.55 + voz * 0.45 : estado === 'listening' ? 0.45 : 0.15;
    energia += (alvoEnergia - energia) * 0.05;
    alerta = Math.max(0, alerta - dt * 0.45);

    if (!reduzir) {
      acumulado += dt * taxa();
      while (acumulado > 1) { dispararPulso(); acumulado -= 1; }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ambar = alerta > 0.02;
    const cor = (a) => (ambar ? `rgba(255,184,77,${a})` : `rgba(110,215,255,${a})`);

    // ligações
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = cor(0.07 + energia * 0.14 + alerta * 0.3);
    ctx.beginPath();
    for (const l of ligacoes) {
      const a = ponto(l.a, l.b), b = nos[l.b];
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // pulsos (sinapses)
    pulsos = pulsos.filter((p) => p.t <= 1);
    for (const p of pulsos) {
      p.t += dt * p.v * (0.8 + energia * 1.4);
      const a = ponto(p.l.a, p.l.b), b = nos[p.l.b];
      const [de, para] = p.ida ? [a, b] : [b, a];
      const x = de.x + (para.x - de.x) * p.t, y = de.y + (para.y - de.y) * p.t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 7);
      g.addColorStop(0, ambar ? 'rgba(255,230,190,.95)' : 'rgba(225,250,255,.95)');
      g.addColorStop(1, cor(0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.283); ctx.fill();
      if (p.t >= 1) nos[p.l.b].brilho = 1;
    }

    // nós
    for (const n of nos) {
      n.brilho = Math.max(0, n.brilho - dt * 1.6);
      const pisca = reduzir ? 0.5 : 0.35 + 0.35 * Math.sin(s * (1.2 + energia * 3) + n.fase);
      const a = Math.min(1, 0.18 + pisca * (0.4 + energia * 0.5) + n.brilho);
      ctx.fillStyle = cor(a);
      ctx.beginPath(); ctx.arc(n.x, n.y, n.raio + n.brilho * 1.6, 0, 6.283); ctx.fill();
    }

    // brilho do núcleo: respira em espera, pulsa com a voz
    const halo = r * (1.35 + voz * 0.35 + energia * 0.15);
    const h = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, halo * 1.6);
    h.addColorStop(0, cor(0.1 + voz * 0.35 + energia * 0.1 + alerta * 0.3));
    h.addColorStop(0.45, cor(0.05 + voz * 0.12 + alerta * 0.12));
    h.addColorStop(1, cor(0));
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = h;
    ctx.beginPath(); ctx.arc(cx, cy, halo * 1.6, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  function definirEstado(s) {
    estado = s;
    // o plasma do vídeo acelera junto: pensa mais rápido, fala mais vivo
    const vel = s === 'thinking' ? 1.7 : s === 'speaking' ? 1.25 : s === 'listening' ? 1.1 : 1;
    try { video.playbackRate = vel; } catch (e) {}
    document.body.dataset.estado = s;
    if (s === 'speaking' || s === 'listening') for (let i = 0; i < 6; i++) dispararPulso();
  }

  /* Toca a abertura e chama `pronto` quando o núcleo acende. Se o vídeo não
     carregar (rede lenta, navegador sem mp4), segue sem ela. */
  function tocarAbertura(pronto) {
    let feito = false;
    const fim = () => {
      if (feito) return; feito = true;
      video.currentTime = 0; video.play().catch(() => {});
      abertura.classList.add('sumindo');
      setTimeout(() => abertura.remove(), 900);
      pronto && pronto();
    };
    const ligada = !(document.getElementById('aberturaOn') && !document.getElementById('aberturaOn').checked);
    if (reduzir || !ligada) { abertura.remove(); return fim(); }
    abertura.classList.add('tocando');
    abertura.currentTime = 0;
    abertura.onended = fim;
    abertura.onerror = fim;
    abertura.play().catch(fim);
    setTimeout(fim, 6500);
  }

  addEventListener('resize', geometria);
  geometria();
  video.play().catch(() => {});
  requestAnimationFrame(desenhar);

  window.Nucleo = {
    estado: definirEstado,
    alerta: () => { alerta = 1; for (let i = 0; i < 12; i++) dispararPulso(); },
    pulso: () => { for (let i = 0; i < 8; i++) dispararPulso(); },
    abertura: tocarAbertura,
  };
})();
