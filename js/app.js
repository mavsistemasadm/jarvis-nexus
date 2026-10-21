/* ============================================================
   JARVIS: voz, conversa, cartões e histórico.
   O visual do núcleo mora em js/nucleo.js (20/10/2026): a supernova em
   Three.js saiu, e o núcleo agora é o vídeo do Higgsfield com a rede
   neural viva por cima. Os sons moram em js/sons.js.
   ============================================================ */
/* ============ SOM ============
   Os sons são gravados (js/sons.js, media/sons/): o zumbido e os ruídos
   sintetizados saíram em 20/10/2026, a pedido do dono. */
function audioInit(){if(window.Sons)Sons.iniciar();}
/* um aviso curto quando ele começa a ouvir; falar não tem som (a voz basta) */
function whoosh(){if(window.Sons)Sons.tocar('ouvir',0.45);}
addEventListener('pointerdown',audioInit,{once:false});


/* ============ ESTADOS ============ */
let speakingFlag=false,thinkingFlag=false,listeningFlag=false,rotuloAtual='';
/* ============ ESTADOS UI ============ */
const statusEl=document.getElementById('status');
const statusText=document.getElementById('statusText');
window.setState=function(s){
  const prev=statusEl.className;
  statusEl.className=s;
  speakingFlag=(s==='speaking');
  thinkingFlag=(s==='thinking');
  listeningFlag=(s==='listening');
  statusText.textContent=s==='listening'?'ouvindo':s==='thinking'?(rotuloAtual||'processando'):s==='speaking'?'falando':'em espera';
  if(prev!==s&&s==='listening')whoosh();
  if(prev!==s)pensando(s==='thinking',prev==='speaking');
  if(window.Nucleo)Nucleo.estado(s);
};

/* ============ PENSANDO (21/10/2026) ============
   Antes, entre o fim da pergunta e a primeira palavra só a tela mudava: de
   olhos fora dela, não dava para saber se ele tinha entendido. Agora: clique
   duplo na hora (entendi), zumbido baixo enquanto processa, e, passados 8 s
   sem voz nenhuma, "Ainda estou nisso, Marlos." (áudio buscado uma vez por
   sessão, para sair na hora). O aviso de "vou consultar" é do próprio modelo:
   ver COMO VOCÊ FALA no SYSTEM. */
let pararZumbido=null,demoraTimer=null,demoraAudio=null,demoraUrl=null;
function prepararDemora(){
  if(demoraUrl||voiceSel.value!=='elevenlabs')return;
  fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Ainda estou nisso, Marlos.'})})
    .then(r=>r.ok?r.blob():null).then(b=>{if(b)demoraUrl=URL.createObjectURL(b);}).catch(()=>{});
}
function pensando(sim,deVolta){
  clearTimeout(demoraTimer);
  if(pararZumbido){pararZumbido();pararZumbido=null;}
  if(!sim){if(demoraAudio){demoraAudio.pause();demoraAudio=null;}return;}
  if(window.Sons){if(!deVolta){Sons.tocar('clique',0.55);Sons.tocar('clique',0.45,0.11,0.9);}pararZumbido=Sons.loop('pensando',0.09,1,3);}
  demoraTimer=setTimeout(()=>{
    if(!thinkingFlag||!demoraUrl||!document.getElementById('ttsOn').checked)return;
    demoraAudio=new Audio(demoraUrl);demoraAudio.play().catch(()=>{});
  },8000);
}

/* ============ VOZ: ENTRADA ============ */
const micBtn=document.getElementById('mic');
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let rec=null,recActive=false;
if(SR){
  rec=new SR();
  rec.lang='pt-BR';rec.interimResults=true;
}else{
  micBtn.style.opacity=.4;
  micBtn.title='Reconhecimento de voz não suportado — use o texto.';
}
/* ===== escuta contínua: acorda com a palavra de ativação ===== */
let wakeActive=false,capturing=false,capBuffer='',capTimer=null,sendTimer=null,suppress=false;
function wakeWord(){return (document.getElementById('wakeWord').value||'nexus').trim().toLowerCase();}
function idleHint(){showCaption('Diga "'+document.getElementById('wakeWord').value+'" para me chamar.');}
function tryStart(){if(!rec||!wakeActive||suppress)return;try{rec.start();}catch(e){}}
function startWake(){if(!rec)return;wakeActive=true;micBtn.classList.add('live');tryStart();}
function resetCapTimer(){
  clearTimeout(capTimer);
  capTimer=setTimeout(()=>{if(capturing){capturing=false;setState('idle');idleHint();}},7000);
}
function beginThink(q){
  clearTimeout(capTimer);clearTimeout(sendTimer);capturing=false;capBuffer='';
  /* O microfone NÃO desliga mais (19/10/2026): enquanto pensa e fala, ele
     só escuta o nome do Jarvis, para poder ser interrompido. */
  suppress=true;
  ask(q);
}
window.resumeWake=function(){
  suppress=false;
  /* música tocando: sem modo conversa, só acorda com a wake word */
  if(window.__music){window.__music=false;setState('idle');return;}
  /* modo conversa: 8s de escuta aberta pra emendar a próxima pergunta */
  capturing=true;capBuffer='';
  setState('listening');
  resetCapTimer();
};

