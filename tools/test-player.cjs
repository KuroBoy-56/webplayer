// Pruebas de prioridad y ciclo de vida. No requieren red, Vega ni una cuenta IPTV.
const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const originalLoad = Module._load;
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true},fileName:filename,
}).outputText, filename);
let memory = {};
let firmware = '2.0.0';
let probe = null;
let shared = [];
const ready = new Set();
const mkvReady = new Set();
let dropped = [];
let calls = [];
let shakas = [];
let release = null;
let mp4s = [];
let mkvs = [];
let toasts = [];
let mkvTracks = [{lang:'spa',codec:'A_AAC'},{lang:'eng',codec:'A_AAC'}];
const noTracks = {ok:false,container:'',audio:[],subs:[]};
const store = {
  read:(key,def='')=>memory[key] ?? def,
  write:(key,value)=>{memory[key]=value;},
  pref:(key,def)=>memory['pref_'+key] ?? def,
  readJson:key=>memory[key] || null,
  writeJson:(key,value)=>{memory[key]=value;},
  setPref:(key,value)=>{memory['pref_'+key]=value;},
};
class Shaka {
  constructor(v){this.v=v;this.active='es';this.stopped=false;shakas.push(this);}
  async start(url,at){this.url=url;this.v.src=url;this.v.currentTime=at;this.onTracks();}
  audioTracks(){return [{id:'es',label:'Español',lang:'es',codec:'aac',active:this.active==='es'},{id:'en',label:'Inglés',lang:'en',codec:'aac',active:this.active==='en'}];}
  selectAudio(id){this.active=id;this.onTracks();return true;}
  textTracks(){return [];}
  selectText(){}
  async destroy(){this.stopped=true;if(release) await release;}
}
class Mp4 {
  static open(v,url,index,cache){return new Mp4(v,url,index,cache);}
  constructor(v,url,index=-1,cache=null){this.v=v;this.url=url;this.audioIdx=index<0?0:index;this.index=cache||new Uint8Array([1]);this.noAudio=false;this.tracks=[{lang:'spa',codec:'mp4a'},{lang:'eng',codec:'mp4a'}];mp4s.push(this);}
  cancelPlay(){}
  busy(){return false;}
  async start(at){this.at=at;if(this.url.includes('mkvbody'))return 'índice: el archivo es MKV';if(this.url.includes('noindex'))return 'índice: sin contestar en 30 s';this.v.currentTime=at;this.v.paused=false;this.onTracks();return '';}
  // 2.1.0: con el índice entero cambia de idioma con lo ya bajado (las pruebas «inplace»); si no, se abre de nuevo
  switchAudio(i){if(!this.url.includes('inplace'))return false;this.audioIdx=i;this.switched=(this.switched||0)+1;return true;}
  // subtítulos de texto dentro del MP4 (las pruebas «mp4subs»)
  subList(){return this.url.includes('mp4subs')?[{id:'0',lang:'spa',codec:'tx3g',name:'',def:false,forced:false}]:[];}
  diag(){return '[lector de prueba]';}
  subCues(n){return this.url.includes('mp4subs')&&n===0?(this.cues||(this.cues=[{s:0,e:5,text:'hola'}])):null;}
  destroy(){}
}
class Mkv {
  constructor(v,url,index=-1,cache=null){this.v=v;this.url=url;this.audioIdx=index<0?0:index;this.index=cache||{cached:true};this.noAudio=mkvTracks.every(t=>t.codec==='A_EAC3');this.tracks=mkvTracks;mkvs.push(this);}
  probe(){return {ok:true,headOk:true,container:'mkv',audio:this.tracks.map((t,i)=>({id:String(i),lang:t.lang,codec:t.codec,name:'',def:i===0,forced:false})),subs:[{id:'0',lang:'spa',codec:'S_TEXT/UTF8',name:'',def:false,forced:false},{id:'1',lang:'eng',codec:'S_HDMV/PGS',name:'',def:false,forced:false}]};}
  subCues(n){return n===0?(this.cuesList||(this.cuesList=[{s:0,e:5,text:'hola'}])):null;}
  cancelPlay(){}
  busy(){return false;}
  async start(at){
    this.at=at;
    if(this.tracks[this.audioIdx]?.codec==='A_TRUEHD') this.audioIdx=0;
    this.v.currentTime=at;
    this.v.paused=false;
    this.onTracks();
    return '';
  }
  timeOf(t){return t;}
  diag(){return '[lector mkv de prueba]';}
  destroy(){}
}
let panelError = '';
let engineAvailable = false;
let denied = '';
class PanelHls {
  static supported(){return true;}
  async start(){denied=panelError;return panelError;}
  destroy(){}
}
let lives = [];
class LiveHls {static supported(){return true;}constructor(v,url,audio,noAudio,tsOnly){this.tsOnly=tsOnly;this.frozen=false;this.noShow=false;this.mf=false;lives.push(this);}isMp4(){return !this.tsOnly;}mediaFailed(){return this.mf;}otherAudio(){return false;}async start(){return '';}audioLangs(){return [];}diag(){return '';}destroy(){}}
const media = {
  engineDenied:()=>denied,hlsLink:()=> 'https://fixture.invalid/remote.m3u8',knownNow:()=>probe,knownTracks:async()=>probe||noTracks,shareTracks:(u,p)=>shared.push([u,p]),
  fileTracks:async()=>probe||noTracks,
  mediaEngine:async()=>{calls.push('mediaEngine');return engineAvailable ? {ok:true,engine:{base:'https://fixture.invalid/',token:'fixture'}} : {ok:false,error:'Motor de prueba no disponible'};},
};
Module._load = function(request,parent,isMain){
  if(request==='@amazon-devices/react-native-w3cmedia') return {MediaSource:{isTypeSupported:()=>true}};
  if(request==='react-native') return {Platform:{get constants(){return {uiMode:'tv',keplerOSVersion:firmware};}}};
  if(request==='../api/media') return media;
  if(request==='../lib/storage') return store;
  if(request==='../lib/i18n'||request==='./i18n') return {t:(key,vars)=>key.replace(/\{(\w+)\}/g,(m,k)=>vars?.[k]??m)};
  if(request==='../api/report') return {reportError:()=>{}};
  if(request==='./shaka') return {ShakaPlayback:Shaka};
  if(request==='./mp4mse') return {Mp4Mse:Mp4,NOT_MP4_MKV:'el archivo es MKV',STALE_INDEX:'índice guardado viejo',mp4Ready:u=>ready.has(u),dropWarm:u=>dropped.push(u)};
  if(request==='./mkvmse') return {MkvMse:Mkv,mkvKnown:()=>false,mkvReady:u=>mkvReady.has(u),dropMkvWarm:()=>{}};
  if(request==='./hls') return {PanelHls};
  if(request==='./livehls') return {LiveHls,disableMp4:()=>{}};
  return originalLoad.call(this,request,parent,isMain);
};
const {Playback} = require('../src/player/playback.ts');
const {APP_VERSION} = require('../src/version.ts');
// equipo donde el reproductor nativo de Vega no abre (lo que probaban estas pruebas antes de la 1.0.66): el lector de la app
const noNative = () => { memory['native_live_'+APP_VERSION]='no'; };
after(()=>{Module._load=originalLoad;if(previousTs)require.extensions['.ts']=previousTs;else delete require.extensions['.ts'];});
function setup({tracks=[],subs=[],cached=null,os='2.0.0'}={}){
  memory={};noNative();calls=[];probe=cached;shakas=[];mp4s=[];mkvs=[];toasts=[];release=null;firmware=os;
  engineAvailable=false;panelError='';denied='';
  mkvTracks=[{lang:'spa',codec:'A_AAC'},{lang:'eng',codec:'A_AAC'}];
  const video={
    src:'', currentTime:0, duration:600, paused:false, muted:false, audioTracks:tracks, textTracks:subs, resets:0,
    play(){this.paused=false;return Promise.resolve();},
    pause(){this.paused=true;},
    setSrcWithCustomHeaders(src,headers){this.src=src;this.headers=headers;},
    removeAttribute(){this.src='';},
    load(){this.currentTime=0;this.resets++;this.error=null;},
  };
  const hooks={
    toast:m=>toasts.push(m),status:()=>{},changed:()=>{},subText:()=>{},fatal:m=>hooks.errors.push(m),errors:[],
    vodFailed:at=>{hooks.failures.push(at);},failures:[],
    vodPlaying:()=>{hooks.starts++;},starts:0,
  };
  const c=new Playback(video,hooks);
  return {c,video,hooks};
}
const dual = {ok:true,container:'mkv',audio:[{lang:'es',name:'',codec:'aac',def:true},{lang:'en',name:'',codec:'aac',def:false}],subs:[]};
const tick = ()=>new Promise(r=>setTimeout(r,0));
const choose = (c,needle)=>c.select(c.menu().find(m=>m.kind==='audio' && m.label.includes(needle)));
const local = (c, url, at=0) => {
  c.load(url, at, false);
  c.vodError('fixture sin acceso al modo URL');
};

