/* NEXUS → rotina: o cron que faz o vigia rodar sozinho.

   Chamado pela Vercel nos horários de vercel.json. Avalia as regras, decide
   se vale interromper o Marlos, e entrega.

   POR QUE O DEDUPE EXISTE. Um cron que manda o mesmo aviso duas vezes por dia
   vira ruído, e ruído a gente aprende a ignorar — o alerta morre justamente
   quando fosse útil. Guardamos a impressão digital do último aviso: se nada
   mudou desde o anterior, o cron roda e fica calado.                        */

const crypto = require('crypto');
const vigia = require('../lib/vigia');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const JANELA_SILENCIO_H = Number(process.env.ALERTA_JANELA_HORAS || 10);

function sbHeaders() {
  return {
    'apikey': SB_KEY, 'authorization': `Bearer ${SB_KEY}`,
    'content-type': 'application/json', 'prefer': 'return=representation'
  };
}

/* Sem Supabase o dedupe não existe — avisamos e entregamos assim mesmo.
   Perder um aviso é pior do que repetir um. */
/* `diag` existe porque a falha do dedupe era invisível: a tabela podia não
   existir, ou o anon não ter permissão nela, e o único sintoma era o alerta
   repetido — que se confunde com "o quadro mudou". Silêncio que esconde
   defeito é o mesmo erro que o resto do sistema combate. */
async function jaAvisado(hash, diag) {
  if (!SB_URL || !SB_KEY) { diag.dedupe = 'sem SUPABASE_URL/ANON_KEY'; return false; }
  const desde = new Date(Date.now() - JANELA_SILENCIO_H * 3600000).toISOString();
  const r = await fetch(`${SB_URL}/rest/v1/alertas?hash=eq.${hash}&entregue_em=gte.${desde}&select=id&limit=1`, { headers: sbHeaders() });
  if (!r.ok) {
    diag.dedupe = `leitura falhou: HTTP ${r.status} ${(await r.text()).slice(0, 160)}`;
    return false;
  }
  const achou = (await r.json()).length > 0;
  diag.dedupe = achou ? 'ja avisado nesta janela' : 'nada igual na janela';
  return achou;
}

async function registrar(hash, resumo, qtd, diag) {
  if (!SB_URL || !SB_KEY) return;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/alertas`, {
      method: 'POST', headers: sbHeaders(),
      body: JSON.stringify({ hash, resumo, quantidade: qtd, entregue_em: new Date().toISOString() })
    });
    diag.registro = r.ok ? 'gravado' : `HTTP ${r.status} ${(await r.text()).slice(0, 160)}`;
    if (!r.ok) console.warn('[nexus] alerta não registrado:', diag.registro);
  } catch (e) {
    diag.registro = 'erro: ' + e.message;
    console.warn('[nexus] alerta não registrado:', e.message);
  }
}

async function enviarEmail(assunto, corpo) {
  const key = process.env.RESEND_API_KEY;
  const para = process.env.ALERTA_EMAIL_PARA;
  if (!key || !para) return { pulado: 'RESEND_API_KEY ou ALERTA_EMAIL_PARA não configurados' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.ALERTA_EMAIL_DE || 'NEXUS <onboarding@resend.dev>',
      to: [para],
      subject: assunto,
      text: corpo
    })
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return { enviado: true };
}

module.exports = async (req, res) => {
  /* O endpoint fica numa URL pública. Sem segredo configurado ele não roda —
     senão qualquer um dispara e-mail em nome do NEXUS. */
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return res.status(503).json({ error: 'CRON_SECRET não configurado — rotina desativada' });
  const auth = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  /* na Vercel o req.query vem pronto; no server.js local não existe */
  const viaQuery = (req.query && req.query.secret)
    || (req.url && new URLSearchParams(String(req.url).split('?')[1] || '').get('secret'));
  if (auth !== `Bearer ${segredo}` && viaQuery !== segredo) {
    return res.status(401).json({ error: 'não autorizado' });
  }

  try {
    const resultado = await vigia.avaliar();
    const resumo = vigia.resumir(resultado);
    const urgentes = resultado.alertas.filter(a => a.severidade === vigia.SEV.URGENTE).length;

    if (!resultado.alertas.length) {
      return res.status(200).json({ ok: true, alertas: 0, acao: 'nada a avisar', falhas: resultado.falhas });
    }

    const diag = {};
    const hash = crypto.createHash('sha1').update(vigia.assinatura(resultado)).digest('hex').slice(0, 40);
    if (await jaAvisado(hash, diag)) {
      return res.status(200).json({ ok: true, alertas: resultado.alertas.length, acao: 'silenciado (nada mudou desde o último aviso)', diag });
    }

    const assunto = urgentes
      ? `NEXUS: ${urgentes} ponto(s) urgente(s)`
      : `NEXUS: ${resultado.alertas.length} ponto(s) de atenção`;

    /* Dois canais independentes. O WhatsApp chega no bolso; o e-mail é o
       registro. Um falhar não pode calar o outro. */
    const entrega = {};
    try {
      const wpp = require('./whatsapp');
      if (wpp.configurado()) {
        /* formato próprio do celular — o texto do e-mail vira parede lá */
        const cabecalho = urgentes
          ? `*NEXUS · ${urgentes} ${urgentes === 1 ? 'urgência' : 'urgências'}*`
          : `*NEXUS · ${resultado.alertas.length} ${resultado.alertas.length === 1 ? 'ponto de atenção' : 'pontos de atenção'}*`;
        await wpp.enviar(`${cabecalho}\n\n${vigia.resumirWhatsapp(resultado)}`);
        entrega.whatsapp = { enviado: true };
      } else {
        entrega.whatsapp = { pulado: 'WhatsApp não configurado' };
      }
    } catch (e) { entrega.whatsapp = { erro: e.message }; }

    try { entrega.email = await enviarEmail(assunto, resumo); }
    catch (e) { entrega.email = { erro: e.message }; }

    /* só marca como avisado se ALGUM canal entregou — senão o silêncio da
       próxima rodada esconderia um alerta que ninguém recebeu */
    const chegou = (entrega.whatsapp && entrega.whatsapp.enviado) || (entrega.email && entrega.email.enviado);
    if (chegou) await registrar(hash, resumo, resultado.alertas.length, diag);

    res.status(200).json({
      ok: true,
      alertas: resultado.alertas.length,
      urgentes,
      entrega,
      falhas: resultado.falhas,
      diag,
      resumo
    });
  } catch (e) {
    console.error('[nexus] rotina falhou:', e);
    res.status(500).json({ error: String(e.message || e) });
  }
};