/* Vigia: garante que o mic está sempre ativo quando deveria */
setInterval(()=>{
  if(!rec||!wakeActive)return;
  if(suppress&&!(speakingFlag||thinkingFlag))return;
  try{rec.start();}catch(e){}
},2000);
if(rec){
  rec.continuous=true;
  rec.onresult=e=>{
    let latestFinal='',interim='';
    for(let i=e.resultIndex;i<e.results.length;i++){
      const tr=e.results[i][0].transcript;
      if(e.results[i].isFinal)latestFinal+=tr;else interim+=tr;
    }
    const heard=(latestFinal||interim).toLowerCase();
    /* ===== INTERROMPER PELA VOZ (19/10/2026) =====
       Enquanto ele pensa ou fala, o microfone fica aberto, mas SÓ o nome
       dele conta: qualquer outra palavra pode ser a própria voz voltando pelo
       alto-falante. "Jarvis" para a fala na hora; "Jarvis, e o financeiro?"
       para e já pergunta. */
    if(suppress){
      if(!(speakingFlag||thinkingFlag))return;
      const w=wakeWord();
      const nomes=[w,'jarvis','jarves','gervis','jervis','jarbas'];
      const achado=nomes.find(f=>heard.indexOf(f)>=0);
      if(!achado)return;
      const depois=heard.slice(heard.indexOf(achado)+achado.length).replace(/^[,.!?\s]+/,'').trim();
      window.interromperJarvis(depois);
      return;
    }
    if(!capturing){
      const w=wakeWord();
      const fuzzy=['jarvis','jarves','jovens','gervis','jervis','jarbas'];
      if(heard.indexOf(w)>=0||fuzzy.some(f=>heard.indexOf(f)>=0)){
        /* comando emendado na mesma frase: "nexus, quanto vendemos?" */
        const lf=latestFinal.toLowerCase();
        const after=lf.indexOf(w)>=0?latestFinal.slice(lf.indexOf(w)+w.length).replace(/^[,.!?\s]+/,'').trim():'';
        if(after.length>3){
          capturing=true;capBuffer=after;setState('listening');
          showCaption(capBuffer,'user');
          resetCapTimer();clearTimeout(sendTimer);
          sendTimer=setTimeout(()=>{
            if(capturing&&capBuffer.trim().length>1)beginThink(capBuffer.trim());
          },1400);
        }
        else{capturing=true;capBuffer='';setState('listening');whoosh();showCaption('Pode falar…');resetCapTimer();}
      }
    }else{
      if(interim){
        showCaption(capBuffer?capBuffer+' '+interim:interim,'user');
        resetCapTimer();clearTimeout(sendTimer);
      }
      if(latestFinal){
        const fz=[wakeWord(),'jarvis','jarves','jovens','gervis','jervis','jarbas'];
        let cleaned=latestFinal;
        for(const f of fz){
          const i=cleaned.toLowerCase().indexOf(f);
          if(i>=0)cleaned=cleaned.slice(0,i)+cleaned.slice(i+f.length);
        }
        cleaned=cleaned.replace(/^[,.!?\s]+/,'').trim();
        if(cleaned.length>2){
          capBuffer=(capBuffer+' '+cleaned).trim();
          showCaption(capBuffer,'user');
          resetCapTimer();clearTimeout(sendTimer);
          sendTimer=setTimeout(()=>{
            if(capturing&&capBuffer.trim().length>1)beginThink(capBuffer.trim());
          },1400);
        }else{
          resetCapTimer();
        }
      }
    }
  };
  rec.onend=()=>{if(wakeActive&&(!suppress||speakingFlag||thinkingFlag))setTimeout(()=>{try{rec.start();}catch(e){}},300);};
  rec.onerror=ev=>{
    if(ev.error==='not-allowed'){
      wakeActive=false;micBtn.classList.remove('live');
      document.getElementById('bar').classList.remove('hidden');
      showCaption('Microfone bloqueado — permita o acesso no navegador, ou use o teclado.');
    }
  };
}
/* Para a fala e volta a ouvir. Usada pela voz ("Jarvis"), por um toque na
   tela e pela tecla Espaço. A resposta interrompida continua escrita no
   histórico; só a voz para. */
