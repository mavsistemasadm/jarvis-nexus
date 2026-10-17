/* ══════════════════════════════════════════════════════
   A PORTA DO NEXUS — a sessão do Jarvis (17/10/2026)

   Até aqui o Jarvis estava aberto: jarvis-nexus.vercel.app respondia a qualquer
   um, e /api/chat lê o financeiro inteiro e grava lançamento. Quem achasse o
   endereço perguntava o saldo e dizia "sim" na confirmação.

   Agora se entra pela conta do NEXUS, com o mesmo SSO dos outros apps: o
   painel abre /abrir/jarvis, que manda o token para /api/nexus-sso daqui. O
   token é conferido no Auth do Nexus, e só passa quem está em JARVIS_DONOS
   (ids de usuário do Nexus). Lista de ids, e não "papel admin": o Jarvis lê o
   financeiro pessoal do dono, e há outros administradores no Nexus.

   A sessão é um cookie assinado (HMAC), sem tabela: o Jarvis roda na Vercel,
   cada requisição é um processo novo, e o cookie se confere sozinho.

   ⚠️ FALHA FECHADA. Sem JARVIS_SESSAO_SEGREDO ou sem JARVIS_DONOS, ninguém
   entra. Um Jarvis que não sabe quem é o dono não pode responder a ninguém.

   ⚠️ O WhatsApp e o cron NÃO passam por aqui: têm segredo próprio
   (WHATSAPP_WEBHOOK_SECRET, CRON_SECRET), e o WhatsApp chama o chat por
   dentro, pelo `interno`.
   ══════════════════════════════════════════════════════ */
const crypto = require('crypto');

const COOKIE = 'jarvis_sessao';
const DIAS = 30;

function segredo() { return (process.env.JARVIS_SESSAO_SEGREDO || '').trim(); }
function donos() {
  return (process.env.JARVIS_DONOS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function assinar(texto) {
  return crypto.createHmac('sha256', segredo()).update(texto).digest('base64url');
}

function criarValor(uid) {
  const corpo = Buffer.from(JSON.stringify({ uid, exp: Date.now() + DIAS * 86400000 })).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

function lerCookie(req, nome) {
  const bruto = (req.headers && req.headers.cookie) || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}

/** O id do dono logado, ou null. Confere assinatura, validade E a lista atual de donos. */
function donoDaSessao(req) {
  if (!segredo() || donos().length === 0) return null;
  const valor = lerCookie(req, COOKIE);
  if (!valor || !valor.includes('.')) return null;
  const [corpo, sig] = valor.split('.');
  const esperado = assinar(corpo);
  if (!sig || sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    // A lista é relida a cada chamada: tirar alguém de JARVIS_DONOS derruba a
    // sessão dele na hora, sem esperar o cookie vencer.
    if (!uid || !exp || exp < Date.now() || !donos().includes(uid)) return null;
    return uid;
  } catch { return null; }
}

function ehHttps(req) {
  return String((req.headers && req.headers['x-forwarded-proto']) || '').includes('https');
}

function gravarSessao(req, res, uid) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(criarValor(uid))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS * 86400}${ehHttps(req) ? '; Secure' : ''}`);
}

function apagarSessao(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${ehHttps(req) ? '; Secure' : ''}`);
}

/** Envolve um handler: sem sessão do dono, 401 e nada roda. */
function comSessao(handler) {
  return async (req, res) => {
    if (!donoDaSessao(req)) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: { message: 'Entre pelo Nexus para usar o Jarvis.' }, login: true }));
    }
    return handler(req, res);
  };
}

module.exports = { comSessao, donoDaSessao, gravarSessao, apagarSessao, donos };
