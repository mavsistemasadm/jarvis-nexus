/* Helper do Supabase — chamadas REST diretas, sem biblioteca */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function headers(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'authorization': `Bearer ${SUPABASE_KEY}`,
    'content-type': 'application/json',
    'prefer': 'return=representation',
    ...extra
  };
}

async function query(table, params = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, { headers: headers() });
  return r.json();
}

async function insert(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(data)
  });
  return r.json();
}

async function update(table, match, data) {
  const params = Object.entries(match).map(([k, v]) => `${k}=eq.${v}`).join('&');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify(data)
  });
  return r.json();
}

async function getOrCreateUser(name) {
  const users = await query('users', `name=eq.${encodeURIComponent(name)}&limit=1`);
  if (users.length) return users[0];
  const created = await insert('users', { name });
  return created[0];
}

async function getOrCreateSession(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const sessions = await query('sessions',
    `user_id=eq.${userId}&started_at=gte.${today}T00:00:00&order=started_at.desc&limit=1`);
  if (sessions.length) return sessions[0];
  const created = await insert('sessions', { user_id: userId, title: `Conversa ${today}` });
  return created[0];
}

async function saveMessage(sessionId, role, content) {
  const result = await insert('messages', { session_id: sessionId, role, content });
  return result[0];
}

async function getRecentMessages(sessionId, limit = 20) {
  return query('messages',
    `session_id=eq.${sessionId}&order=created_at.asc&limit=${limit}`);
}

async function getMemories(userId) {
  return query('memories', `user_id=eq.${userId}&order=updated_at.desc&limit=50`);
}

async function addMemory(userId, category, content, sourceMessageId = null) {
  return insert('memories', {
    user_id: userId, category, content,
    source_message_id: sourceMessageId
  });
}

async function getRoutines(userId, triggerType) {
  return query('routines',
    `user_id=eq.${userId}&trigger_type=eq.${triggerType}&active=eq.true`);
}

async function searchHistory(userId, searchText) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_messages`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ p_user_id: userId, p_search: searchText })
  });
  return r.json();
}

async function isFirstOfDay(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const sessions = await query('sessions',
    `user_id=eq.${userId}&started_at=gte.${today}T00:00:00&limit=1`);
  if (!sessions.length) return true;
  const msgs = await query('messages',
    `session_id=eq.${sessions[0].id}&limit=1`);
  return msgs.length === 0;
}

module.exports = {
  getOrCreateUser, getOrCreateSession, saveMessage,
  getRecentMessages, getMemories, addMemory,
  getRoutines, searchHistory, isFirstOfDay, query
};