/* ============================================================
   NEXUS SUPERNOVA
   estrela de plasma + labaredas + ejeção de matéria + disco
   orbital + ondas de choque + ignição + bloom + som sintetizado
   ============================================================ */
const canvas=document.getElementById('scene');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setClearColor(0x01040d,1);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(42,1,0.1,100);
camera.position.set(0,0,5.2);

/* ---------- ruído simplex 3D (Ashima) ---------- */
const NOISE=`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float v=0.0;float a=0.5;
  for(int i=0;i<4;i++){v+=a*snoise(p);p*=2.03;a*=0.5;}
  return v;
}`;

const starGroup=new THREE.Group();
scene.add(starGroup);

/* ============ NÚCLEO: superfície de plasma turbulento ============ */
const coreMat=new THREE.ShaderMaterial({
  vertexShader:NOISE+`
    uniform float uTime;uniform float uEnergy;
    varying vec3 vPos;varying vec3 vN;varying vec3 vV;
    void main(){
      vec3 p=position;
      float d=fbm(p*2.0+vec3(uTime*0.25))*0.05*(1.0+uEnergy*1.4)
             +snoise(p*1.1+vec3(uTime*0.13))*0.05;
      p+=normal*d;
      vPos=position;
      vec4 world=modelMatrix*vec4(p,1.0);
      vN=normalize(mat3(modelMatrix)*normal);
      vV=normalize(cameraPosition-world.xyz);
      gl_Position=projectionMatrix*viewMatrix*world;
    }`,
  fragmentShader:NOISE+`
    uniform float uTime;uniform float uEnergy;
    uniform vec3 uDeep;uniform vec3 uMid;uniform vec3 uHot;uniform vec3 uWhite;
    varying vec3 vPos;varying vec3 vN;varying vec3 vV;
    void main(){
      vec3 p=normalize(vPos)*2.4;
      vec3 q=vec3(fbm(p+vec3(0.0,uTime*0.30,0.0)),fbm(p+vec3(5.2,1.3,uTime*0.22)),fbm(p+vec3(2.1,uTime*0.18,7.7)));
      float m=fbm(p*1.8+q*2.2+vec3(uTime*0.12));
      float cells=abs(snoise(p*4.5+q*1.5-vec3(uTime*0.35)));
      float fil =pow(1.0-abs(snoise(p*7.5 +q*2.5-vec3(uTime*0.5))),6.0);
      float fil2=pow(1.0-abs(snoise(p*13.0+q*1.5+vec3(uTime*0.7))),8.0);
      vec3 col=mix(uDeep,uMid,smoothstep(-0.4,0.25,m));
      col=mix(col,uHot,smoothstep(0.15,0.55,m));
      col=mix(col,uWhite,smoothstep(0.55,0.9,m+cells*0.3)*(0.35+uEnergy*0.9));
      col+=uHot*fil*(0.5+uEnergy*0.6);
      col+=uWhite*fil2*(0.28+uEnergy*0.55);
      col*=0.85+cells*0.5;
      float fres=pow(1.0-abs(dot(normalize(vN),normalize(vV))),2.0);
      col+=fres*uHot*(0.8+uEnergy*0.8);
      gl_FragColor=vec4(col*(1.10+uEnergy*0.9),1.0);
    }`,
  uniforms:{uTime:{value:0},uEnergy:{value:0},
    uDeep:{value:new THREE.Color(0.01,0.05,0.28)},
    uMid:{value:new THREE.Color(0.08,0.35,1.0)},
    uHot:{value:new THREE.Color(0.55,0.85,1.0)},
    uWhite:{value:new THREE.Color(1.0,1.0,1.0)}}
});
const core=new THREE.Mesh(new THREE.SphereGeometry(0.95,128,128),coreMat);
starGroup.add(core);

/* ============ LABAREDAS: proeminências se desprendendo ============ */
const flareMat=new THREE.ShaderMaterial({
  vertexShader:NOISE+`
    uniform float uTime;uniform float uFlare;
    varying float vSpike;varying vec3 vPos;
    void main(){
      vec3 p=position;
      float n=snoise(p*2.1+vec3(uTime*0.45));
      float n2=snoise(p*4.3-vec3(uTime*0.7,uTime*0.3,0.0));
      float spike=pow(max(n*0.7+n2*0.3,0.0),2.6);
      p+=normal*spike*uFlare;
      vSpike=spike;vPos=position;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
    }`,
  fragmentShader:NOISE+`
    uniform float uTime;uniform float uEnergy;
    uniform vec3 uColA;uniform vec3 uColB;
    varying float vSpike;varying vec3 vPos;
    void main(){
      float flick=0.55+0.45*snoise(vPos*3.5+vec3(uTime*2.2));
      float a=vSpike*flick*(0.5+uEnergy*0.8);
      vec3 col=mix(uColA,uColB,vSpike);
      gl_FragColor=vec4(col,a);
    }`,
  uniforms:{uTime:{value:0},uFlare:{value:0.3},uEnergy:{value:0},
    uColA:{value:new THREE.Color(0.2,0.5,1.0)},uColB:{value:new THREE.Color(0.9,0.97,1.0)}},
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide
});
const flares=new THREE.Mesh(new THREE.SphereGeometry(0.98,110,110),flareMat);
starGroup.add(flares);
/* segunda casca de labaredas, contra-rotação, mais longa */
const flareMat2=flareMat.clone();
flareMat2.uniforms={uTime:{value:0},uFlare:{value:0.45},uEnergy:{value:0},
  uColA:{value:new THREE.Color(0.2,0.5,1.0)},uColB:{value:new THREE.Color(0.9,0.97,1.0)}};
const flares2=new THREE.Mesh(new THREE.SphereGeometry(0.99,110,110),flareMat2);
flares2.rotation.set(1.2,2.1,0.4);
starGroup.add(flares2);

/* ============ LOOPS MAGNÉTICOS: proeminências em arco ============ */
/* plasma fluindo ao longo de arcos ancorados em dois pés na superfície,
   agrupados em 4 regiões ativas que entram em erupção */
const NPROM=3600,NREG=4;
const pP1=new Float32Array(NPROM*3),pP2=new Float32Array(NPROM*3),
      pH=new Float32Array(NPROM),pSp=new Float32Array(NPROM),
      pSeed=new Float32Array(NPROM),pSz=new Float32Array(NPROM),pReg=new Float32Array(NPROM);
