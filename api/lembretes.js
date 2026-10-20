/* NEXUS → lembretes: manda no WhatsApp os lembretes que chegaram na hora
   (20/10/2026). Ver lib/tarefas-pessoais.js.

   Quem chama é o pg_cron do Supabase, a cada 5 minutos
   (sql/tarefas-pessoais.sql): o cron da Vercel no Hobby roda no máximo uma
   vez por dia, e lembrete das 15h que chega às 9h do dia seguinte não serve.

   Sem lembrete vencido, a rodada não faz nada e não custa nada: nem modelo,
   nem mensagem. Sem WhatsApp, vai para o celular (central do Nexus).       */

const tarefas = require('../lib/tarefas-pessoais');

module.exports = async (req, res) => {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(503).json({ error: 'CRON_SECRET não configurado' });
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const viaQuery = (req.query && req.query.secret)
    || (req.url && new URLSearchParams(String(req.url).split('?')[1] || '').get('secret'));
  if (auth !== `Bearer ${segredo}` && viaQuery !== segredo) return res.status(401).json({ error: 'não autorizado' });
  if (!tarefas.disponivel()) return res.status(503).json({ error: 'Supabase do Jarvis não configurado' });

  const wpp = require('./whatsapp');
  const enviar = wpp.configurado()
    ? (texto) => wpp.enviar(texto)
    : async (texto) => {
      const { avisarNoCelular } = require('../lib/push');
      const r = await avisarNoCelular({ ref: `lembrete:${Date.now()}`, titulo: 'Lembrete', corpo: texto.replace(/[*_]/g, '').slice(0, 200), para: '/' });
      if (!r || !r.enviado) throw new Error('nem WhatsApp nem celular disponíveis');
      return r;
    };

  try {
    const enviados = await tarefas.dispararLembretes(enviar);
    res.status(200).json({ ok: true, lembretes: enviados.length, enviados });
  } catch (e) {
    console.error('[nexus] lembretes falharam:', e.message);
    res.status(500).json({ ok: false, erro: e.message });
  }
};
