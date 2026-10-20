/* NEXUS → fim-do-dia: o fechamento no WhatsApp, às 18h30 de Brasília nos
   dias úteis (20/10/2026). Ver lib/fechamento.js.

   ⚠️ UMA VEZ POR DIA, e calado se ele já pediu "fecha meu dia" na conversa:
   as duas gravam `fim-do-dia:AAAA-MM-DD` na tabela `alertas`.
   `?teste=1` devolve o texto sem enviar nem gravar.                         */

const fechamento = require('../lib/fechamento');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

module.exports = async (req, res) => {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(503).json({ error: 'CRON_SECRET não configurado' });
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const q = new URLSearchParams(String(req.url || '').split('?')[1] || '');
  const viaQuery = (req.query && req.query.secret) || q.get('secret');
  if (auth !== `Bearer ${segredo}` && viaQuery !== segredo) return res.status(401).json({ error: 'não autorizado' });

  const teste = ((req.query && req.query.teste) || q.get('teste')) === '1';
  const hash = fechamento.marca();

  try {
    if (!teste && SB_URL && SB_KEY) {
      const r = await fetch(`${SB_URL}/rest/v1/alertas?hash=eq.${encodeURIComponent(hash)}&select=id&limit=1`, {
        headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` },
      });
      if (r.ok && (await r.json()).length) return res.status(200).json({ ok: true, acao: 'já fechado hoje' });
    }

    const { texto, dados } = await fechamento.textoParaWhatsapp();
    if (teste) return res.status(200).json({ ok: true, teste: true, texto, fontes: Object.keys(dados) });

    const entrega = {};
    try {
      const wpp = require('./whatsapp');
      if (!wpp.configurado()) throw new Error('WhatsApp não configurado');
      await wpp.enviar(texto);
      entrega.whatsapp = { enviado: true };
    } catch (e) {
      entrega.whatsapp = { erro: e.message };
      try {
        const { avisarNoCelular } = require('../lib/push');
        entrega.celular = await avisarNoCelular({ ref: hash, titulo: 'Fechando o dia', corpo: texto.replace(/\*/g, '').slice(0, 200), para: '/' });
      } catch (e2) { entrega.celular = { erro: e2.message }; }
    }

    if ((entrega.whatsapp && entrega.whatsapp.enviado) || (entrega.celular && entrega.celular.enviado)) await fechamento.marcarFeito(texto);
    return res.status(200).json({ ok: true, entrega });
  } catch (e) {
    console.error('[nexus] fim do dia falhou:', e.message);
    return res.status(500).json({ ok: false, erro: e.message });
  }
};