(function(){
  const up=new THREE.Vector3(0,1,0);
  let k=0;
  for(let r=0;r<NREG;r++){
    /* centro da região ativa na esfera */
    const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1);
    const C=new THREE.Vector3(Math.sin(ph)*Math.cos(th),Math.sin(ph)*Math.sin(th),Math.cos(ph));
    /* eixo tangente da arcada */
    let T=new THREE.Vector3().crossVectors(C,Math.abs(C.y)<0.9?up:new THREE.Vector3(1,0,0)).normalize();
    T.applyAxisAngle(C,Math.random()*Math.PI*2);
    const axis=new THREE.Vector3().crossVectors(C,T).normalize();
    const loops=3+Math.floor(Math.random()*3);
    const per=Math.floor(NPROM/NREG/loops);
    for(let l=0;l<loops;l++){
      const half=0.14+Math.random()*0.22;           /* meia-abertura do arco */
      const baseH=0.22+Math.random()*0.45;          /* altura do loop */
      const off=(Math.random()-0.5)*0.25;           /* desloca o loop dentro da arcada */
      const Cl=C.clone().applyAxisAngle(T,off).normalize();
      for(let i=0;i<per&&k<NPROM;i++,k++){
        const jit=0.965+Math.random()*0.07;
        const a1=Cl.clone().applyAxisAngle(axis,-half*jit).normalize();
        const a2=Cl.clone().applyAxisAngle(axis, half*jit).normalize();
        pP1[k*3]=a1.x;pP1[k*3+1]=a1.y;pP1[k*3+2]=a1.z;
        pP2[k*3]=a2.x;pP2[k*3+1]=a2.y;pP2[k*3+2]=a2.z;
        pH[k]=baseH*(0.65+Math.random()*0.7);
        pSp[k]=0.5+Math.random()*1.3;
        pSeed[k]=Math.random();
        pSz[k]=0.5+Math.pow(Math.random(),2.2)*2.4;
        pReg[k]=r;
      }
    }
  }
})();
const promGeo=new THREE.BufferGeometry();
promGeo.setAttribute('position',new THREE.BufferAttribute(pP1,3)); /* usa aP1 como position base */
promGeo.setAttribute('aP2',new THREE.BufferAttribute(pP2,3));
promGeo.setAttribute('aH',new THREE.BufferAttribute(pH,1));
promGeo.setAttribute('aSp',new THREE.BufferAttribute(pSp,1));
promGeo.setAttribute('aSeed',new THREE.BufferAttribute(pSeed,1));
promGeo.setAttribute('aSz',new THREE.BufferAttribute(pSz,1));
promGeo.setAttribute('aReg',new THREE.BufferAttribute(pReg,1));
const promMat=new THREE.ShaderMaterial({
  vertexShader:`
    attribute vec3 aP2;attribute float aH;attribute float aSp;
    attribute float aSeed;attribute float aSz;attribute float aReg;
    uniform float uTime;uniform float uEnergy;uniform vec4 uBoost;uniform float uPx;
    varying float vHot;varying float vA;
    void main(){
      float boost=aReg<0.5?uBoost.x:aReg<1.5?uBoost.y:aReg<2.5?uBoost.z:uBoost.w;
      float u=fract(aSeed+uTime*aSp*(0.045+boost*0.13+uEnergy*0.05));
      vec3 dir=normalize(mix(position,aP2,u));
      float lift=sin(u*3.14159);
      float h=aH*(1.0+boost*1.7+uEnergy*0.5);
      vec3 p=dir*(0.96+lift*h);
      vec4 mv=modelViewMatrix*vec4(p,1.0);
      gl_PointSize=aSz*uPx*(1.0+boost*0.8+uEnergy*0.4)/max(0.001,-mv.z);
      vHot=lift*0.55+boost*0.45;
      vA=(0.22+boost*0.85+uEnergy*0.45)*(0.5+0.5*lift);
      gl_Position=projectionMatrix*mv;
    }`,
  fragmentShader:`
    uniform vec3 uColA;uniform vec3 uColB;
    varying float vHot;varying float vA;
    void main(){
      float d=length(gl_PointCoord-vec2(0.5));
      float a=smoothstep(0.5,0.05,d)*vA;
      vec3 col=mix(uColA,uColB,clamp(vHot,0.0,1.0));
      gl_FragColor=vec4(col,a);
    }`,
  uniforms:{uTime:{value:0},uEnergy:{value:0},uBoost:{value:new THREE.Vector4(0,0,0,0)},uPx:{value:8.5},
    uColA:{value:new THREE.Color(0.25,0.55,1.0)},uColB:{value:new THREE.Color(0.95,1.0,1.0)}},
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending
});
const prominences=new THREE.Points(promGeo,promMat);
starGroup.add(prominences);

/* ============ COROA: atmosfera fresnel ============ */
const coronaMat=new THREE.ShaderMaterial({
  vertexShader:NOISE+`
    uniform float uTime;uniform float uAmp;
    varying vec3 vN;varying vec3 vV;varying float vD;
    void main(){
      vec3 p=position;
      float d=snoise(p*1.4+vec3(uTime*0.20))*uAmp
             +snoise(p*3.1-vec3(uTime*0.34))*uAmp*0.45
             +snoise(p*6.2+vec3(0.0,uTime*1.4,0.0))*uAmp*0.18;
      p+=normal*d;vD=d;
      vec4 world=modelMatrix*vec4(p,1.0);
      vN=normalize(mat3(modelMatrix)*normal);
      vV=normalize(cameraPosition-world.xyz);
      gl_Position=projectionMatrix*viewMatrix*world;
    }`,
  fragmentShader:`
    uniform float uEnergy;uniform vec3 uColA;uniform vec3 uColB;
    varying vec3 vN;varying vec3 vV;varying float vD;
    void main(){
      float fres=pow(1.0-abs(dot(normalize(vN),normalize(vV))),3.2);
      vec3 col=mix(uColA,uColB,clamp(fres+vD*1.6,0.0,1.0));
      gl_FragColor=vec4(col,fres*(0.72+uEnergy*0.5));
    }`,
  uniforms:{uTime:{value:0},uAmp:{value:0.07},uEnergy:{value:0},
    uColA:{value:new THREE.Color(0.15,0.4,1.0)},uColB:{value:new THREE.Color(0.8,0.95,1.0)}},
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.BackSide
});
const corona=new THREE.Mesh(new THREE.SphereGeometry(1.42,110,110),coronaMat);
starGroup.add(corona);

