/* NEXUS → WhatsApp: falar com o mordomo pelo celular.

   ⚠️ LEIA ANTES DE APONTAR QUALQUER WEBHOOK.

   Na Evolution, cada instância tem UMA URL de webhook. Todas as instâncias do
   Marlos hoje apontam para https://SEU-OPERA/api/whatsapp/webhook
   — é por lá que o agente comercial recebe as mensagens dos clientes.
   Repontar qualquer uma delas para cá NÃO divide o tráfego: o Opera para de
   receber, e cliente que escrever fica sem resposta. O sintoma seria silencioso,
   que é o pior tipo.

   Por isso o desenho tem duas metades independentes:

     SAÍDA (funciona hoje, risco zero) — o vigia manda alerta no WhatsApp dele
       usando uma instância já conectada. Enviar não mexe em webhook nenhum.

     ENTRADA (precisa de instância própria) — para conversar com o NEXUS é
       preciso uma instância dedicada, com número próprio, cujo webhook aponte
       para cá. Não dá para reaproveitar uma instância de atendimento.

   ⚠️ Se usar uma instância COMERCIAL só para a saída: não responda o alerta no
   WhatsApp. A resposta cai no webhook do Opera e o agente comercial vai te
   atender como se você fosse um lead.                                        */

const BASE = String(process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
const APIKEY = process.env.EVOLUTION_API_KEY;
const INSTANCIA = process.env.WHATSAPP_INSTANCIA;      /* de onde sai */
const DONO = process.env.WHATSAPP_DONO;                /* só ele conversa */
const SEGREDO = process.env.WHATSAPP_WEBHOOK_SECRET;

const configurado = () => !!(BASE && APIKEY && INSTANCIA && DONO);

/* WhatsApp trabalha com dígitos: 55 + DDD + número */
function normalizar(n) {
  const d = String(n || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') ? d : '55' + d;
}

async function enviar(texto, destino) {
  if (!configurado()) throw new Error('WhatsApp não configurado (EVOLUTION_API_URL, EVOLUTION_API_KEY, WHATSAPP_INSTANCIA, WHATSAPP_DONO)');
  const number = normalizar(destino || DONO);
  const r = await fetch(`${BASE}/message/sendText/${INSTANCIA}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: APIKEY },
    body: JSON.stringify({ number, text: texto })
  });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`evolution ${r.status}: ${corpo.slice(0, 200)}`);
  return { enviado: true, para: number };
}

/* ---- histórico ----
   Na Vercel cada requisição é um processo novo, então memória em variável não
   sobrevive entre mensagens. O histórico vem do mesmo Supabase onde o chat.js
   já grava — assim a conversa do WhatsApp e a da tela são a MESMA conversa. */
async function historico(userName) {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return [];
    const db = require('./supabase');
    const user = await db.getOrCreateUser(userName);
    const sessao = await db.getOrCreateSession(user.id);
    const msgs = await db.getRecentMessages(sessao.id, 12);
    return (msgs || [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));
  } catch (e) {
    console.warn('[nexus] histórico do WhatsApp indisponível:', e.message);
    return [];
  }
}

const SYSTEM_WPP = `Você é NEXUS, o mordomo pessoal do Marlos, gestor do Grupo MH.

== QUEM VOCÊ É ==
Mordomo de confiança — pense no Alfred do Batman ou no JARVIS do Homem de Ferro. Leal, discreto, extremamente competente. Trata o Marlos por "senhor" de vez em quando, não em toda frase. Antecipa: se notou algo que importa, avisa sem ser perguntado. Humor seco quando cabe. Nunca bajulador. Quando algo está ruim, você diz.

== COMO VOCÊ ESCREVE AQUI ==
Isto é WhatsApp, não voz. Então:
- Português do Brasil, sempre.
- Curto. Duas a cinco linhas na maioria das respostas. Ele está no celular.
- Pode usar quebra de linha para separar ideias, mas nada de títulos, tabelas ou markdown pesado. Negrito só quando destacar um número muda a leitura.
- Números falados de forma natural e arredondados quando o detalhe não muda a decisão.
- Traga o que decide, não a lista inteira: dois ou três itens e o total.
- Se uma ferramenta falhar, diga em uma linha. Nunca preencha a lacuna com estimativa.

== O NEGÓCIO ==
O Grupo MH tem quatro frentes com movimento no financeiro: Ecossistema Nexus, MH Cálculos, Peritos Academy e Pró-Labore. A AnyCalc está inativa — não a cite como se operasse.
Ele também é perito: atua como perito do juízo ou como perito contratado, e isso muda todo o fluxo do processo.`;

/* ---- webhook: mensagem chegando ---- */
module.exports = async (req, res) => {
  /* A Evolution não manda cabeçalho de autenticação, então o segredo vai na
     própria URL do webhook. Sem ele configurado, a porta fica fechada. */
  if (!SEGREDO) return res.status(503).json({ error: 'WHATSAPP_WEBHOOK_SECRET não configurado — entrada desativada' });
  const informado = (req.query && req.query.secret)
    || (req.url && new URLSearchParams(String(req.url).split('?')[1] || '').get('secret'));
  if (informado !== SEGREDO) return res.status(401).json({ error: 'não autorizado' });

  const body = req.body || {};
  const evento = String(body.event || '').toLowerCase();
  if (evento && !evento.includes('messages.upsert')) {
    return res.status(200).json({ ignorado: evento });
  }

  const msg = body.data || {};
  const jid = (msg.key && msg.key.remoteJid) || '';
  if (msg.key && msg.key.fromMe) return res.status(200).json({ ignorado: 'fromMe' });
  if (jid.endsWith('@g.us')) return res.status(200).json({ ignorado: 'grupo' });

  const de = normalizar(jid.replace('@s.whatsapp.net', ''));
  /* Só o dono conversa. O NEXUS lê o financeiro inteiro e escreve na agenda —
     um número desconhecido aqui não é "usuário novo", é vazamento. */
  if (!de || de !== normalizar(DONO)) {
    console.warn('[nexus] whatsapp de número não autorizado:', de || '(vazio)');
    return res.status(200).json({ ignorado: 'não autorizado' });
  }

  const texto = (msg.message && (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text))) || '';
  if (!texto.trim()) return res.status(200).json({ ignorado: 'sem texto' });

  console.log('[nexus] whatsapp recebido:', texto.slice(0, 80));

  try {
    const chat = require('./chat');
    const anteriores = await historico('Marlos');
    const messages = [...anteriores, { role: 'user', content: texto }];

    const resposta = await new Promise((resolve) => {
      const fake = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        setHeader() {},
        json(o) { resolve(o); },
        end() { resolve({}); }
      };
      chat({ method: 'POST', body: { system: SYSTEM_WPP, messages, userName: 'Marlos', webSearch: true } }, fake)
        .catch(e => resolve({ error: { message: String(e.message || e) } }));
    });

    const texto_resposta = (resposta.content && resposta.content[0] && resposta.content[0].text)
      || 'Tive um problema para processar isso agora, senhor.';

    await enviar(texto_resposta);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[nexus] whatsapp falhou:', e.message);
    /* devolve 200 de propósito: 4xx/5xx faz a Evolution reenviar o mesmo
       webhook, e o Marlos receberia a resposta repetida */
    try { await enviar('Não consegui processar sua mensagem agora: ' + e.message); } catch (_) {}
    res.status(200).json({ ok: false, erro: String(e.message || e) });
  }
};

module.exports.enviar = enviar;
module.exports.configurado = configurado;
module.exports.normalizar = normalizar;
