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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'texto vazio' });

  /* Sem ID fixo de reserva. O antigo apontava para uma voz que não existe
     nesta conta, e o efeito era pior que a ausência: a chamada falhava com
     'voice_not_found' apontando um ID que ninguém tinha configurado. */
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY não configurada' });
  if (!voiceId) return res.status(500).json({ error: 'ELEVENLABS_VOICE_ID não configurada — ' + await listarVozes(apiKey) });

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
        'accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        model_id: 'eleven_multilingual_v2',
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

    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader('content-type', 'audio/mpeg');
    res.setHeader('content-length', buffer.length);
    res.end(buffer);
  } catch (e) {
    console.error('[nexus] TTS erro:', e);
    res.status(500).json({ error: String(e) });
  }
};