test('HLS y DASH abren Shaka inmediatamente sin consultar el motor',async()=>{
  for(const ext of ['m3u8','mpd']){
    const {c}=setup();c.load('https://fixture.invalid/video.'+ext,0,false);
    assert.equal(shakas.length,1);assert.equal(c.menu().filter(m=>m.kind==='audio').length,2);assert.deepEqual(calls,[]);await c.destroy();
  }
});
test('audio Shaka conserva posición y pausa sin recargar la fuente',async()=>{
  const {c,video}=setup();c.load('https://fixture.invalid/serie.m3u8',0,false);video.currentTime=125;video.paused=true;
  const src=video.src;choose(c,'Inglés');assert.equal(shakas[0].active,'en');assert.equal(video.src,src);assert.equal(video.currentTime,125);assert.equal(video.paused,true);assert.deepEqual(calls,[]);await c.destroy();
});
test('canales en vivo .m3u8 van por el lector propio sin huecos (no por Shaka)',async()=>{
  const {c}=setup();c.load('https://fixture.invalid/canal.m3u8',0,true);assert.equal(shakas.length,0);await c.destroy();
});
test('archivo con pistas nativas (AVI) utiliza el equipo antes del panel',async()=>{
  const tracks=[{language:'es',enabled:true},{language:'en',enabled:false}];
  const {c,video}=setup({tracks,cached:dual});c.load('https://fixture.invalid/video.avi',0,false);video.currentTime=155;choose(c,'Inglés');
  assert.equal(tracks[1].enabled,true);assert.equal(tracks[0].enabled,false);assert.equal(video.currentTime,155);assert.deepEqual(calls,[]);await c.destroy();
});
test('pista no expuesta localmente consulta el panel solo al seleccionarla',async()=>{
  const {c}=setup({tracks:[{language:'es',enabled:true}],cached:dual});c.load('https://fixture.invalid/video.avi',0,false);assert.deepEqual(calls,[]);
  choose(c,'Inglés');await tick();assert.deepEqual(calls,['mediaEngine']);await c.destroy();
});
test('una ruta remota guardada no evita el intento local',async()=>{
  const {c,video}=setup();memory.panel_route_3={'fixture.invalid/video.avi':{r:'v',t:Date.now()}};
  c.load('https://fixture.invalid/video.avi',0,false);assert.equal(video.src,'https://fixture.invalid/video.avi');assert.deepEqual(calls,[]);await c.destroy();
});
test('MSE MP4 selecciona la segunda pista sin motor y reutiliza el índice',async()=>{
  const {c,video}=setup();local(c,'https://fixture.invalid/video.mp4');await tick();c.onPlaying();video.currentTime=180;choose(c,'Inglés');await tick();
  assert.equal(mp4s.length,2);assert.equal(mp4s[1].audioIdx,1);assert.equal(mp4s[1].index,mp4s[0].index);assert.equal(video.currentTime,180);assert.deepEqual(calls,[]);await c.destroy();
});
test('MKV: la app lo lee y cambia el audio en el equipo, sin servidor (como Android)',async()=>{
  const {c,video}=setup();local(c,'https://fixture.invalid/video.mkv');await tick();c.onPlaying();
  assert.equal(mkvs.length,1);assert.equal(c.menu().filter(m=>m.kind==='audio').length,2);
  video.currentTime=240;choose(c,'Inglés');await tick();
  assert.equal(mkvs.length,2);assert.equal(mkvs[1].audioIdx,1);assert.equal(mkvs[1].index,mkvs[0].index);assert.equal(video.currentTime,240);assert.deepEqual(calls,[]);await c.destroy();
});
test('audio que el equipo no decodifica con el servidor apagado: aviso de encender el servidor',async()=>{
  const {c}=setup();mkvTracks=[{lang:'spa',codec:'A_AAC'},{lang:'eng',codec:'A_TRUEHD'}];local(c,'https://fixture.invalid/video.mkv');await tick();c.onPlaying();
  choose(c,'Inglés');await tick();await tick();
  assert.deepEqual(calls,['mediaEngine']);assert.ok(toasts.some(m=>m.includes('es necesario encender el servidor')),toasts.join(' | '));await c.destroy();
});
test('MKV: subtítulos de texto leídos por la app, sin servidor',async()=>{
  const {c}=setup();local(c,'https://fixture.invalid/video.mkv');await tick();
  const sub=c.menu().find(m=>m.kind==='text' && m.label.includes('Español'));assert.ok(sub);
  c.select(sub);await tick();assert.deepEqual(calls,[]);assert.ok(c.menu().find(m=>m.kind==='text' && m.label.includes('Español')).on);await c.destroy();
});
test('cambios nativos rápidos cancelan la comprobación de la selección anterior',async()=>{
  const {c}=setup({tracks:[{language:'es',enabled:true},{language:'en',enabled:false}],cached:dual});c.load('https://fixture.invalid/video.avi',0,false);
  choose(c,'Inglés');choose(c,'Español');await new Promise(r=>setTimeout(r,1550));assert.deepEqual(calls,[]);await c.destroy();
});
test('destrucción de Shaka termina antes de adjuntar la fuente siguiente',async()=>{
  const {c,video}=setup();c.load('https://fixture.invalid/video.m3u8',0,false);
  let finish;release=new Promise(r=>{finish=r;});c.load('https://fixture.invalid/next.avi',0,false);
  assert.equal(video.src,'https://fixture.invalid/video.m3u8');finish();await tick();assert.equal(video.src,'https://fixture.invalid/next.avi');await c.destroy();
});
test('pista única no provoca una petición al panel',async()=>{
  const {c}=setup({tracks:[{language:'es',enabled:true}]});c.load('https://fixture.invalid/video.avi',0,false);choose(c,'Español');assert.deepEqual(calls,[]);await c.destroy();
});
test('Shaka 4.16: audios sin id mantienen identidad distinta y seleccionan el idioma correcto',()=>{
  const {ShakaPlayback}=require('../src/player/shaka.ts');
  const adapter=new ShakaPlayback({});
  let tracks=[{language:'es',label:'Español',roles:[],codecs:'mp4a.40.2',active:true},{language:'en',label:'Inglés',roles:[],codecs:'mp4a.40.2',active:false}];
  let picked=null;
  adapter.player={getAudioTracks:()=>tracks,selectAudioTrack:track=>{picked=track;}};
  const options=adapter.audioTracks();
  assert.notEqual(options[0].id,options[1].id);
  tracks=tracks.slice().reverse();
  assert.equal(adapter.selectAudio(options[1].id),true);
  assert.equal(picked.language,'en');
});
test('el lector MSE cancela peticiones del contenido que se cierra',async()=>{
  const {Mp4Mse}=require('../src/player/mp4mse.ts');
  const originalFetch=global.fetch;
  let aborted=false;
  global.fetch=(_url,{signal})=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>resolve({status:503}),100);
    signal.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);reject(new Error('abortado'));},{once:true});
  });
  try {
    const reader=new Mp4Mse({},'https://fixture.invalid/video.mp4');
    const pending=reader.get(0,16);reader.destroy();
    assert.equal(await pending,null);assert.equal(aborted,true);
  } finally {global.fetch=originalFetch;}
});
test('canales con audio MP2 (CINEMAX, tipo 0x03): los cuadros se leen para el MP4 propio aunque vengan partidos',()=>{
  const {otherFrames,mpaHead}=require('../src/lib/tsdemux.ts');
  // MPEG-1 capa II, 256 kb/s, 48 kHz: cuadros de 768 bytes y 1152 muestras
  const frame=()=>{const f=new Uint8Array(768);f.set([0xff,0xfd,0xc4,0x00]);return f;};
  assert.deepEqual(mpaHead(frame(),0),{len:768,rate:48000,channels:2,samples:1152});
  const all=new Uint8Array(768*3);for(let i=0;i<3;i++) all.set(frame(),i*768);
  const a=otherFrames('mpa',[{pts:9000,dts:9000,data:all.subarray(0,1000)}],null);
  assert.equal(a.frames.length,1);assert.equal(a.info.rate,48000);
  const b=otherFrames('mpa',[{pts:-1,dts:-1,data:all.subarray(1000)}],a.rest);
  assert.deepEqual(b.frames.map(f=>f.pts),[9000+2160,9000+4320]);
  assert.equal(b.rest,null);
});
test('MKV con E-AC-3 intenta el audio nativo antes de preparar una conversión',async()=>{
  const {c,video}=setup();
  mkvTracks=[{lang:'spa',codec:'A_EAC3'}];
  c.load('https://fixture.invalid/dolby.mkv',0,false);
  assert.equal(mkvs.length,0);
  assert.equal(video.src,'https://fixture.invalid/dolby.mkv');
  assert.deepEqual(calls,[]);
  c.vodError('códec rechazado');
  await tick();
  assert.equal(mkvs.length,1);
  assert.deepEqual(calls,['mediaEngine']);
  await c.destroy();
});
test('canal en vivo: un fallo suelto del nativo se prueba otra vez con un reproductor nuevo (como la miniatura); con dos seguidos, el lector propio, alternando MP4 y MPEG-TS',async()=>{
  lives=[];let {c,video}=setup();delete memory['native_live_'+APP_VERSION];
  c.load('http://fixture.invalid/live/u/p/1.m3u8',0,true);await tick();
  assert.equal(lives.length,0);assert.equal(video.src,'http://fixture.invalid/live/u/p/1.ts');
  // el primer fallo (el canal anterior todavía soltaba el decodificador al cambiar rápido): otra vez el nativo, en un reproductor nuevo
  assert.equal(c.liveNext(),'fresh');assert.equal(lives.length,0);await c.destroy();
  ({c,video}=setup());delete memory['native_live_'+APP_VERSION];
  c.load('http://fixture.invalid/live/u/p/1.m3u8',0,true);await tick();
  assert.equal(video.src,'http://fixture.invalid/live/u/p/1.ts','el reproductor nuevo prueba otra vez el nativo');
  // el segundo seguido: el lector propio en este mismo reproductor
  assert.equal(c.liveNext(),'here');assert.equal(lives.length,1);
  // ese canal se congela con el lector propio: el nativo ya falló dos veces con él, así que sigue alternando el lector
  lives[0].frozen=true;assert.equal(c.liveNext(),'here');assert.equal(lives.length,2);assert.equal(lives[1].tsOnly,false);
  c.load('http://fixture.invalid/live/u/p/9.m3u8',0,true);await tick();lives=[];
  memory['native_live_'+APP_VERSION]='no';
});

