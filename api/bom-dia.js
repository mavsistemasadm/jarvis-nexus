/* NEXUS → bom-dia: o bom dia no WhatsApp, às 8h de Brasília (18/10/2026).

   Pedido do dono: o mesmo bom dia da primeira conversa (lib/briefing.js)
   chegando sozinho por mensagem às 8h, todos os dias. Substitui a rodada das
   8h do vigia (/api/rotina), que mandava os alertas no mesmo horário: duas
   mensagens às 8h seriam uma a mais. Os alertas do vigia entram no bom dia; a
   rodada das 16h continua no /api/rotina.

   ⚠️ UMA VEZ POR DIA. A Vercel pode repetir o cron; a tabela `alertas` guarda
   `bom-dia:AAAA-MM-DD` e a segunda chamada do dia fica calada.
   `?teste=1` devolve o texto sem enviar nem gravar.                         */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

function sb(caminho, opcoes = {}) {
  return fetch(`${SB_URL}/rest/v1/${caminho}`, {
    ...opcoes,
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', ...(opcoes.headers || {}) },
  });
}

function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

module.exports = async (req, res) => {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(503).json({ error: 'CRON_SECRET não configurado' });
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const q = new URLSearchParams(String(req.url || '').split('?')[1] || '');
  const viaQuery = (req.query && req.query.secret) || q.get('secret');
  if (auth !== `Bearer ${segredo}` && viaQuery !== segredo) return res.status(401).json({ error: 'não autorizado' });

  const teste = ((req.query && req.query.teste) || q.get('teste')) === '1';
  const hash = `bom-dia:${hojeSP()}`;

  try {
    if (!teste && SB_URL && SB_KEY) {
      const r = await sb(`alertas?hash=eq.${encodeURIComponent(hash)}&select=id&limit=1`);
      if (r.ok && (await r.json()).length) return res.status(200).json({ ok: true, acao: 'já enviado hoje' });
    }

    // A gravação das lives de ontem entra na Academy antes do bom dia.
    const gravacoes = teste ? null : await require('../lib/academy-app').registrarGravacoes();

    const { texto, dados } = await require('../lib/briefing').textoParaWhatsapp();
    if (teste) return res.status(200).json({ ok: true, teste: true, texto, fontes: Object.keys(dados) });

    const entrega = {};
    try {
      const wpp = require('./whatsapp');
      if (!wpp.configurado()) throw new Error('WhatsApp não configurado');
      await wpp.enviar(texto);
      entrega.whatsapp = { enviado: true };
    } catch (e) {
      entrega.whatsapp = { erro: e.message };
      // Sem WhatsApp, o bom dia não pode sumir calado: vai para o celular.
      try {
        const { avisarNoCelular } = require('../lib/push');
        entrega.celular = await avisarNoCelular({
          ref: hash, titulo: 'Bom dia, Marlos', corpo: texto.replace(/\*/g, '').slice(0, 200), para: '/',
        });
      } catch (e2) { entrega.celular = { erro: e2.message }; }
    }

    if (SB_URL && SB_KEY) {
      await sb('alertas', {
        method: 'POST',
        body: JSON.stringify({ hash, resumo: texto.slice(0, 2000), quantidade: 1, entregue_em: new Date().toISOString() }),
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true, entrega, gravacoes });
  } catch (e) {
    console.error('[nexus] bom dia falhou:', e.message);
    return res.status(500).json({ ok: false, erro: e.message });
  }
};
