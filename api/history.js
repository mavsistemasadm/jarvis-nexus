const db = require('./supabase');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'use POST' } });

  const { userName = 'Marlos', search = '' } = req.body || {};

  try {
    const user = await db.getOrCreateUser(userName);

    if (search) {
      const results = await db.searchHistory(user.id, search);
      return res.status(200).json({ results });
    }

    const sessions = await db.query('sessions',
      `user_id=eq.${user.id}&order=started_at.desc&limit=10&select=id,title,started_at`);
    res.status(200).json({ sessions });
  } catch (e) {
    console.error('[nexus] erro no /api/history:', e);
    res.status(500).json({ error: { message: String(e) } });
  }
};