/* ============ EJEÇÃO DE MATÉRIA (GPU) ============ */
const NEJ=3200;
const ejPos=new Float32Array(NEJ*3),ejR=new Float32Array(NEJ),ejSp=new Float32Array(NEJ),
      ejSeed=new Float32Array(NEJ),ejSz=new Float32Array(NEJ);
for(let i=0;i<NEJ;i++){
  const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1);
  ejPos[i*3]=Math.sin(ph)*Math.cos(th);
  ejPos[i*3+1]=Math.sin(ph)*Math.sin(th);
  ejPos[i*3+2]=Math.cos(ph);
  ejR[i]=1.0+Math.random()*0.12;
  ejSp[i]=0.4+Math.random()*1.4;
  ejSeed[i]=Math.random();
  ejSz[i]=0.5+Math.pow(Math.random(),2.4)*2.8;
}
const ejGeo=new THREE.BufferGeometry();
ejGeo.setAttribute('position',new THREE.BufferAttribute(ejPos,3));
ejGeo.setAttribute('aR',new THREE.BufferAttribute(ejR,1));
ejGeo.setAttribute('aSp',new THREE.BufferAttribute(ejSp,1));
ejGeo.setAttribute('aSeed',new THREE.BufferAttribute(ejSeed,1));
ejGeo.setAttribute('aSz',new THREE.BufferAttribute(ejSz,1));
const ejMat=new THREE.ShaderMaterial({
  vertexShader:`
    attribute float aR;attribute float aSp;attribute float aSeed;attribute float aSz;
    uniform float uTime;uniform float uEnergy;uniform float uPx;
    varying float vA;varying float vSeed;
    void main(){
      vec3 dir=normalize(position);
      float stream=fract(aSeed+uTime*aSp*(0.02+uEnergy*0.09));
      float r=aR+stream*(0.12+uEnergy*1.6);
      vec3 p=dir*r;
      vec4 mv=modelViewMatrix*vec4(p,1.0);
      gl_PointSize=aSz*uPx*(1.0+uEnergy*0.5)/max(0.001,-mv.z);
      vA=(1.0-stream)*(0.30+uEnergy*0.8);
      vSeed=aSeed;
      gl_Position=projectionMatrix*mv;
    }`,
  fragmentShader:`
    uniform vec3 uColA;uniform vec3 uColB;
    varying float vA;varying float vSeed;
    void main(){
      float d=length(gl_PointCoord-vec2(0.5));
      float a=smoothstep(0.5,0.05,d)*vA;
      vec3 col=mix(uColA,uColB,step(0.88,vSeed));
      gl_FragColor=vec4(col,a);
    }`,
  uniforms:{uTime:{value:0},uEnergy:{value:0},uPx:{value:8.5},uColA:{value:new THREE.Color(0.45,0.75,1.0)},uColB:{value:new THREE.Color(1,1,1)}},
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending
});
const ejecta=new THREE.Points(ejGeo,ejMat);
starGroup.add(ejecta);

/* ============ DISCO ORBITAL DE POEIRA ============ */
const orbitGroup=new THREE.Group();
orbitGroup.rotation.x=0.42;
scene.add(orbitGroup);
const NB=2200,OR=1.85;
const bAng=new Float32Array(NB),bRad=new Float32Array(NB),bZ=new Float32Array(NB),
      bSp=new Float32Array(NB),bSz=new Float32Array(NB),bSeed=new Float32Array(NB);
for(let i=0;i<NB;i++){
  bAng[i]=Math.random()*Math.PI*2;
  bRad[i]=((Math.random()+Math.random()+Math.random())/3-0.5)*0.5;
  bZ[i]=((Math.random()+Math.random())/2-0.5)*0.12;
  bSp[i]=0.3+Math.random()*1.2;
  bSz[i]=0.4+Math.pow(Math.random(),2.6)*2.4;
  bSeed[i]=Math.random();
}
const bandGeo=new THREE.BufferGeometry();
bandGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(NB*3),3));
bandGeo.setAttribute('aAng',new THREE.BufferAttribute(bAng,1));
bandGeo.setAttribute('aRad',new THREE.BufferAttribute(bRad,1));
bandGeo.setAttribute('aZ',new THREE.BufferAttribute(bZ,1));
bandGeo.setAttribute('aSp',new THREE.BufferAttribute(bSp,1));
bandGeo.setAttribute('aSz',new THREE.BufferAttribute(bSz,1));
bandGeo.setAttribute('aSeed',new THREE.BufferAttribute(bSeed,1));
const bandMat=new THREE.ShaderMaterial({
  vertexShader:NOISE+`
    attribute float aAng;attribute float aRad;attribute float aZ;
    attribute float aSp;attribute float aSz;attribute float aSeed;
    uniform float uTime;uniform float uR;uniform float uEnergy;uniform float uPx;
    varying float vSeed;varying float vFade;
    void main(){
      float ang=aAng+uTime*aSp*(0.10+uEnergy*0.30);
      vec3 np=vec3(cos(ang),sin(ang),0.0);
      float n=snoise(vec3(np.x*2.0,np.y*2.0,uTime*0.25+aSeed*4.0));
      float r=uR+aRad*(1.0+uEnergy*0.4)+n*0.09;
      vec3 p=vec3(cos(ang)*r,sin(ang)*r,aZ+n*0.06);
      vec4 mv=modelViewMatrix*vec4(p,1.0);
      gl_PointSize=aSz*uPx*(1.0+uEnergy*0.5)/max(0.001,-mv.z);
      vSeed=aSeed;
      vFade=0.4+0.6*snoise(vec3(aSeed*9.0,uTime*0.7,ang));
      gl_Position=projectionMatrix*mv;
    }`,
  fragmentShader:`
    uniform float uOpacity;uniform vec3 uColA;uniform vec3 uColB;
    varying float vSeed;varying float vFade;
    void main(){
      float d=length(gl_PointCoord-vec2(0.5));
      float a=smoothstep(0.5,0.05,d)*uOpacity*vFade;
      vec3 col=mix(uColA,uColB,vSeed);
      col=mix(col,vec3(1.0),step(0.93,vSeed));
      gl_FragColor=vec4(col,a);
    }`,
  uniforms:{uTime:{value:0},uR:{value:OR},uEnergy:{value:0},uPx:{value:8.0},uOpacity:{value:0.8},uColA:{value:new THREE.Color(0.4,0.65,1.0)},uColB:{value:new THREE.Color(0.75,0.92,1.0)}},
  transparent:true,depthWrite:false,blending:THREE.AdditiveBlending
});
const band=new THREE.Points(bandGeo,bandMat);
orbitGroup.add(band);