test('canal que el lector entrega y el equipo no muestra (HBO en MPEG-TS, buf vacío): el nativo con un reproductor nuevo; si no, el otro modo del lector; nunca el otro protocolo',async()=>{
  lives=[];let {c,video}=setup();memory['native_live_'+APP_VERSION]='ok';
  const u='http://fixture.invalid/live/u/p/51.m3u8';
  c.load(u,0,true);await tick();assert.equal(video.src,'http://fixture.invalid/live/u/p/51.ts');
  assert.equal(c.liveNext(),'fresh');await c.destroy();
  ({c,video}=setup());memory['native_live_'+APP_VERSION]='ok';
  c.load(u,0,true);await tick();assert.equal(c.liveNext(),'here');assert.equal(lives.length,1);assert.equal(lives[0].tsOnly,false);
  // en MP4 propio no se ve: MPEG-TS en el mismo reproductor (el nativo ya falló dos veces)
  lives[0].noShow=true;assert.equal(c.liveNext(),'here');assert.equal(lives.length,2);assert.equal(lives[1].tsOnly,true);
  // tampoco en MPEG-TS: no queda otra forma (Player avisa; no prueba https ni el DNS)
  lives[1].noShow=true;assert.equal(c.liveNext(),'');
  await c.destroy();
  // un canal que el nativo nunca probó: lo que el lector no muestra va al nativo con un reproductor nuevo
  ({c,video}=setup());memory['native_live_'+APP_VERSION]='no';
  c.load('http://fixture.invalid/live/u/p/52.m3u8',0,true);await tick();const n=lives.length;
  memory['native_live_'+APP_VERSION]='ok';lives[n-1].noShow=true;assert.equal(c.liveNext(),'fresh');
  await c.destroy();lives=[];memory['native_live_'+APP_VERSION]='no';
});