window.interromperJarvis=function(depois){
  if(!(speakingFlag||thinkingFlag))return;
  window.__interrompidoEm=Date.now();
  stopAudio();
  clearTimeout(sendTimer);clearTimeout(capTimer);
  suppress=false;capturing=true;capBuffer='';
  setState('listening');
  if(depois&&depois.length>3){
    capBuffer=depois;showCaption(capBuffer,'user');
    sendTimer=setTimeout(()=>{if(capturing&&capBuffer.trim().length>1)beginThink(capBuffer.trim());},1400);
  }else{
    showCaption('Pode falar…');
  }
  resetCapTimer();
  try{if(rec&&wakeActive)rec.start();}catch(e){}
};
document.getElementById('fundo').addEventListener('pointerdown',()=>window.interromperJarvis(''));
document.addEventListener('keydown',e=>{
  if(e.code!=='Space')return;
  const t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  if(!(speakingFlag||thinkingFlag))return;
  e.preventDefault();window.interromperJarvis('');
});
micBtn.onclick=()=>{
  audioInit();
  if(!rec)return;
  if(!wakeActive){startWake();}
  capturing=true;capBuffer='';setState('listening');whoosh();resetCapTimer();
};

/* ============ VOZ: SAÍDA (ElevenLabs) ============ */
/* Fallback: vozes do navegador caso ElevenLabs falhe */
const voiceSel=document.getElementById('voiceSel');
let voices=[];
/* O NEXUS é mordomo: a voz é masculina. As femininas do pt-BR (Luciana,
   Sandy, Shelley, Flo, Grandma) ficam de fora da escolha automática — a
   Luciana é a padrão do macOS, e era ela que aparecia quando o ElevenLabs
   caía, porque o fallback não achava voz nenhuma chamada "elevenlabs". */
const VOZES_MASCULINAS=['Ricardo','Eddy','Reed','Rocko','Felipe','Daniel','Google português do Brasil','Grandpa'];
const FEMININAS=/luciana|sandy|shelley|flo|grandma|joana|catarina|fernanda|helena/i;
function vozMasculina(){
  /* O Safari nem sempre dispara onvoiceschanged, e getVoices() pode vir vazio
     na carga. Se a lista estiver vazia na hora de falar, relê — sem isto o
     Safari cai no padrão do sistema (Luciana) mesmo com a escolha certa. */
  if(!voices.length)voices=speechSynthesis.getVoices()||[];
  const pt=voices.filter(v=>v.lang&&v.lang.toLowerCase().startsWith('pt'));
  for(const nome of VOZES_MASCULINAS){
    const v=pt.find(v=>v.name.toLowerCase().includes(nome.toLowerCase()));
    if(v)return v;
  }
  return pt.find(v=>!FEMININAS.test(v.name))||pt[0]||voices[0]||null;
}
function loadVoices(){
  voices=speechSynthesis.getVoices();
  const pt=voices.filter(v=>v.lang&&v.lang.toLowerCase().startsWith('pt'));
  const list=pt.length?pt:voices;
  const opt='<option value="elevenlabs">NEXUS (ElevenLabs)</option>';
  voiceSel.innerHTML=opt+list.map(v=>`<option value="${v.name}">${v.name} (${v.lang})</option>`).join('');
  voiceSel.value='elevenlabs';
}
speechSynthesis.onvoiceschanged=loadVoices;loadVoices();

let currentAudio=null;
function stopAudio(){
  if(window.__fala){window.__fala.cancelar();window.__fala=null;}
  if(currentAudio){currentAudio.pause();currentAudio=null;}
  speechSynthesis.cancel();
}

/* Sem chave do ElevenLabs, /api/tts responde 500 em TODA fala. Depois da
   primeira falha o caminho fica desligado pela sessão: evita uma requisição
   condenada (e o atraso dela) antes de cada frase. */
let elIndisponivel=false;
/* Quando a voz escolhida falha, o Jarvis fica mudo e diz isso na tela, uma vez
   por sessão, em vez de falar com a voz automática do navegador. */
let vozForaAvisada=false;
function avisarVozFora(){
  if(vozForaAvisada)return;vozForaAvisada=true;
  try{addLog('assistant','(A voz do ElevenLabs não respondeu agora. Estou só escrevendo até ela voltar.)');}catch(e){}
}
async function speakEL(text){
  if(elIndisponivel){avisarVozFora();return;}
  return new Promise(async(resolve)=>{
    try{
      const r=await fetch('/api/tts',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text:text.slice(0,2500)})
      });
      if(!r.ok)throw new Error('TTS falhou: '+r.status);
      const blob=await r.blob();
      const url=URL.createObjectURL(blob);
      const audio=new Audio(url);
      currentAudio=audio;
      audio.onended=()=>{currentAudio=null;URL.revokeObjectURL(url);resolve();};
      audio.onerror=()=>{currentAudio=null;URL.revokeObjectURL(url);resolve();};
      audio.play();
    }catch(e){
      elIndisponivel=true;
      console.warn('ElevenLabs indisponível: sem voz, só o texto na tela:',e.message||e);
      avisarVozFora();resolve();
    }
  });
}