/* ============ ONDAS DE CHOQUE ============ */
const shockPool=[];
for(let i=0;i<4;i++){
  const m=new THREE.Mesh(new THREE.RingGeometry(0.96,1.0,96),
    new THREE.MeshBasicMaterial({color:0xbfe4ff,transparent:true,opacity:0,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));
  m.visible=false;
  scene.add(m);
  shockPool.push({mesh:m,life:0});
}
function fireShock(strength){
  const s=shockPool.find(s=>s.life<=0);
  if(!s)return;
  s.life=1;
  s.mesh.visible=true;
  s.mesh.scale.setScalar(1.05);
  s.mesh.material.opacity=0.5*strength;
  s.mesh.rotation.set(camera.rotation.x,camera.rotation.y,0);
}

/* ============ HALO CENTRAL ============ */
function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=256;
  const x=c.getContext('2d');
  const g=x.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0,'rgba(255,255,255,0.95)');
  g.addColorStop(0.2,'rgba(255,255,255,0.5)');
  g.addColorStop(0.55,'rgba(255,255,255,0.14)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}
const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture(),color:0x8fc4ff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:0.9}));
glow.scale.set(2.6,2.6,1);
scene.add(glow);

/* ============ POEIRA ESTELAR DE FUNDO ============ */
(function(){
  const n=500,pos=new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const r=3.2+Math.random()*8;
    const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1);
    pos[i*3]=r*Math.sin(ph)*Math.cos(th);
    pos[i*3+1]=r*Math.sin(ph)*Math.sin(th);
    pos[i*3+2]=r*Math.cos(ph);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const dust=new THREE.Points(g,new THREE.PointsMaterial({color:0x1c3f80,size:0.02,transparent:true,opacity:0.85}));
  dust.name='dust';
  scene.add(dust);
})();

/* ============ PÓS-PROCESSAMENTO (bloom + flash + grão + vinheta) ============ */
let rtScene,rtA,rtB;
function makeRT(w,h){return new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});}
function buildTargets(){
  const pr=Math.min(devicePixelRatio,1.75);
  const w=Math.floor(innerWidth*pr),h=Math.floor(innerHeight*pr);
  if(rtScene){rtScene.dispose();rtA.dispose();rtB.dispose();}
  rtScene=makeRT(w,h);rtA=makeRT(w>>1,h>>1);rtB=makeRT(w>>1,h>>1);
}
const QUAD_V=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
function makePass(frag,uniforms){
  const s=new THREE.Scene();
  const c=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const m=new THREE.ShaderMaterial({vertexShader:QUAD_V,fragmentShader:frag,uniforms,depthTest:false,depthWrite:false});
  s.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),m));
  return {scene:s,cam:c,u:uniforms};
}
const brightPass=makePass(`
  uniform sampler2D tex;varying vec2 vUv;
  void main(){
    vec3 c=texture2D(tex,vUv).rgb;
    float l=dot(c,vec3(0.299,0.587,0.114));
    gl_FragColor=vec4(c*smoothstep(0.30,0.72,l),1.0);
  }`,{tex:{value:null}});
const blurPass=makePass(`
  uniform sampler2D tex;uniform vec2 uDir;varying vec2 vUv;
  void main(){
    float w0=0.227,w1=0.194,w2=0.121,w3=0.054,w4=0.016;
    vec3 s=texture2D(tex,vUv).rgb*w0;
    s+=texture2D(tex,vUv+uDir).rgb*w1;s+=texture2D(tex,vUv-uDir).rgb*w1;
    s+=texture2D(tex,vUv+uDir*2.0).rgb*w2;s+=texture2D(tex,vUv-uDir*2.0).rgb*w2;
    s+=texture2D(tex,vUv+uDir*3.0).rgb*w3;s+=texture2D(tex,vUv-uDir*3.0).rgb*w3;
    s+=texture2D(tex,vUv+uDir*4.0).rgb*w4;s+=texture2D(tex,vUv-uDir*4.0).rgb*w4;
    gl_FragColor=vec4(s,1.0);
  }`,{tex:{value:null},uDir:{value:new THREE.Vector2()}});
const compositePass=makePass(`
  uniform sampler2D tScene;uniform sampler2D tBloom;
  uniform float uBloom;uniform float uTime;uniform float uFlash;uniform vec3 uFlashCol;
  varying vec2 vUv;
  float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}
  void main(){
    vec3 c=texture2D(tScene,vUv).rgb+texture2D(tBloom,vUv).rgb*uBloom;
    c+=uFlashCol*uFlash*max(0.0,1.0-dot(vUv-0.5,vUv-0.5)*4.0);
    vec2 d=vUv-0.5;
    c*=1.0-dot(d,d)*0.85;
    c+=(rand(vUv*fract(uTime)+vUv)-0.5)*0.028;
    c=c/(c+vec3(0.55));
    c=pow(c,vec3(0.9));
    gl_FragColor=vec4(c,1.0);
  }`,{tScene:{value:null},tBloom:{value:null},uBloom:{value:1.4},uTime:{value:0},uFlash:{value:0},uFlashCol:{value:new THREE.Color(0.55,0.75,1.0)}});

function resize(){
  const w=innerWidth,h=innerHeight;
  renderer.setSize(w,h,false);
  camera.aspect=w/h;camera.updateProjectionMatrix();
  camera.position.z=w<600?6.6:5.2;
  buildTargets();
}
addEventListener('resize',resize);resize();