test('MP4 propio rechazado: solo ese canal pasa a MPEG-TS (antes todos los canales de la sesión)',async()=>{
  lives=[];const {c}=setup();
  c.load('http://fixture.invalid/live/u/p/61.m3u8',0,true);await tick();
  assert.equal(lives[0].tsOnly,false);lives[0].mf=true;assert.equal(c.liveNext(),'here');assert.equal(lives[1].tsOnly,true);
  c.load('http://fixture.invalid/live/u/p/62.m3u8',0,true);await tick();assert.equal(lives[2].tsOnly,false,'otro canal sigue en MP4');
  c.load('http://fixture.invalid/live/u/p/61.m3u8',0,true);await tick();assert.equal(lives[3].tsOnly,true,'ese canal, en MPEG-TS');
  await c.destroy();lives=[];
});

test('canales: el reproductor nativo primero; si abre, el equipo lo recuerda; 3 fallos seguidos sin abrir nunca = el lector propio hasta cerrar la app (no para siempre)',async()=>{
  lives=[];let {c,video}=setup();delete memory['native_live_'+APP_VERSION];
  c.load('http://fixture.invalid/live/u/p/7.m3u8',0,true);await tick();
  assert.equal(lives.length,0);assert.equal(video.src,'http://fixture.invalid/live/u/p/7.ts');assert.match(c.liveDiag(),/modo=nativo/);
  c.onPlaying();assert.equal(memory['native_live_'+APP_VERSION],'ok');await c.destroy();
  // otro equipo donde el nativo nunca abre: 2 canales fallan y desde ahí todo por el lector propio
  // (cada canal con su reproductor, como la miniatura)
  ({c,video}=setup());delete memory['native_live_'+APP_VERSION];
  const hooks={toast(){},status(){},changed(){},subText(){},fatal(){}};
  // cada canal: el primer fallo con un reproductor nuevo; el segundo cuenta
  for(const n of [21,22,24])for(let k=0;k<2;k++){c=new Playback({...video,src:''},hooks);c.load('http://fixture.invalid/live/u/p/'+n+'.m3u8',0,true);await tick();assert.equal(c.liveDiag().includes('modo=nativo'),true);assert.equal(c.liveNext(),k?'here':'fresh');await c.destroy();}
  // nada guardado: la próxima vez que se abra la app se prueba otra vez el nativo
  assert.equal(memory['native_live_'+APP_VERSION],undefined);
  c=new Playback({...video,src:''},hooks);
  const before=lives.length;c.load('http://fixture.invalid/live/u/p/23.m3u8',0,true);await tick();assert.equal(lives.length,before+1);
  await c.destroy();
});

test('canal congelado: alternando MP4 y MPEG-TS hasta 6 veces (equipo sin reproductor nativo)',async()=>{
  lives=[];const {c,video}=setup();c.load('http://fixture.invalid/live/u/p/1.m3u8',0,true);await tick();
  assert.equal(lives.length,1);lives[0].frozen=true;assert.equal(c.liveRetryTs(),true);
  assert.equal(lives.length,2);assert.equal(lives[1].tsOnly,false);lives[1].frozen=true;assert.equal(c.liveRetryTs(),true);
  assert.equal(lives[2].tsOnly,true);for(let k=2;k<6;k++){lives[k].frozen=true;assert.equal(c.liveRetryTs(),true);}
  assert.equal(lives[6].tsOnly,true);lives[6].frozen=true;assert.equal(c.liveRetryTs(),false);
  c.load('http://fixture.invalid/live/u/p/2.m3u8',0,true);await tick();assert.equal(lives[7].tsOnly,false);await c.destroy();
});

