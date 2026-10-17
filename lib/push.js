/* O aviso no celular do dono, pela central de notificações do Nexus
   (17/10/2026). O Jarvis é o quinto app da central (🟡 Jarvis). O dono é o
   primeiro id de JARVIS_DONOS, que é a conta dele no Nexus: é por ela que a
   central acha o celular. Nunca lança: push é um canal entre três. */
async function avisarNoCelular({ ref, titulo, corpo, para = '/' }) {
  const chave = process.env.NEXUS_NOTIFICAR_KEY;
  const dono = (process.env.JARVIS_DONOS || '').split(',')[0].trim();
  if (!chave || !dono) return { pulado: 'NEXUS_NOTIFICAR_KEY ou JARVIS_DONOS ausente' };
  try {
    const r = await fetch('https://www.nexuspericial.com.br/api/integracoes/notificar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-integracao-key': chave },
      body: JSON.stringify({ app: 'jarvis', ref, destinatario: { nexus_user_id: dono }, titulo, corpo, para }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { erro: d.erro || `central ${r.status}` };
    return { enviado: (d.entregues || 0) > 0, ...d };
  } catch (e) {
    return { erro: e.message };
  }
}

module.exports = { avisarNoCelular };
