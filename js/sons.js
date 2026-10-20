/* ============================================================
   OS SONS (20/10/2026)

   Pedido do dono: sons de verdade, gravados, nada de "som de computador".
   Saíram o zumbido e os ruídos sintetizados do app.js; entram efeitos da
   Mixkit (licença Sound Effects Free: uso comercial e pessoal, sem
   atribuição; não pode revender os arquivos soltos). Cortados e
   normalizados em media/sons/ (-16 LUFS), cada um com o número da Mixkit:

     varredura  277   checagem dos sistemas na entrada
     whoosh     2596  passagem da sequência para o vídeo
     subida     1287  o núcleo se formando
     impacto    2908  "JARVIS ONLINE"
     ok         2573  sistema online
     offline    1093  sistema fora
     paineis    902   os painéis se montando
     ouvir      896   começou a ouvir
     confirmar  911   cartão esperando o "sim"
     transicao  166   passagem curta

   Os arquivos são baixados ao abrir a página e decodificados no primeiro
   toque (o navegador só libera áudio depois de um gesto). "Efeitos
   sonoros" desligado nas configurações cala tudo.
   ============================================================ */
(function () {
  const NOMES = ['varredura', 'whoosh', 'subida', 'impacto', 'ok', 'offline', 'paineis', 'ouvir', 'confirmar', 'transicao'];
  const brutos = {};
  const buffers = {};
  let ctx = null, mestre = null;

  NOMES.forEach((n) => {
    brutos[n] = fetch(`/media/sons/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  });

  const ligado = () => { const el = document.getElementById('sfxOn'); return !el || el.checked; };

  function iniciar() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      mestre = ctx.createGain(); mestre.gain.value = 0.9; mestre.connect(ctx.destination);
      NOMES.forEach((n) => brutos[n].then((ab) => ab && ctx.decodeAudioData(ab.slice(0)).then((b) => { buffers[n] = b; }).catch(() => {})));
    } catch (e) { ctx = null; }
  }

  /** Toca um som. `vol` 0–1, `atraso` em segundos. Devolve uma função que
      corta o som com um fade curto (a varredura para quando a sequência
      acaba). */
  function tocar(nome, vol = 0.7, atraso = 0) {
    if (!ctx || !ligado() || !buffers[nome]) return () => {};
    const s = ctx.createBufferSource(); s.buffer = buffers[nome];
    const g = ctx.createGain(); g.gain.value = vol;
    s.connect(g); g.connect(mestre);
    const t = ctx.currentTime + atraso;
    s.start(t);
    return () => { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.12); s.stop(ctx.currentTime + 0.6); } catch (e) {} };
  }

  /** Espera os sons decodificarem (no máximo `ms`), para a entrada não
      começar muda numa conexão lenta. */
  async function prontos(ms = 1500) {
    const fim = Date.now() + ms;
    while (Date.now() < fim && NOMES.some((n) => !buffers[n])) await new Promise((r) => setTimeout(r, 60));
  }

  window.Sons = { iniciar, tocar, prontos };
})();