/* ============ SOM SINTETIZADO ============ */
let AC=null,humGain=null;
function sfxOn(){return document.getElementById('sfxOn').checked;}
function audioInit(){
  if(AC||!sfxOn())return;
  try{
    AC=new (window.AudioContext||window.webkitAudioContext)();
    const o1=AC.createOscillator(),o2=AC.createOscillator();
    o1.type='sawtooth';o2.type='sawtooth';
    o1.frequency.value=46;o2.frequency.value=46.7;
    const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=130;
    humGain=AC.createGain();humGain.gain.value=0;
    o1.connect(f);o2.connect(f);f.connect(humGain);humGain.connect(AC.destination);
    o1.start();o2.start();
    boom(0.8);
  }catch(e){AC=null;}
}
function noiseBurst(dur,f0,f1,vol){
  if(!AC||!sfxOn())return;
  const b=AC.createBuffer(1,Math.floor(AC.sampleRate*dur),AC.sampleRate);
  const d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
  const s=AC.createBufferSource();s.buffer=b;
  const fl=AC.createBiquadFilter();fl.type='bandpass';fl.Q.value=0.8;
  fl.frequency.setValueAtTime(f0,AC.currentTime);
  fl.frequency.exponentialRampToValueAtTime(Math.max(40,f1),AC.currentTime+dur);
  const g=AC.createGain();g.gain.value=vol;
  s.connect(fl);fl.connect(g);g.connect(AC.destination);s.start();
}
function boom(vol){
  noiseBurst(1.1,320,50,0.5*vol);
  if(!AC)return;
  const o=AC.createOscillator();o.type='sine';
  o.frequency.setValueAtTime(130,AC.currentTime);
  o.frequency.exponentialRampToValueAtTime(32,AC.currentTime+0.9);
  const g=AC.createGain();
  g.gain.setValueAtTime(0.5*vol,AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,AC.currentTime+1.0);
  o.connect(g);g.connect(AC.destination);o.start();o.stop(AC.currentTime+1.05);
}
function whoosh(){noiseBurst(0.45,900,180,0.22);}
function crackle(){noiseBurst(0.05,2600+Math.random()*1500,800,0.10);}
addEventListener('pointerdown',audioInit,{once:false});

/* ============ ESTADOS + LOOP ============ */
const t0=performance.now();let t=0,speech=0,fire=0,thinkPulse=0,flash=0,camPunch=0,shockCd=0,lastPeak=0;
let lastNow=performance.now(),nextEru=4+Math.random()*4,heatSm=0,palMode='none';
const boosts=[0,0,0,0];
let speakingFlag=false,thinkingFlag=false,listeningFlag=false;
let igniteFlash1=false,igniteFlash2=false;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

function easeOutBack(x){const c=1.70158;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2);}