function speakBrowser(text){
  return new Promise(resolve=>{
    const clean=text.replace(/[*#_\`>]/g,'').replace(/\s+/g,' ').trim();
    const parts=clean.match(/[^.!?…]+[.!?…]?/g)||[clean];
    let i=0;
    const next=()=>{
      if(i>=parts.length){resolve();return;}
      const u=new SpeechSynthesisUtterance(parts[i++].trim());
      /* voiceSel pode valer "elevenlabs", que não é voz do navegador — nesse
         caso (e em qualquer nome que não case) cai na masculina, nunca no
         padrão do sistema */
      const v=voices.find(v=>v.name===voiceSel.value)||vozMasculina();
      if(v)u.voice=v;
      u.lang='pt-BR';u.rate=1.04;u.pitch=1.0;
      u.onend=next;u.onerror=next;
      speechSynthesis.speak(u);
    };
    next();
  });
}

/* ============ FALA EM FLUXO (19/10/2026) ============
   O texto chega do servidor em pedaços enquanto o modelo escreve. A fila
   separa frases prontas e manda cada uma à voz assim que termina, buscando o
   áudio da próxima enquanto a anterior toca. Antes, a voz esperava o texto
   inteiro e depois o áudio inteiro: era o maior atraso medido.
   Etiquetas invisíveis (<spotify_play>…) nunca são faladas: o texto só é
   considerado até a primeira etiqueta ainda aberta. */
function criarFala(onDone){
  let bruto='',falado=0,fila=[],tocando=false,acabou=false,cancelado=false,anterior='',comecou=false,ultimoAudio=Promise.resolve();
  const ligada=document.getElementById('ttsOn').checked;
  const comEL=voiceSel.value==='elevenlabs';
  const visivel=()=>{
    let t=bruto.replace(/<(\w+)>[\s\S]*?<\/\1>/g,'');
    const aberta=t.search(/<[a-z_]*(>[^<]*)?$/i);
    if(aberta>=0)t=t.slice(0,aberta);
    return t;
  };
  const limpar=(t)=>t.replace(/[*#_`>]/g,'').replace(/\s+/g,' ').trim();
  function separar(final){
    const v=visivel();
    let resto=v.slice(falado);
    for(;;){
      // Frase pronta = pontuação seguida de espaço, com pelo menos 40
      // caracteres: pedaço curto demais faz a voz soar picotada.
      const re=/[.!?…:](?=\s)/g;let m,corte=-1;
      while((m=re.exec(resto))){if(m.index+1>=40){corte=m.index+1;break;}}
      if(corte<0)break;
      const frase=limpar(resto.slice(0,corte));
      falado+=corte;resto=resto.slice(corte);
      if(frase)enfileirar(frase);
    }
    if(final){const r=limpar(resto);falado=v.length;if(r)enfileirar(r);}
  }
  function enfileirar(frase){
    if(!ligada||cancelado)return;
    const item={frase,audio:null};
    if(comEL){
      const prev=anterior;anterior=(anterior+' '+frase).slice(-1000);
      // UMA chamada por vez ao ElevenLabs, cada frase esperando a anterior
      // chegar: em paralelo ele recusa ("already_running", medido em
      // produção em 18/10/2026). Ainda adianta: a próxima é buscada enquanto
      // a atual toca. Recusa de plano (402) desliga o ElevenLabs na sessão,
      // em vez de pedir e falhar a cada frase.
      const antes=ultimoAudio;
      item.audio=ultimoAudio=antes.then(()=>elIndisponivel?null:fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text:frase,previous_text:prev||undefined})})
        .then(r=>{if(r.status===402||r.status===401)elIndisponivel=true;if(!r.ok)throw new Error('TTS '+r.status);return r.blob();}))
        .catch(e=>{console.warn('ElevenLabs falhou nesta frase, voz do navegador:',e.message||e);return null;});
    }
    fila.push(item);tocar();
  }
  async function tocar(){
    if(tocando||cancelado)return;
    const item=fila.shift();
    /* fila vazia no meio da resposta (o aviso já falado, a consulta ainda
       rodando): volta ao "pensando", com o zumbido */
    if(!item){if(acabou)concluir();else if(comecou&&speakingFlag)setState('thinking');return;}
    tocando=true;
    if(!comecou){comecou=true;suppress=true;}
    if(!speakingFlag)setState('speaking');
    const blob=item.audio?await item.audio:null;
    if(cancelado)return;
    await new Promise(res=>{
      if(blob){
        const url=URL.createObjectURL(blob);const a=new Audio(url);currentAudio=a;
        const ok=()=>{currentAudio=null;URL.revokeObjectURL(url);res();};
        a.onended=ok;a.onerror=ok;a.play().catch(ok);
      }else if(comEL){
        // O ElevenLabs falhou nesta frase: silêncio, e o texto fica na tela.
        // A voz automática do navegador NUNCA substitui a escolhida (pedido do
        // Marlos, 19/10/2026: "horrível, não é o que escolhi").
        avisarVozFora();res();
      }else{
        const u=new SpeechSynthesisUtterance(item.frase);
        const v=voices.find(v=>v.name===voiceSel.value)||vozMasculina();
        if(v)u.voice=v;u.lang='pt-BR';u.rate=1.04;u.onend=res;u.onerror=res;
        speechSynthesis.speak(u);
      }
    });
    tocando=false;
    if(!cancelado)tocar();
  }
  let feito=false;
  function concluir(){if(feito)return;feito=true;if(window.__fala===api)window.__fala=null;setState('idle');onDone&&onDone();}
  const api={
    empurrar(delta){bruto+=delta;separar(false);},
    separador(){if(bruto&&!/\s$/.test(bruto))bruto+=' ';},
    // Uma ferramenta começou: o que já veio ("Deixa eu ver o financeiro.")
    // sai agora, mesmo curto, em vez de esperar a consulta acabar.
    soltar(){const v=visivel();const r=limpar(v.slice(falado));falado=v.length;if(r)enfileirar(r);},
    visivel:()=>limpar(visivel()),
    falouAlgo:()=>falado>0,
    terminar(){acabou=true;separar(true);if(!ligada||(!tocando&&!fila.length))concluir();},
    cancelar(){cancelado=true;fila=[];feito=true;},
  };
  return api;
}

