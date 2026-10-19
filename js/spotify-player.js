/* ══════════════════════════════════════════════════════
   O JARVIS É O TOCADOR (19/10/2026)

   Pedido do dono: tocar música sem precisar do Spotify aberto em lugar
   nenhum. O Web Playback SDK (oficial do Spotify, conta Premium) faz esta
   página virar um aparelho chamado "Jarvis": com o Jarvis aberto, a música
   sai daqui. O servidor (api/spotify.js) prefere este aparelho quando nenhum
   outro está tocando.

   - Só carrega o SDK se o Spotify estiver conectado (/api/spotify/status).
   - O navegador só libera áudio depois de um toque: o primeiro clique na
     página chama activateElement.
   - A música abaixa enquanto o Jarvis fala ou escuta, e volta depois.
   ══════════════════════════════════════════════════════ */
(function () {
  var player = null;
  var VOLUME = 0.6, VOLUME_BAIXO = 0.12;

  window.onSpotifyWebPlaybackSDKReady = function () {
    player = new Spotify.Player({
      name: 'Jarvis',
      volume: VOLUME,
      getOAuthToken: function (cb) {
        fetch('/api/spotify/token').then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.token) cb(d.token); })
          .catch(function () {});
      },
    });
    player.addListener('ready', function () { console.log('[spotify] o Jarvis é um aparelho do Spotify'); });
    player.addListener('initialization_error', function (e) { console.warn('[spotify] navegador sem suporte:', e.message); });
    player.addListener('authentication_error', function (e) { console.warn('[spotify] autorização:', e.message); });
    player.addListener('account_error', function (e) { console.warn('[spotify] conta (precisa Premium):', e.message); });
    player.connect();
  };

  fetch('/api/spotify/status').then(function (r) { return r.json(); }).then(function (d) {
    if (!d || !d.conectado) return;
    var s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(s);
  }).catch(function () {});

  // O navegador só toca som depois de um gesto da pessoa.
  document.addEventListener('click', function () {
    if (player && player.activateElement) player.activateElement();
  }, true);

  // A música abaixa enquanto o Jarvis fala ou escuta.
  var setStateAntes = window.setState;
  if (typeof setStateAntes === 'function') {
    window.setState = function (s) {
      setStateAntes(s);
      if (player) player.setVolume(s === 'speaking' || s === 'listening' ? VOLUME_BAIXO : VOLUME).catch(function () {});
    };
  }
})();