function animate(){
  requestAnimationFrame(animate);
  t+=0.016;
  const now=performance.now();
  const dt=Math.min(0.06,(now-lastNow)/1000);lastNow=now;
  const realT=(now-t0)/1000;

  /* --- erupções solares: uma região ativa explode de tempos em tempos --- */
  for(let i=0;i<4;i++)boosts[i]*=Math.exp(-dt*0.9);
  if(realT>nextEru){
    const r=Math.floor(Math.random()*4);
    boosts[r]=1;
    if(speakingFlag&&Math.random()<0.6)boosts[(r+1+Math.floor(Math.random()*3))%4]=0.75;
    nextEru=realT+(speakingFlag?1.2+Math.random()*1.8:listeningFlag?2.8+Math.random()*3.5:5+Math.random()*8);
    flash=Math.max(flash,speakingFlag?0.16:0.12);
    noiseBurst(0.9,200,45,speakingFlag?0.28:0.22);
  }

  /* --- ignição de abertura --- */
  const ig=window.actT0?Math.min(1,Math.max(0,((performance.now()-window.actT0)/1000-0.1)/1.5)):0;
  const igScale=ig<0.001?0.001:easeOutBack(ig);
  if(ig>0.25&&!igniteFlash1){igniteFlash1=true;flash=1.1;fireShock(1);}
  if(ig>0.55&&!igniteFlash2){igniteFlash2=true;flash=Math.max(flash,0.6);fireShock(0.8);
    if(statusText.textContent==='inicializando'||statusText.textContent==='toque para ativar')statusText.textContent='em espera';}

  /* --- envelope de fala --- */
  const talk=speakingFlag?Math.max(0.12,(Math.sin(t*4.6)*0.5+0.5)*(Math.sin(t*1.35)*0.35+0.65)):0;
  speech+=(talk-speech)*0.14;
  fire+=((listeningFlag?1:0)-fire)*0.09;
  thinkPulse+=((thinkingFlag?1:0)-thinkPulse)*0.08;
  const energy=speech+fire*0.55+thinkPulse*0.25;

  /* ondas de choque nos picos de sílaba */
  shockCd-=0.016;
  if(speakingFlag&&shockCd<=0&&speech>0.55&&speech>lastPeak){
    fireShock(0.7+speech*0.4);
    boosts[Math.floor(Math.random()*4)]=Math.max(boosts[Math.floor(Math.random()*4)]||0,0.9);
    flash=Math.max(flash,0.10);
    camPunch=Math.max(camPunch,0.5);
    shockCd=0.38;
  }
  lastPeak=speech;

  /* --- estrela --- */
  starGroup.scale.setScalar(igScale*1.14*(1+speech*0.05+Math.sin(t*0.9)*0.012));
  coreMat.uniforms.uTime.value=t;
  coreMat.uniforms.uEnergy.value=energy;
  flareMat.uniforms.uTime.value=t;
  flareMat.uniforms.uEnergy.value=energy;
  flareMat.uniforms.uFlare.value=0.28+fire*0.30+speech*0.50+thinkPulse*0.1;
  flareMat2.uniforms.uTime.value=t*1.25+40.0;
  flareMat2.uniforms.uEnergy.value=energy;
  flareMat2.uniforms.uFlare.value=0.42+fire*0.36+speech*0.68;
  coronaMat.uniforms.uEnergy.value=energy;
  coronaMat.uniforms.uTime.value=t;
  coronaMat.uniforms.uAmp.value=0.07+fire*0.06+speech*0.15+thinkPulse*0.03;
  ejMat.uniforms.uTime.value=t;
  ejMat.uniforms.uEnergy.value=fire*0.5+speech;
  promMat.uniforms.uTime.value=t;
  promMat.uniforms.uEnergy.value=energy;
  promMat.uniforms.uBoost.value.set(boosts[0],boosts[1],boosts[2],boosts[3]);
  if(!reduceMotion){
    core.rotation.y+=0.0016+fire*0.002+speech*0.004+thinkPulse*0.006;
    flares.rotation.y+=0.0022;flares.rotation.z+=0.0009;
    flares2.rotation.y-=0.0028;flares2.rotation.x+=0.0011;
    corona.rotation.y-=0.0009-speech*0.002;corona.rotation.z+=0.0005+fire*0.001;
    ejecta.rotation.y+=0.0013+speech*0.004;
    prominences.rotation.copy(core.rotation);
    starGroup.rotation.z=Math.sin(t*0.13)*0.06;
  }

  /* --- disco orbital: tomba continuamente, nunca para --- */
  bandMat.uniforms.uTime.value=t;
  bandMat.uniforms.uEnergy.value=energy;
  bandMat.uniforms.uOpacity.value=0.8*igScale;
  if(!reduceMotion){
    orbitGroup.rotation.z+=0.0014+speech*0.004+thinkPulse*0.012;
    orbitGroup.rotation.x=0.42+Math.sin(t*0.17)*0.15;
    orbitGroup.rotation.y=Math.sin(t*0.12)*0.2;
  }

  /* --- brilho, fagulha sonora, halo --- */
  glow.material.opacity=(0.72+energy*0.5)*igScale;
  glow.scale.setScalar(3.1*igScale*(1+energy*0.5));
  if(listeningFlag&&Math.random()<0.10)crackle();
  if(AC&&humGain)humGain.gain.value=sfxOn()?(0.028+energy*0.05)*igScale:0;

  /* --- ondas de choque vivas --- */
  shockPool.forEach(s=>{
    if(s.life>0){
      s.life-=0.022;
      s.mesh.scale.multiplyScalar(1.055);
      s.mesh.material.opacity*=0.87;
      if(s.life<=0){s.mesh.visible=false;s.mesh.material.opacity=0;}
    }
  });

  /* --- câmera: deriva + soco + tremor --- */
  camPunch*=0.90;
  flash*=0.84;
  const shake=speech>0.5?(speech-0.5)*0.5:0;
  camera.position.x=Math.sin(t*0.11)*0.10+(Math.random()-0.5)*0.02*shake;
  camera.position.y=Math.cos(t*0.085)*0.07+(Math.random()-0.5)*0.02*shake;
  const baseZ=innerWidth<600?6.6:5.2;
  camera.position.z=baseZ-camPunch*0.4-speech*0.15;
  camera.lookAt(0,0,0);

  /* --- pós-processamento --- */
  renderer.setRenderTarget(rtScene);
  renderer.clear();
  renderer.render(scene,camera);

  brightPass.u.tex.value=rtScene.texture;
  renderer.setRenderTarget(rtA);
  renderer.render(brightPass.scene,brightPass.cam);

  for(let i=0;i<3;i++){
    const spread=1.2+i*1.3;
    blurPass.u.tex.value=rtA.texture;
    blurPass.u.uDir.value.set(spread/rtA.width,0);
    renderer.setRenderTarget(rtB);
    renderer.render(blurPass.scene,blurPass.cam);
    blurPass.u.tex.value=rtB.texture;
    blurPass.u.uDir.value.set(0,spread/rtA.height);
    renderer.setRenderTarget(rtA);
    renderer.render(blurPass.scene,blurPass.cam);
  }

  if(palMode==='thermal'&&window.applyThermal){
    const heat=speakingFlag?1:(fire*0.35+thinkPulse*0.2);
    heatSm+=(heat-heatSm)*0.10;
    applyThermal(heatSm);
  }

  compositePass.u.tScene.value=rtScene.texture;
  compositePass.u.tBloom.value=rtA.texture;
  compositePass.u.uTime.value=t;
  compositePass.u.uFlash.value=flash;
  compositePass.u.uBloom.value=1.35+energy*0.4;
  renderer.setRenderTarget(null);
  renderer.render(compositePass.scene,compositePass.cam);
}
animate();

/* ============ ESTADOS UI ============ */
const statusEl=document.getElementById('status');
const statusText=document.getElementById('statusText');
window.setState=function(s){
  const prev=statusEl.className;
  statusEl.className=s;
  speakingFlag=(s==='speaking');
  thinkingFlag=(s==='thinking');
  listeningFlag=(s==='listening');
  statusText.textContent=s==='listening'?'ouvindo':s==='thinking'?'processando':s==='speaking'?'falando':'em espera';
  if(prev!==s&&(s==='listening'||s==='speaking'))whoosh();
  if(s==='speaking'){camPunch=1;fireShock(1);flash=Math.max(flash,0.25);}
};

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
let wakeActive=false,capturing=false,capBuffer='',capTimer=null,suppress=false;
function wakeWord(){return (document.getElementById('wakeWord').value||'jarvis').trim().toLowerCase();}
function idleHint(){showCaption('Diga "'+document.getElementById('wakeWord').value+'" para me chamar.');}
function tryStart(){if(!rec||!wakeActive||suppress)return;try{rec.start();}catch(e){}}
function startWake(){if(!rec)return;wakeActive=true;micBtn.classList.add('live');tryStart();}
function resetCapTimer(){
  clearTimeout(capTimer);
  capTimer=setTimeout(()=>{if(capturing){capturing=false;setState('idle');idleHint();}},7000);
}
function beginThink(q){
  clearTimeout(capTimer);capturing=false;capBuffer='';
  suppress=true;try{rec.stop();}catch(e){}
  ask(q);
}
window.resumeWake=function(){
  suppress=false;
  /* modo conversa: 8s de escuta aberta pra emendar a próxima pergunta */
  capturing=true;capBuffer='';
  setState('listening');
  resetCapTimer();
};