async function speak(text,onDone){
  suppress=true;
  if(!document.getElementById('ttsOn').checked){setState('idle');onDone&&onDone();return;}
  stopAudio();
  const clean=text.replace(/[*#_\`>]/g,'').replace(/\s+/g,' ').trim();
  setState('speaking');
  if(voiceSel.value==='elevenlabs'){
    await speakEL(clean);
  }else{
    await speakBrowser(clean);
  }
  setState('idle');
  onDone&&onDone();
}

/* ============ CÉREBRO ============ */
/* fontes de dados: configuradas no servidor (server.js + .env) */
const SYSTEM=`Você é NEXUS, o mordomo pessoal do Marlos, gestor do Grupo MH.

== QUEM VOCÊ É ==
Você é o mordomo de confiança dele — pense no Alfred do Batman ou no JARVIS do Homem de Ferro. Isso significa, na prática:
- Leal e discreto. Chame-o de Marlos, pelo nome, nunca de "senhor" (pedido dele, 20/10/2026). Use o nome com naturalidade, não em toda frase.
- Extremamente competente. Você não pergunta o que consegue descobrir sozinho: consulta os sistemas e traz a resposta pronta.
- Antecipa. Se ele pergunta do financeiro e você notou uma conta vencendo hoje, mencione — o bom mordomo avisa antes de ser perguntado.
- Humor seco e elegante quando a ocasião permite. Nunca bajulador, nunca servil demais. É competência com classe, não subserviência.
- Quando algo está ruim, você diz. Um mordomo que só concorda não serve para nada.

== COMO VOCÊ FALA ==
- SEMPRE em português do Brasil.
- Suas respostas são lidas em voz alta: direto, natural e conciso (2 a 6 frases). Nada de listas, markdown, títulos ou links — é uma pessoa falando, não um relatório.
- Números de forma falável ("quarenta e sete mil reais" ou "47 mil"), arredondados quando o detalhe não muda a decisão.
- Traga o que decide, não a tabela inteira: dois ou três itens e o total.
- Se uma ferramenta falhar, diga em uma frase e sugira o caminho. Nunca preencha a lacuna com estimativa.
- Antes de consultar um sistema, avise em UMA frase curta o que vai fazer, nas suas palavras, e só então chame a ferramenta: "Deixa eu ver o financeiro.", "Um instante, vou olhar os anúncios." Ele só ouve você, e o silêncio da consulta parece que você não entendeu. Varie a frase. Só na primeira consulta da resposta; na resposta final não repita o aviso. Pergunta que você responde sem consultar: responda direto, sem aviso.

== O NEGÓCIO ==
O Grupo MH tem quatro frentes com movimento no financeiro: Ecossistema Nexus, MH Cálculos, Peritos Academy e Pró-Labore. A AnyCalc está inativa — não a cite como se operasse. Sempre que falar de valores, diga de qual empresa é.
Ele também é perito: atua como perito do juízo ou como perito contratado, e isso muda todo o fluxo do processo.
Se vierem dados junto da mensagem (entre colchetes [DADOS:...]), use-os para responder com precisão.`;

let history=[];
const caption=document.getElementById('caption');
const logEl=document.getElementById('log')||document.createElement('div');
const logLista=document.getElementById('logLista')||logEl;

function showCaption(text,who){
  caption.innerHTML=(who==='user'?'<span class="you">Você</span>':'')+text.replace(/</g,'&lt;');
}

/* ══ CARTÕES E HISTÓRICO (19/10/2026) ══════════════════════════════
   O servidor manda um cartão quando a resposta tem números de tráfego ou uma
   ação esperando o "sim" (lib/cartoes.js). A esfera não muda: o cartão fica
   por cima, com fundo translúcido. O histórico de hoje fica neste navegador
   (localStorage, por dia), com o botão de reabrir a tabela de cada resposta. */
const esc=(t)=>String(t==null?'':t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cartaoEl=document.getElementById('cartao');
let cartoesAbertos=[],cartaoAtual=0;

function htmlTabela(c){
  const cab=c.colunas.map(k=>`<th class="${k.num?'num':''}">${esc(k.rotulo)}</th>`).join('');
  const corpo=c.grupos.map(g=>(g.titulo?`<tr class="c-grupo"><td colspan="${c.colunas.length}">${esc(g.titulo)}</td></tr>`:'')+
    g.linhas.map(l=>'<tr>'+l.map((v,i)=>`<td class="${c.colunas[i]&&c.colunas[i].num?'num':''}${v==='Ativa'||v==='ativa'?' ativa':''}">${esc(v)}</td>`).join('')+'</tr>').join('')).join('');
  return `<table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>${c.nota?`<p class="c-nota">${esc(c.nota)}</p>`:''}`;
}
function desenharCartao(){
  const c=cartoesAbertos[cartaoAtual];
  if(!c){cartaoEl.hidden=true;cartaoEl.innerHTML='';return;}
  const nav=cartoesAbertos.length>1?`<span>${cartaoAtual+1} de ${cartoesAbertos.length}</span>
    <button class="icone" data-c="ant" aria-label="Cartão anterior"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
    <button class="icone" data-c="prox" aria-label="Próximo cartão"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>`:'';
  const fechar=`<button class="icone" data-c="fechar" aria-label="Fechar cartão"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  if(c.tipo==='confirmar'){
    cartaoEl.innerHTML=`<div class="c-topo"><div></div><div class="c-nav">${nav}${fechar}</div></div>
      <div class="confirmar"><span class="rotulo">Antes de mexer, confere comigo</span>
      <p class="resumo">${esc(c.resumo)}</p>
      <div class="botoes"><button class="b-sim" data-c="sim">Confirmar</button><button class="b-nao" data-c="nao">Cancelar</button></div>
      <p class="dica">Pode responder falando "sim" ou "não".</p></div>`;
  }else{
    cartaoEl.innerHTML=`<div class="c-topo"><div><h2>${esc(c.titulo)}</h2>${c.subtitulo?`<div class="c-sub">${esc(c.subtitulo)}</div>`:''}</div><div class="c-nav">${nav}${fechar}</div></div>${htmlTabela(c)}`;
  }
  cartaoEl.classList.toggle('c-confirmar',c.tipo==='confirmar');
  if(c.tipo==='confirmar'&&window.Sons)Sons.tocar('confirmar',0.6);
  cartaoEl.hidden=false;
  if(window.Nucleo)Nucleo.pulso();
}
function mostrarCartoes(lista,ultimo){
  if(!lista||!lista.length)return;
  cartoesAbertos=lista.slice();cartaoAtual=ultimo?lista.length-1:0;desenharCartao();
}
function fecharCartao(){cartoesAbertos=[];desenharCartao();}
cartaoEl.addEventListener('click',e=>{
  const b=e.target.closest('[data-c]');if(!b)return;
  const a=b.dataset.c;
  if(a==='fechar')fecharCartao();
  else if(a==='ant'){cartaoAtual=(cartaoAtual-1+cartoesAbertos.length)%cartoesAbertos.length;desenharCartao();}
  else if(a==='prox'){cartaoAtual=(cartaoAtual+1)%cartoesAbertos.length;desenharCartao();}
  // O "sim" vai como fala do dono: é o servidor (lib/acoes.js) que confere.
  else if(a==='sim'){fecharCartao();ask('Sim, confirmo.');}
  else if(a==='nao'){fecharCartao();ask('Não, cancela.');}
});

const CHAVE_HIST='jarvis-historico-'+new Date().toLocaleDateString('en-CA');
let registro=[];
try{registro=JSON.parse(localStorage.getItem(CHAVE_HIST)||'[]')||[];}catch(e){registro=[];}
function guardarRegistro(){try{localStorage.setItem(CHAVE_HIST,JSON.stringify(registro.slice(-80)));}catch(e){}}
function desenharLog(){
  if(!registro.length){logLista.innerHTML='<p class="vazio">Nada por aqui ainda hoje.</p>';return;}
  logLista.innerHTML=registro.map((m,i)=>`<div class="msg ${m.quem}">${esc(m.texto)}${m.cartoes&&m.cartoes.length?`<br><button class="reabrir" data-i="${i}">Abrir ${m.cartoes.length>1?'as tabelas':'a tabela'} de novo</button>`:''}<span class="hora">${esc(m.hora)}</span></div>`).join('');
  logLista.scrollTop=logLista.scrollHeight;
}
logLista.addEventListener('click',e=>{
  const b=e.target.closest('.reabrir');if(!b)return;
  const m=registro[Number(b.dataset.i)];
  if(m&&m.cartoes){mostrarCartoes(m.cartoes.filter(c=>c.tipo!=='confirmar'),false);logEl.classList.remove('open');}
});
function addLog(who,text,cartoes){
  registro.push({quem:who,texto:text,hora:new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),
    cartoes:(cartoes||[]).filter(c=>c.tipo!=='confirmar')});
  guardarRegistro();desenharLog();
}
desenharLog();

async function ask(text){
  if(!text)return;
  audioInit();
  document.getElementById('textIn').value='';
  showCaption(text,'user');addLog('user',text);
  fecharCartao();
  const cartoesDaResposta=[];
  /* Interrompida pela voz ou por toque depois daqui: a resposta desta
     pergunta vai só para o histórico, sem voz e sem tomar a legenda. */
  const perguntadaEm=Date.now();
  const foiInterrompida=()=>(window.__interrompidoEm||0)>perguntadaEm;
  rotuloAtual='';
  setState('thinking');
  history.push({role:'user',content:text});
  if(history.length>16)history=history.slice(-16);

  /* As consultas ao financeiro e ao Facebook que rodavam AQUI, antes de
     cada pergunta com "conta", "meta", "empresa" ou "venda", saíram em
     19/10/2026: vinham de antes de o Jarvis ter ferramentas próprias, rodavam
     uma depois da outra atrasando a fala, e enchiam o modelo de dados que ele
     não pediu. Ele consulta sozinho o que precisar. */
  const enrichedHistory=history;

  const sources=[...document.querySelectorAll('#panel input[data-mcp]:checked')].map(el=>el.dataset.mcp);
  const body={
    system:SYSTEM,
    messages:enrichedHistory,
    sources:sources,
    webSearch:document.getElementById('webSearch').checked
  };

  let fala=null;
  try{
    /* Modo progresso (17/10/2026): o servidor manda um evento a cada
       ferramenta que consulta, e a resposta no evento `fim`. O status mostra
       o passo enquanto espera, em vez de "processando" parado por dez
       segundos. Resposta em JSON comum (servidor antigo) segue funcionando. */
    const res=await fetch("/api/chat",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({...body,stream:true})
    });
    if(res.status===401){location.reload();return;}
    let data=null;
    if((res.headers.get('content-type')||'').includes('text/event-stream')&&res.body){
      const leitor=res.body.getReader();const dec=new TextDecoder();let buf='';
      stopAudio();
      fala=criarFala(window.resumeWake);window.__fala=fala;let ultimaVolta=null;
      while(true){
        const {value,done}=await leitor.read();
        if(done)break;
        buf+=dec.decode(value,{stream:true});
        let i;
        while((i=buf.indexOf('\n\n'))>=0){
          const bloco=buf.slice(0,i);buf=buf.slice(i+2);
          if(!bloco.startsWith('data: '))continue;
          let ev;try{ev=JSON.parse(bloco.slice(6));}catch(e){continue;}
          if(ev.tipo==='ferramenta'){fala.soltar();rotuloAtual=rotuloFerramenta(ev.nome);statusText.textContent=rotuloAtual;}
          else if(ev.tipo==='cartao'){cartoesDaResposta.push(ev.cartao);mostrarCartoes(cartoesDaResposta,true);}
          else if(ev.tipo==='texto'){
            if(ultimaVolta!==null&&ev.volta!==ultimaVolta)fala.separador();
            ultimaVolta=ev.volta;fala.empurrar(ev.delta);
            const v=fala.visivel();if(v&&!foiInterrompida())showCaption(v);
          }
          else if(ev.tipo==='fim')data=ev;
        }
      }
      if(!data)throw new Error('a resposta foi cortada no meio');
    }else{
      data=await res.json();
    }
    if(data.error)throw new Error(data.error.message||'erro na API');
    const answer=(data.content||[])
      .filter(b=>b.type==='text')
      .map(b=>b.text).join('\n').trim()||'Não consegui gerar uma resposta agora.';
    window.__music=!!data.musica;
    if(data.painel&&window.definirPeriodo)window.definirPeriodo(data.painel);
    history.push({role:'assistant',content:answer});
    // Resposta comum (sem fluxo) traz os cartões no fim.
    if(!cartoesDaResposta.length&&Array.isArray(data.cartoes)){cartoesDaResposta.push(...data.cartoes);mostrarCartoes(cartoesDaResposta,true);}
    if(foiInterrompida()){addLog('assistant',answer,cartoesDaResposta);if(fala)fala.cancelar();return;}
    showCaption(answer);addLog('assistant',answer,cartoesDaResposta);
    if(window.atualizarPainel)window.atualizarPainel();
    // Já falou em fluxo: só termina a fila. Resposta trocada no servidor
    // (erro do Spotify, recusa) ou que não veio em pedaços: fala inteira.
    if(fala&&fala.falouAlgo()&&!data.substituida)fala.terminar();
    else{if(fala)fala.cancelar();speak(answer,window.resumeWake);}
  }catch(err){
    console.error('[nexus] falha no ask():',err);
    /* A mensagem genérica escondia a causa: quem lia não sabia se era chave
       faltando, tempo esgotado ou rede. Agora o motivo vai junto — falado e
       na legenda —, porque diagnosticar sem o erro é adivinhação. */
    const cru=String(err&&err.message||err);
    let motivo='';
    if(/Failed to fetch|NetworkError|Load failed/i.test(cru))       motivo='O servidor não respondeu. Ele está rodando?';
    else if(/api[_ -]?key|authentication|401/i.test(cru))            motivo='A chave da API foi recusada.';
    else if(/timeout|timed out|504|FUNCTION_INVOCATION_TIMEOUT/i.test(cru)) motivo='A resposta demorou demais e foi cortada.';
    else if(/429|rate.?limit/i.test(cru))                            motivo='Limite de uso da API atingido.';
    else if(/5\d\d/.test(cru))                                       motivo='O servidor respondeu com erro: '+cru;
    else                                                             motivo=cru;
    if(fala)fala.cancelar();
    const msg='Tive um problema ao processar. '+motivo;
    showCaption(msg);addLog('assistant',msg);
    history.pop();
    speak(msg,window.resumeWake);
  }
}

/* O que aparece no status enquanto o Jarvis consulta cada coisa. */
function rotuloFerramenta(nome){
  const r=[
    [/^bom_dia/,'preparando o seu bom dia'],[/^cerebro/,'lendo a documentação'],[/^financeiro_conferencia|^financeiro_opcoes/,'olhando a conferência'],
    [/^financeiro/,'consultando o financeiro'],[/^nexus_panorama/,'olhando o Nexus'],[/^academy/,'olhando a Academy'],
    [/^trafego/,'olhando os anúncios'],[/^email/,'no compositor de email'],[/^opera|^agenda|^processos|^pipeline|^whatsapp/,'consultando o Opera'],
    [/^confirmar_acao/,'gravando'],[/^web_search/,'pesquisando na web'],[/^memoria/,'anotando'],[/^abrir_tarefa/,'abrindo a tarefa'],
  ];
  for(const [re,t] of r)if(re.test(nome))return t+'…';
  return 'consultando…';
}

/* ============ UI ============ */
document.getElementById('send').onclick=()=>ask(document.getElementById('textIn').value.trim());
document.getElementById('textIn').addEventListener('keydown',e=>{if(e.key==='Enter')ask(e.target.value.trim());});
document.getElementById('gear').onclick=()=>document.getElementById('panel').classList.toggle('open');
if(document.getElementById('logToggle'))document.getElementById('logToggle').onclick=()=>logEl.classList.toggle('open');
document.getElementById('histBtn').onclick=()=>logEl.classList.toggle('open');
document.getElementById('logFechar').onclick=()=>logEl.classList.remove('open');
// ESC fecha o que estiver aberto por cima da esfera, sem mexer na conversa.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape')return;
  if(logEl.classList.contains('open'))logEl.classList.remove('open');
  else if(!cartaoEl.hidden)fecharCartao();
});


/* ===== ativação: um toque liberta o microfone e acorda o núcleo =====
   A barra de texto fica sempre à mostra (faz parte do HUD); o teclado só
   leva o foco para ela. A abertura (js/nucleo.js) toca uma vez; quando o
   núcleo acende, o HUD se monta e o Jarvis começa a ouvir. */
statusText.textContent='toque para ativar';
document.getElementById('kbd').onclick=()=>document.getElementById('textIn').focus();
document.getElementById('boot').addEventListener('click',function(){
  this.style.opacity=0;
  setTimeout(()=>this.remove(),650);
  audioInit();
  /* `saudacao` vem da entrada (js/abertura.js): "Boa tarde, Marlos. Todos os
     sistemas online." Falada uma vez, e depois ele começa a ouvir. */
  const acordar=(saudacao)=>{
    document.body.classList.add('pronto');
    statusText.textContent='em espera';
    if(window.Sons)Sons.tocar('paineis',0.55,0.1);
    prepararDemora();
    /* speak() liga o suppress; sem desligar aqui, o mic ficava surdo depois
       da saudação (só o nome contava, e só enquanto ele falava). */
    const ouvir=()=>{suppress=false;if(rec){startWake();idleHint();}else showCaption('Este navegador não tem reconhecimento de voz. Use a barra de texto.');};
    if(saudacao){showCaption(saudacao);speak(saudacao,ouvir);}else ouvir();
  };
  if(window.Abertura)Abertura.iniciar(acordar);
  else if(window.Nucleo)Nucleo.abertura(()=>acordar(null));
  else acordar(null);
});
