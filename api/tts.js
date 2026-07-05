/* NEXUS → ElevenLabs Text-to-Speech */

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'texto vazio' });

  const voiceId = process.env.ELEVENLABS_VOICE_ID || '9xlSvPMTzYkvYsSUlkKQ';
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY não configurada' });

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
      return res.status(r.status).json({ error: err });
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