/* Vigia: garante que o mic está sempre ativo quando deveria */
setInterval(()=>{
  if(!rec||!wakeActive||suppress)return;
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

if(!capturing){
      const w=wakeWord();
      const fuzzy=['jarvis','jarves','jovens','gervis','jervis','jarbas'];
if(heard.indexOf(w)>=0||fuzzy.some(f=>heard.indexOf(f)>=0)){
        /* comando emendado na mesma frase: "nexus, quanto vendemos?" */
        const lf=latestFinal.toLowerCase();
        const after=lf.indexOf(w)>=0?latestFinal.slice(lf.indexOf(w)+w.length).replace(/^[,.!?\s]+/,'').trim():'';
        if(after.length>3){beginThink(after);}
        else{capturing=true;capBuffer='';setState('listening');whoosh();showCaption('Pode falar…');resetCapTimer();}
      }
}else{
      if(interim)showCaption(interim,'user');
      if(latestFinal){
        /* remove a palavra de ativação (e variações) se vier repetida */
        const fuzzy=[wakeWord(),'jarvis','jarves','jovens','gervis','jervis','jarbas'];
        let cleaned=latestFinal;
        for(const f of fuzzy){
          const i=cleaned.toLowerCase().indexOf(f);
          if(i>=0)cleaned=cleaned.slice(0,i)+cleaned.slice(i+f.length);
        }
        cleaned=cleaned.replace(/^[,.!?\s]+/,'').trim();
        if(cleaned.length>2){
          capBuffer=(capBuffer+' '+cleaned).trim();
          beginThink(capBuffer);
        }else{
          resetCapTimer(); /* só a wake word repetida: continua esperando a pergunta */
        }
      }
    }
  };
  rec.onend=()=>{
      if(wakeActive&&!suppress){setTimeout(tryStart,300);}
};
  rec.onerror=ev=>{
    if(ev.error==='not-allowed'){
      wakeActive=false;micBtn.classList.remove('live');
      document.getElementById('bar').classList.remove('hidden');
      showCaption('Microfone bloqueado — permita o acesso no navegador, ou use o teclado.');
    }
  };
}
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
  if(currentAudio){currentAudio.pause();currentAudio=null;}
  speechSynthesis.cancel();
}

async function speakEL(text){
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
      console.warn('ElevenLabs falhou, usando navegador:',e);
      speakBrowser(text).then(resolve);
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
      const v=voices.find(v=>v.name===voiceSel.value);if(v)u.voice=v;
      u.lang='pt-BR';u.rate=1.04;u.pitch=1.0;
      u.onend=next;u.onerror=next;
      speechSynthesis.speak(u);
    };
    next();
  });
}

