/* ============================================================
   OS SONS (20/10/2026)

   Pedido do dono: sons de verdade, gravados, nada de "som de computador",
   e a entrada com cara de algo LIGANDO (relé, energia subindo, máquina
   dando partida), não de uma chegada com impacto. Efeitos da Mixkit
   (licença Sound Effects Free: uso comercial e pessoal, sem atribuição; não
   pode revender os arquivos soltos), cortados e normalizados em
   media/sons/ (-16 LUFS), com o número e o título na Mixkit:

     ligar       1808  Electric switch              o toque: relé armando
     energia     2602  Electronics power up          checagem: energia subindo
     servos      3117  Mechanical technology movements  textura por baixo
     clique      2582  Quick switch click            cada sistema checado
     partida     2689  Futuristic machine starting   o núcleo se formando
     estabiliza  3201  Electric charge hum           "JARVIS ONLINE"
     paineis     2530  Futuristic robotic mechanism  os painéis se montando
     ouvir       2579  Light switch sound            começou a ouvir
     confirmar   2857  Gear fast lock tap            cartão esperando o "sim"

   ⚠️ A primeira busca (20/10/2026) leu o título do item ANTERIOR da página
   da Mixkit (o título vem depois do arquivo no HTML) e escolheu sons
   errados, que soaram como MIDI. Ao trocar um som, confira o título pelo
   número em mixkit.co antes.

   Os arquivos são baixados ao abrir a página e decodificados no primeiro
   toque (o navegador só libera áudio depois de um gesto). "Efeitos
   sonoros" desligado nas configurações cala tudo.
   ============================================================ */
(function () {
  const NOMES = ['ligar', 'energia', 'servos', 'clique', 'partida', 'estabiliza', 'paineis', 'ouvir', 'confirmar'];
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

  /** Toca um som. `vol` 0–1, `atraso` em segundos, `tom` muda a velocidade
      (1 = original; cliques variam um pouco para não soarem iguais).
      Devolve uma função que corta o som com um fade curto. */
  function tocar(nome, vol = 0.7, atraso = 0, tom = 1) {
    if (!ctx || !ligado() || !buffers[nome]) return () => {};
    const s = ctx.createBufferSource(); s.buffer = buffers[nome]; s.playbackRate.value = tom;
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