test('películas desde el principio: reproductor nativo primero; otro idioma pasa al lector de la app desde el mismo segundo',async()=>{
  const {c,video}=setup({cached:dual});delete memory['native_vod_'+APP_VERSION];
  c.load('https://fixture.invalid/nat1.mkv',0,false);await tick();
  assert.equal(mkvs.length,0);assert.equal(video.src,'https://fixture.invalid/nat1.mkv');
  c.onPlaying();assert.equal(memory['native_vod_'+APP_VERSION],'ok');
  // el menú con los idiomas del archivo (sin «Audio predeterminado» del panel)
  const audios=c.menu().filter(m=>m.kind==='audio');assert.equal(audios.length,2);assert.ok(!audios.some(m=>m.key==='def'));
  video.currentTime=120;choose(c,'Inglés');await tick();
  assert.equal(mkvs.length,1);assert.equal(mkvs[0].audioIdx,1);assert.equal(video.currentTime,120);assert.deepEqual(calls,[]);
  await c.destroy();
});

test('varios fallos nativos no cambian la ruta de un título nuevo ni la de un archivo que vuelve a abrirse',async()=>{
  const {c,video,hooks}=setup();
  memory['native_vod_'+APP_VERSION]='no';
  for(const n of [2,3,2]){
    const url='https://fixture.invalid/nat'+n+'.mp4';
    c.load(url,0,false);
    assert.equal(video.src,url);
    const before=mp4s.length;
    c.vodError('rechazo de esta fuente');
    await tick();
    assert.equal(mp4s.length,before+1);
    assert.equal(video.src,'');
  }
  c.load('https://fixture.invalid/nat4.mp4',0,false);
  assert.equal(video.src,'https://fixture.invalid/nat4.mp4');
  assert.match(video.headers['User-Agent'],/LatMpxFireTV/);
  assert.deepEqual(hooks.failures,[]);
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('Continuar viendo nativo (respaldo si el lector no puede) espera avance real tras saltar al segundo guardado',async()=>{
  const {c,video,hooks}=setup();
  c.load('https://fixture.invalid/episode.mkv',214,false);
  // 2.1.4: Continuar viendo abre con el lector de la app; el de Amazon solo si el lector no puede
  assert.equal(mkvs.length,1);
  c.vodError('el lector no pudo');await tick();
  assert.equal(video.src,'https://fixture.invalid/episode.mkv');
  assert.equal(video.muted,true);
  assert.equal(c.resumePos(),214);
  video.seekable={length:1,start:()=>0,end:()=>600};
  c.onCanPlay();
  assert.equal(video.currentTime,214);
  c.onPlaying();
  c.onTime();
  assert.equal(c.hasPlayed(),false);
  assert.equal(c.resumePos(),214);
  video.currentTime=214.2;
  c.onTime();
  assert.equal(c.hasPlayed(),true);
  assert.equal(hooks.starts,1);
  assert.equal(video.muted,false);
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('2.1.4: Continuar viendo abre con el lector de la app desde el segundo guardado (antes el de Amazon empezaba en 0, saltaba y quedaba en negro) y la VPS espera',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
  const {c,video,hooks}=setup();
  c.load('https://fixture.invalid/episode.mp4',312,false);
  assert.notEqual(video.src,'https://fixture.invalid/episode.mp4');
  assert.equal(c.resumePos(),312);
  assert.equal(mp4s.length,1);
  assert.equal(mp4s[0].at,312);
  assert.equal(video.muted,false);
  assert.deepEqual(calls,[]);
  assert.deepEqual(hooks.failures,[]);
  await c.destroy();
});

test('2.1.4: el reproductor de Amazon abrió el archivo y no pudo: el lector va en un reproductor nuevo (en el mismo quedaba en negro) y ese archivo no vuelve al de Amazon',async()=>{
  const {c,video,hooks}=setup();
  const fresh=[];hooks.vodFresh=at=>fresh.push(at);
  const url='https://fixture.invalid/movie/u/p/fresh1.mp4';
  c.load(url,0,false);assert.equal(video.src,url);
  c.vodError('el reproductor no inició');await tick();
  assert.deepEqual(fresh,[0]);assert.equal(mp4s.length,0,'el lector no se abre en este reproductor');
  await c.destroy();
  // el reproductor nuevo (Player lo crea) abre con el lector
  const {c:c2,video:v2}=setup();
  c2.load(url,0,false);assert.notEqual(v2.src,url);assert.equal(mp4s.length,1);
  // y si el lector tampoco puede, no vuelve al de Amazon: el aviso de Player
  c2.vodError('el lector no pudo');await tick();
  assert.notEqual(v2.src,url);
  await c2.destroy();
});

test('película sin señales de vida libera el modo URL y prueba el lector sin esperar una segunda alarma',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
  const {c,video}=setup();
  c.load('https://fixture.invalid/quiet.mp4',0,false);
  t.mock.timers.tick(12500);
  assert.equal(video.resets,1);
  assert.equal(mp4s.length,1);
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('ambas rutas locales fallan conservando el punto de reanudación antes de consultar el panel',async()=>{
  const {c,hooks}=setup();
  c.load('https://fixture.invalid/movie/u/p/noindex.mp4',241,false);
  c.vodError('fuente no aceptada');
  await tick();
  // el lector primero (Continuar viendo); después el de Amazon
  c.vodError('fuente no aceptada');
  await tick();
  assert.deepEqual(hooks.failures,[241]);
  assert.deepEqual(calls,[]);
  assert.equal(await c.panelOpen(241),false);
  assert.deepEqual(calls,['mediaEngine']);
  await c.destroy();
});

test('un subtítulo de texto MKV sin pista nativa se carga en el equipo desde el mismo segundo',async()=>{
  const cached={...dual,subs:[{id:'0',lang:'spa',codec:'S_TEXT/UTF8',name:'',def:false,forced:false}]};
  const {c,video}=setup({cached});
  c.load('https://fixture.invalid/nat6.mkv',0,false);
  c.onPlaying();
  video.currentTime=60;
  c.select(c.menu().find(m=>m.kind==='text'&&m.key!=='off'));
  await tick();
  assert.equal(mkvs.length,1);
  assert.equal(mkvs[0].at,60);
  assert.equal(c.menu().find(m=>m.kind==='text'&&m.key!=='off').on,true);
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('subtítulo MKV expuesto por Vega cambia y se desactiva sin recargar ni pedir al panel',async()=>{
  const text={id:'1',language:'spa',kind:'subtitles',mode:'disabled'};
  const {c,video}=setup({subs:[text]});
  c.load('https://fixture.invalid/native-sub.mkv',0,false);
  c.onPlaying();
  video.currentTime=85;
  c.select(c.menu().find(m=>m.kind==='text'&&m.key==='n:1'));
  assert.equal(text.mode,'showing');
  assert.equal(video.currentTime,85);
  assert.equal(mkvs.length,0);
  c.select(c.menu().find(m=>m.kind==='text'&&m.key==='off'));
  assert.equal(text.mode,'disabled');
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('Vega detecta pistas nuevas sin catálogo y respeta el orden real de audio y texto',async()=>{
  const es={id:'a-es',language:'es-419',enabled:true};
  const en={id:'a-en',language:'eng',enabled:false};
  const {c,video}=setup({tracks:[en,es],cached:dual});
  c.load('https://fixture.invalid/reordered.mp4',0,false);
  c.onPlaying();
  choose(c,'Inglés');
  assert.equal(en.enabled,true);
  assert.equal(es.enabled,false);
  assert.equal(video.resets,0);
  assert.equal(mp4s.length,0);
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('preferencia guardada y pistas tardías se aplican en Vega incluso al reanudar',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
  const {c,video}=setup();
  const url='https://fixture.invalid/late-tracks.mp4';
  const {seedTitleLang}=require('../src/player/playback.ts');
  seedTitleLang(url,'en',1);
  memory.pref_subs_lang='pt';
  c.load(url,98,false);
  // 2.1.4: al reanudar va primero el lector; aquí no puede y sigue el de Amazon
  c.vodError('el lector no pudo');
  const readers=mp4s.length;
  c.onMeta();
  t.mock.timers.tick(180);
  const en={id:'en',language:'eng',enabled:false};
  const pt={id:'pt',language:'por',kind:'subtitles',mode:'disabled'};
  video.audioTracks=[{id:'es',language:'spa',enabled:true},en];
  video.textTracks=[pt];
  c.schedulePrefs();
  t.mock.timers.tick(180);
  assert.equal(en.enabled,true);
  assert.equal(pt.mode,'showing');
  assert.equal(video.src,url);
  assert.equal(mp4s.length,readers,'las pistas del de Amazon no vuelven a abrir el lector');
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('un archivo con pistas ocultas puede abrirse con el lector local desde el menú',async()=>{
  const {c,video}=setup({tracks:[{id:'1',language:'es',enabled:true}]});
  c.load('https://fixture.invalid/hidden.mp4',0,false);
  c.onPlaying();
  video.currentTime=127;
  c.select(c.menu().find(m=>m.kind==='local'));
  await tick();
  assert.equal(mp4s.length,1);
  assert.equal(mp4s[0].at,127);
  assert.deepEqual(calls,[]);
  await c.destroy();
});

test('pantalla grande: cambiar de canal en el mismo reproductor va por el lector de la app (el nativo daba error y «Reconectando…»)',async()=>{
  lives=[];const {c,video}=setup();memory['native_live_'+APP_VERSION]='ok';
  c.load('http://fixture.invalid/live/u/p/31.m3u8',0,true);await tick();
  assert.equal(video.src,'http://fixture.invalid/live/u/p/31.ts');assert.equal(lives.length,0);
  c.onPlaying();
  // ▲▼ al canal siguiente: el lector de la app, sin pasar por el nativo
  c.load('http://fixture.invalid/live/u/p/32.m3u8',0,true);await tick();
  assert.equal(lives.length,1);assert.notEqual(video.src,'http://fixture.invalid/live/u/p/32.ts');assert.doesNotMatch(c.liveDiag(),/modo=nativo/);
  await c.destroy();memory['native_live_'+APP_VERSION]='no';
});

test('error 4 al instante con http en el nativo (Vega OS antes de 2.0): el resto de la sesión, http va directo al lector; https sigue con el nativo',async()=>{
  lives=[];const {c,video}=setup({os:'1.2.3'});memory['native_live_'+APP_VERSION]='ok';
  c.load('http://fixture.invalid/live/u/p/41.m3u8',0,true);await tick();
  assert.equal(video.src,'http://fixture.invalid/live/u/p/41.ts');
  video.error={code:4};assert.equal(c.liveRetryTs(),true);await c.destroy();
  // con Vega OS 1.2 se dice cómo arreglarlo (una vez)
  assert.ok(toasts.some(m=>m.includes('Vega OS 1.2.3')&&m.includes('2.0')),toasts.join(' | '));
  const {c:c2,video:v2}=setup();memory['native_live_'+APP_VERSION]='ok';
  c2.load('http://fixture.invalid/live/u/p/42.m3u8',0,true);await tick();
  assert.notEqual(v2.src,'http://fixture.invalid/live/u/p/42.ts');assert.equal(lives.length,2);
  await c2.destroy();
  const {c:c3,video:v3}=setup();memory['native_live_'+APP_VERSION]='ok';
  c3.load('https://fixture.invalid/live/u/p/43.m3u8',0,true);await tick();
  assert.equal(v3.src,'https://fixture.invalid/live/u/p/43.ts');
  await c3.destroy();memory['native_live_'+APP_VERSION]='no';
});

test('película «.mp4» que en realidad es MKV (remux de 10 GB con AC-3): el lector de MKV con el mismo archivo, también en Continuar viendo',async()=>{
  for(const at of [0,600]){
    const {c,video}=setup();
    c.load('http://fixture.invalid/movie/u/p/mkvbody'+at+'.mp4',at,false);await tick();await tick();
    assert.equal(mp4s.length,1);assert.equal(mkvs.length,1);assert.equal(mkvs[0].url,'http://fixture.invalid/movie/u/p/mkvbody'+at+'.mp4');
    assert.equal(video.currentTime,at);assert.notEqual(video.src,'http://fixture.invalid/movie/u/p/mkvbody'+at+'.mp4');
    await c.destroy();
  }
});
test('2.0.14: un canal que el nativo no abrió 2 veces va directo al lector (se recuerda en el equipo); uno suelto, no',()=>{
  memory={};
  delete require.cache[require.resolve('../src/player/nativemode.ts')];
  const n=require('../src/player/nativemode.ts');
  const u='http://srv.example:80/live/user/pass/978566.m3u8';
  assert.equal(n.nativeLiveBad(u),false);
  n.markNativeLiveBad(u);
  assert.equal(n.nativeLiveBad(u),false,'un fallo suelto no lo marca');
  n.markNativeLiveBad('https://srv.example:80/live/otro/clave/978566.ts');
  assert.equal(n.nativeLiveBad(u),true,'mismo canal por https, otra línea u otro formato: es el mismo');
  assert.equal(n.nativeLiveBad('http://srv.example:80/live/user/pass/978567.m3u8'),false,'otro canal no');
  // guardado en el equipo: al abrir la app de nuevo sigue marcado
  delete require.cache[require.resolve('../src/player/nativemode.ts')];
  const n2=require('../src/player/nativemode.ts');
  assert.equal(n2.nativeLiveBad(u),true);
  n2.nativeLiveGood(u);
  assert.equal(n2.nativeLiveBad(u),false,'si el nativo lo muestra, se olvida');
});
test('2.0.14: el idioma del título llega del panel (otro equipo) y vuelve al panel al guardar; lo elegido aquí manda',()=>{
  memory={};
  const p=require('../src/player/playback.ts');
  const u='http://srv.example/movie/u/p/55.mp4';
  assert.equal(p.titlePlayHint(u),undefined,'sin elegir nada no se manda idioma (el panel conserva el que haya)');
  p.seedTitleLang(u,'spa',1);
  assert.equal(p.titleLangOf('https://srv.example/movie/u/p/55.mp4'),'spa','el mismo archivo por https');
  assert.deepEqual(p.titlePlayHint(u),{a:'spa',ai:1});
  p.seedTitleLang(u,'eng',0);
  assert.equal(p.titleLangOf(u),'spa','lo que ya tiene este equipo no se pisa');
  p.seedTitleLang('http://srv.example/movie/u/p/56.mp4','',-1);
  assert.equal(p.titleLangOf('http://srv.example/movie/u/p/56.mp4'),'','sin idioma en el panel no se guarda nada');
});

// 2.0.16: idiomas con el reproductor nativo (equipo donde el nativo abre películas)
const nativeOk = () => { delete memory['native_vod_'+APP_VERSION]; };
test('nativo: los idiomas que recuerda el panel llegan al menú sin leer el archivo del servidor IPTV',async()=>{
  const {c}=setup();nativeOk();
  const before=media.knownNow;media.knownNow=()=>null;probe=dual;
  try {
    c.load('https://fixture.invalid/movie/u/p/2001.mp4',0,false);
    for(let i=0;i<5;i++) await tick();
    const labels=c.menu().filter(m=>m.kind==='audio').map(m=>m.label).join('|');
    assert.match(labels,/Inglés/);assert.equal(mp4s.length,0);
  } finally {media.knownNow=before;await c.destroy();}
});
test('nativo: con las dos pistas en el reproductor de Vega el idioma cambia ahí mismo (sin abrir otra vez el video)',async()=>{
  const tracks=[{language:'es',label:'',enabled:true},{language:'en',label:'',enabled:false}];
  const {c}=setup({tracks,cached:dual});nativeOk();
  c.load('https://fixture.invalid/movie/u/p/2002.mp4',0,false);await tick();
  choose(c,'Inglés');
  assert.equal(tracks[1].enabled,true);assert.equal(tracks[0].enabled,false);
  await new Promise(r=>setTimeout(r,1600));
  assert.equal(mp4s.length,0);assert.ok(toasts.some(t=>t.includes('Inglés')),toasts.join('|'));
  await c.destroy();
});
test('nativo: si el reproductor de Vega no informa la otra pista, el lector de la app la abre desde el mismo segundo',async()=>{
  const {c,video}=setup({tracks:[{language:'es',label:'',enabled:true}],cached:dual});nativeOk();
  c.load('https://fixture.invalid/movie/u/p/2003.mp4',0,false);await tick();c.onPlaying();video.currentTime=95;
  choose(c,'Inglés');await tick();
  assert.equal(mp4s.length,1);assert.equal(mp4s[0].audioIdx,1);
  await c.destroy();
});
test('lector MP4: sus idiomas se dejan en el panel para los equipos que abren con el nativo',async()=>{
  const {c}=setup();shared=[];
  local(c,'https://fixture.invalid/movie/u/p/2004.mp4');await tick();
  assert.equal(shared.length>0,true);
  assert.deepEqual(shared[0][1].audio.map(a=>a.lang),['spa','eng']);
  await c.destroy();
});
test('nativo: lo que la ficha preparaba con el lector se corta al abrir con el nativo; con el índice local y un punto guardado abre el lector',async()=>{
  const {c}=setup({cached:dual});nativeOk();dropped=[];
  const u1='https://fixture.invalid/movie/u/p/2005.mp4';
  c.load(u1,0,false);await tick();
  assert.equal(mp4s.length,0);assert.deepEqual(dropped,[u1]);
  await c.destroy();
  const {c:c2}=setup({cached:dual});nativeOk();
  const u2='https://fixture.invalid/movie/u/p/2006.mp4';ready.add(u2);
  c2.load(u2,180,false);await tick();
  assert.equal(mp4s.length,1);
  ready.delete(u2);await c2.destroy();
  // 2.1.3: también desde el principio (la ficha leyó el índice mientras se miraba): el lector, una sola espera del servidor
  const {c:c3}=setup({cached:dual});nativeOk();
  const u3='https://fixture.invalid/movie/u/p/2007.mp4';ready.add(u3);
  c3.load(u3,0,false);await tick();
  assert.equal(mp4s.length,1);assert.doesNotMatch(c3.vodMode(),/modo=nativo/);
  ready.delete(u3);await c3.destroy();
});

test('2.1.0: el lector no pudo con un MP4 por http y el nativo nunca abrió en el equipo: sin el modo directo (error 4 seguro), Player sigue ya',async()=>{
  const {c,video,hooks}=setup();c.load('http://fixture.invalid/movie/u/p/noindex.mp4',0,false);await tick();await tick();
  assert.notEqual(video.src,'http://fixture.invalid/movie/u/p/noindex.mp4');assert.deepEqual(hooks.failures,[0]);
  assert.ok(c.vodMode().includes('sin contestar'),c.vodMode());await c.destroy();
});
test('2.1.0: con https (o un equipo donde el nativo ya abrió) el modo directo sigue siendo el respaldo',async()=>{
  const {c,video,hooks}=setup();c.load('https://fixture.invalid/movie/u/p/noindex.mp4',0,false);await tick();await tick();
  assert.equal(video.src,'https://fixture.invalid/movie/u/p/noindex.mp4');assert.deepEqual(hooks.failures,[]);await c.destroy();
});

test('2.1.0: MP4 con el índice entero: otro idioma en el mismo lector, sin abrir de nuevo ni pedir al servidor',async()=>{
  const {c,video}=setup();local(c,'https://fixture.invalid/inplace.mp4');await tick();c.onPlaying();video.currentTime=180;choose(c,'Inglés');await tick();
  assert.equal(mp4s.length,1);assert.equal(mp4s[0].switched,1);assert.equal(mp4s[0].audioIdx,1);assert.equal(video.currentTime,180);
  assert.ok(c.menu().find(m=>m.kind==='audio'&&m.label.includes('Inglés')).on);assert.deepEqual(calls,[]);await c.destroy();
});

test('2.1.0: subtítulos de texto dentro de un MP4: al menú y a la pantalla sin el servidor',async()=>{
  const {c}=setup();local(c,'https://fixture.invalid/mp4subs.mp4');await tick();
  const sub=c.menu().find(m=>m.kind==='text'&&m.label.includes('Español'));assert.ok(sub,JSON.stringify(c.menu()));
  c.select(sub);await tick();assert.deepEqual(calls,[]);assert.ok(c.menu().find(m=>m.kind==='text'&&m.label.includes('Español')).on);await c.destroy();
});

test('2.1.1: índice a medias (el lector vio 2 idiomas) y el panel conoce 3: el menú muestra los 3',async()=>{
  const three={ok:true,container:'mp4',audio:[{lang:'es',name:'',codec:'aac',def:true},{lang:'en',name:'',codec:'aac',def:false},{lang:'pt',name:'',codec:'aac',def:false}],subs:[]};
  const {c}=setup({cached:three});local(c,'https://fixture.invalid/partial.mp4');await tick();
  const audios=c.menu().filter(m=>m.kind==='audio');assert.equal(audios.length,3,JSON.stringify(audios));
  assert.ok(audios.some(m=>m.label.includes('Portugu')));await c.destroy();
});

test('si la VPS rechaza la conversión tras agotar las rutas locales, termina la carga y conserva el avance',async()=>{
  const {c,hooks}=setup();
  engineAvailable=true;
  panelError='Sin permisos';
  c.load('https://fixture.invalid/noindex.mp4',95,false);
  c.vodError('formato no aceptado');
  await tick();
  c.vodError('formato no aceptado');
  await tick();
  assert.deepEqual(hooks.failures,[95]);
  assert.deepEqual(calls,[]);
  assert.equal(await c.panelOpen(95),true);
  await tick();
  assert.deepEqual(hooks.errors,['No se pudo continuar donde quedó']);
  assert.equal(c.resumePos(),95);
  await c.destroy();
});

test('Continuar viendo conserva avances recientes y reconoce el episodio de un registro antiguo',async()=>{
  const load = Module._load;
  let respond;
  const posts=[];
  Module._load = function(request,parent,isMain){
    if (parent?.filename.endsWith('/src/state.ts')) {
      const stubs = {
        './api/panel':{
          bindSession(){},forgetCloud(){},onPanelDemo(){},
          cloud(_file, method, body){
            if (method==='GET') return new Promise(resolve=>{respond=resolve;});
            posts.push(body);
            return Promise.resolve({ok:true,body:'{}'});
          },
        },
        './api/xtream':{setStreamFlip(){}},
        './data/top10':{},
        './data/catalog':{catalog:{clear(){}}},
        './lib/images':{setImgCache(){}},
        './lib/i18n':{t:key=>key},
        './lib/http':{json:response=>JSON.parse(response.body)},
        './lib/tenant':{},
        './lib/deviceid':{deviceId(){return 'test';}},
        './lib/storage':store,
      };
      if (request in stubs) return stubs[request];
    }
    return load.call(this,request,parent,isMain);
  };
  try {
    const state=require('../src/state.ts');
    state.setSession({base:'https://fixture.invalid',user:'test',pass:'test'});
    const progress={
      title:'Serie antigua',type:'series',id:'123',position:212,duration:600,
      url:'https://fixture.invalid/series/test/test/987.mkv',play:{a:'spa',ai:1},ts:100,
    };
    const reading=state.loadCloud();
    await tick();
    respond({ok:true,body:JSON.stringify({progress:{[progress.title]:progress},favorites:[]})});
    await reading;
    const saved=state.progressSeries('123');
    assert.equal(state.progressEpisodeId(saved),'987');
    assert.equal(state.resumePosition(saved),212);
    assert.deepEqual(state.playHintFor('episode','987','123'),{a:'spa',ai:1});
    assert.deepEqual(state.playHintFor('episode','988','123'),{a:'spa'});

    const old=state.loadCloud();
    await tick();
    state.saveProgress({...saved,type:'episode',id:'987',seriesId:'123',position:240},true);
    respond({ok:true,body:JSON.stringify({progress:{[progress.title]:progress}})});
    await old;
    await tick();
    assert.equal(state.progressSeries('123').position,240);
    assert.equal(posts.at(-1).position,240);

    const unavailable=state.loadCloud();
    await tick();
    respond({ok:false,body:'{"error":"temporal"}'});
    await unavailable;
    assert.equal(state.progressSeries('123').position,240);
  } finally {
    Module._load = load;
  }
});