async function speak(text,onDone){
  suppress=true;try{if(rec)rec.stop();}catch(e){}
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
const SYSTEM=`Você é Jarvis, o assistente pessoal de negócios do Marlos, dono do Grupo MH (MH Cálculos, Peritos Academy, AnyCalc). Regras:
- Responda SEMPRE em português do Brasil.
- Suas respostas serão lidas em voz alta: seja direto, natural e conciso (2 a 6 frases). Nada de listas, markdown ou links — fale como uma pessoa.
- Tenha personalidade: confiante, levemente espirituoso quando couber, sem ser forçado. Vá direto ao ponto como um braço direito competente.
- Diga números de forma falável (ex.: "quarenta e sete mil reais" ou "47 mil").
- Para perguntas gerais, notícias ou qualquer coisa da internet, use a busca na web.
- Se uma ferramenta falhar, diga isso em uma frase e sugira o caminho.

== DADOS FINANCEIROS ==
Quando os dados financeiros vierem junto na mensagem (entre colchetes [DADOS:...]), use-os para responder com precisão. As empresas do grupo são: MH Cálculos, Peritos Academy e AnyCalc. Sempre que falar de valores, diga de qual empresa é.`;

let history=[];
const caption=document.getElementById('caption');
const logEl=document.getElementById('log')||document.createElement('div');

function showCaption(text,who){
  caption.innerHTML=(who==='user'?'<span class="you">Você</span>':'')+text.replace(/</g,'&lt;');
}
function addLog(who,text){
  const d=document.createElement('div');
  d.className='msg '+who;
  d.innerHTML=`<span class="who">${who==='user'?'Você':'Jarvis'}</span>${text.replace(/</g,'&lt;')}`;
  logEl.appendChild(d);logEl.scrollTop=logEl.scrollHeight;
}

async function ask(text){
  if(!text)return;
  audioInit();
  document.getElementById('textIn').value='';
  showCaption(text,'user');addLog('user',text);
  setState('thinking');
  history.push({role:'user',content:text});
  if(history.length>16)history=history.slice(-16);

  /* ---- Dados financeiros: buscar antes de enviar pro Claude ---- */
  let finData='';
  const finWords=['fatur','receit','despes','saldo','conta','venc','atras','meta','vend','financ','gastou','gastamos','lucr','fluxo','pagamento','pagar','receber','empresa'];
  const isFinancial=finWords.some(w=>text.toLowerCase().includes(w));
  if(isFinancial){
    try{
      const actions=[];
      if(/atras/i.test(text))actions.push({action:'contas_em_atraso'});
      if(/venc/i.test(text))actions.push({action:'contas_a_vencer',dias:7});
      if(/meta/i.test(text))actions.push({action:'faturamento_vs_meta'});
      if(/despes|gast/i.test(text))actions.push({action:'top_despesas'});
      if(/fluxo/i.test(text))actions.push({action:'fluxo_diario'});
      if(actions.length===0)actions.push({action:'resumo_mensal'});
      for(const a of actions){
        const fr=await fetch('/api/financeiro',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(a)
        });
        const fd=await fr.json();
        if(fd.data)finData+='\n[DADOS: '+a.action+'] '+JSON.stringify(fd.data);
      }
    }catch(e){console.warn('financeiro indisponível:',e);}
  }

  const lastMsg=history[history.length-1];
  const enrichedHistory=finData
    ?[...history.slice(0,-1),{role:'user',content:lastMsg.content+finData}]
    :history;

  const sources=[...document.querySelectorAll('#panel input[data-mcp]:checked')].map(el=>el.dataset.mcp);
  const body={
    system:SYSTEM,
    messages:enrichedHistory,
    sources:sources,
    webSearch:document.getElementById('webSearch').checked
  };

  try{
    const res=await fetch("/api/chat",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const data=await res.json();
    if(data.error)throw new Error(data.error.message||'erro na API');
    const answer=(data.content||[])
      .filter(b=>b.type==='text')
      .map(b=>b.text).join('\n').trim()||'Não consegui gerar uma resposta agora.';
    history.push({role:'assistant',content:answer});
    showCaption(answer);addLog('assistant',answer);
    speak(answer,window.resumeWake);
  }catch(err){
    console.error(err);
    const msg='Tive um problema ao processar. Tente novamente ou desative algumas fontes de dados nas configurações.';
    showCaption(msg);addLog('assistant',msg);
    history.pop();
    speak(msg,window.resumeWake);
  }
}

/* ============ UI ============ */
document.getElementById('send').onclick=()=>ask(document.getElementById('textIn').value.trim());
document.getElementById('textIn').addEventListener('keydown',e=>{if(e.key==='Enter')ask(e.target.value.trim());});
document.getElementById('gear').onclick=()=>document.getElementById('panel').classList.toggle('open');

const PALETTES={
  blue:{deep:[0.01,0.05,0.28],mid:[0.08,0.35,1.0],hot:[0.55,0.85,1.0],white:[1,1,1],
    flaA:[0.2,0.5,1.0],flaB:[0.9,0.97,1.0],corA:[0.15,0.4,1.0],corB:[0.8,0.95,1.0],
    ejA:[0.45,0.75,1.0],ejB:[1,1,1],bdA:[0.4,0.65,1.0],bdB:[0.75,0.92,1.0],
    prA:[0.25,0.55,1.0],prB:[0.95,1.0,1.0],glow:0x8fc4ff,flash:[0.55,0.75,1.0],shock:0xbfe4ff},
  fire:{deep:[0.14,0.015,0.0],mid:[0.95,0.24,0.02],hot:[1.0,0.62,0.12],white:[1.0,0.90,0.58],
    flaA:[1.0,0.35,0.03],flaB:[1.0,0.85,0.5],corA:[1.0,0.3,0.05],corB:[1.0,0.8,0.45],
    ejA:[1.0,0.55,0.12],ejB:[1.0,0.95,0.8],bdA:[1.0,0.45,0.08],bdB:[1.0,0.8,0.5],
    prA:[1.0,0.4,0.05],prB:[1.0,0.95,0.75],glow:0xffa860,flash:[1.0,0.72,0.35],shock:0xffc070}
};
function applyPalette(name){
  const p=PALETTES[name]||PALETTES.blue;
  const set=(u,v)=>u.value.setRGB(v[0],v[1],v[2]);
  set(coreMat.uniforms.uDeep,p.deep);set(coreMat.uniforms.uMid,p.mid);
  set(coreMat.uniforms.uHot,p.hot);set(coreMat.uniforms.uWhite,p.white);
  set(flareMat.uniforms.uColA,p.flaA);set(flareMat.uniforms.uColB,p.flaB);
  set(flareMat2.uniforms.uColA,p.flaA);set(flareMat2.uniforms.uColB,p.flaB);
  set(coronaMat.uniforms.uColA,p.corA);set(coronaMat.uniforms.uColB,p.corB);
  set(ejMat.uniforms.uColA,p.ejA);set(ejMat.uniforms.uColB,p.ejB);
  set(bandMat.uniforms.uColA,p.bdA);set(bandMat.uniforms.uColB,p.bdB);
  set(promMat.uniforms.uColA,p.prA);set(promMat.uniforms.uColB,p.prB);
  glow.material.color.setHex(p.glow);
  compositePass.u.uFlashCol.value.setRGB(p.flash[0],p.flash[1],p.flash[2]);
  shockPool.forEach(sh=>sh.mesh.material.color.setHex(p.shock));
}
palMode='thermal';
const _lerpKeys=[
  [()=>coreMat.uniforms.uDeep,'deep'],[()=>coreMat.uniforms.uMid,'mid'],
  [()=>coreMat.uniforms.uHot,'hot'],[()=>coreMat.uniforms.uWhite,'white'],
  [()=>flareMat.uniforms.uColA,'flaA'],[()=>flareMat.uniforms.uColB,'flaB'],
  [()=>flareMat2.uniforms.uColA,'flaA'],[()=>flareMat2.uniforms.uColB,'flaB'],
  [()=>coronaMat.uniforms.uColA,'corA'],[()=>coronaMat.uniforms.uColB,'corB'],
  [()=>ejMat.uniforms.uColA,'ejA'],[()=>ejMat.uniforms.uColB,'ejB'],
  [()=>bandMat.uniforms.uColA,'bdA'],[()=>bandMat.uniforms.uColB,'bdB'],
  [()=>promMat.uniforms.uColA,'prA'],[()=>promMat.uniforms.uColB,'prB']
];
const _cA=new THREE.Color(),_cB=new THREE.Color();
window.applyThermal=function(k){
  const A=PALETTES.blue,B=PALETTES.fire;
  _lerpKeys.forEach(([g,key])=>{
    const a=A[key],b=B[key],u=g();
    u.value.setRGB(a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k);
  });
  _cA.setHex(A.glow);_cB.setHex(B.glow);glow.material.color.copy(_cA).lerp(_cB,k);
  compositePass.u.uFlashCol.value.setRGB(A.flash[0]+(B.flash[0]-A.flash[0])*k,A.flash[1]+(B.flash[1]-A.flash[1])*k,A.flash[2]+(B.flash[2]-A.flash[2])*k);
  _cA.setHex(A.shock);_cB.setHex(B.shock);
  shockPool.forEach(sh=>sh.mesh.material.color.copy(_cA).lerp(_cB,k));
};
document.getElementById('palSel').onchange=e=>{
  palMode=e.target.value;
  if(palMode!=='thermal')applyPalette(palMode);else applyThermal(heatSm);
};
applyThermal(0);

/* ===== ativação: um toque liberta o microfone e igniça a estrela ===== */
statusText.textContent='toque para ativar';
if(SR)document.getElementById('bar').classList.add('hidden');
document.getElementById('kbd').onclick=()=>document.getElementById('bar').classList.toggle('hidden');
document.getElementById('boot').addEventListener('click',function(){
  this.style.opacity=0;
  setTimeout(()=>this.remove(),650);
  window.actT0=performance.now();
  audioInit();
  if(rec){startWake();idleHint();}
  else showCaption('Este navegador não tem reconhecimento de voz — use o teclado (ícone no canto).');
});