/* NEXUS → ElevenLabs Text-to-Speech */

/* Quando a voz não é encontrada, "voice_not_found" não ajuda ninguém: a
   pergunta seguinte é sempre "então qual eu uso?". Esta função responde
   isso na própria mensagem de erro. */
async function listarVozes(apiKey) {
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } });
    if (!r.ok) return 'não consegui listar as vozes da conta (HTTP ' + r.status + ')';
    const d = await r.json();
    const vs = (d.voices || []).slice(0, 12).map(v => `${v.name} = ${v.voice_id}`);
    return vs.length ? 'vozes disponíveis nesta conta: ' + vs.join(' | ') : 'nenhuma voz nesta conta';
  } catch (e) { return 'não consegui listar as vozes: ' + e.message; }
}

/* A frase anterior (previous_text) dá continuidade à entonação, mas a
   documentação só a garante nos modelos v2 e flash. Nos v3/v4 não é mandada:
   parâmetro desconhecido podia virar recusa da frase inteira. */
/* Uma linha no log com o NOME da voz, na primeira fala de cada instância: a
   variável guarda só o id, e é o nome que diz se é a voz certa. */
let vozRegistrada = false;
const aceitaContexto = (m) => /^eleven_(multilingual_v2|flash_v2)/.test(m);

async function atender(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { text, previous_text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'texto vazio' });

  /* Sem ID fixo de reserva. O antigo apontava para uma voz que não existe
     nesta conta, e o efeito era pior que a ausência: a chamada falhava com
     'voice_not_found' apontando um ID que ninguém tinha configurado. */
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY não configurada' });
  if (!voiceId) return res.status(500).json({ error: 'ELEVENLABS_VOICE_ID não configurada — ' + await listarVozes(apiKey) });

  /* v4 Turbo desde 19/10/2026, com o plano pago: é o que o ElevenLabs indica
     para tempo real (cerca de 100 ms) e tem a expressividade da v4. */
  const modelo = process.env.ELEVENLABS_MODEL || 'eleven_v4_turbo';
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'audio/mpeg'
      },
      /* A fala chega em frases, uma de cada vez, enquanto o texto ainda está
         sendo escrito (19/10/2026). O modelo `flash` gera em uma fração do
         tempo do `multilingual_v2`, que era o mais lento do ElevenLabs.
         `previous_text` dá a ele a frase anterior, para a entonação seguir
         em vez de recomeçar a cada frase. ELEVENLABS_MODEL volta ao antigo
         sem deploy, se a voz não agradar. (O modelo é escolhido acima.) */
      body: JSON.stringify({
        text: text.slice(0, 2500),
        ...(previous_text && aceitaContexto(modelo) ? { previous_text: String(previous_text).slice(-1000) } : {}),
        model_id: modelo,
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.82,
          style: 0.18,
          use_speaker_boost: true
        }
      })
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('[nexus] ElevenLabs erro:', err);
      /* voz inexistente é o erro mais comum aqui, e o mais fácil de resolver
         se a resposta já disser quais existem */
      const extra = /voice_not_found/.test(err) ? ' — ' + await listarVozes(apiKey) : '';
      return res.status(r.status).json({ error: err + extra });
    }

    if (!vozRegistrada) {
      vozRegistrada = true;
      fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, { headers: { 'xi-api-key': apiKey } })
        .then(v => v.json()).then(v => console.log(`[nexus] voz em uso: ${v.name || '?'} (${v.category || '?'}) · modelo ${modelo}`))
        .catch(() => {});
    }
    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('content-length', buffer.length);
    res.end(buffer);
  } catch (e) {
    console.error('[nexus] TTS erro:', e);
    res.status(500).json({ error: String(e) });
  }
};

/* Só o dono, pela sessão do Nexus (lib/sessao.js). `interno` é o handler cru,
   para quem chama por dentro já autenticado por outro caminho (o WhatsApp). */
const { comSessao } = require('../lib/sessao');
// O que o arquivo já exportava além da rota (ex.: make.hooks, usado pelo
// chat) continua exportado: trocar module.exports apagava essas funções.
const exportadosAntes = { ...module.exports };
module.exports = Object.assign(comSessao(atender), exportadosAntes);
module.exports.interno = atender;
