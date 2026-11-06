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
let probe = null;
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
  constructor(v,url,index=-1,cache=null){this.v=v;this.url=url;this.audioIdx=index<0?0:index;this.index=cache||new Uint8Array([1]);this.noAudio=false;this.tracks=[{lang:'spa',codec:'mp4a'},{lang:'eng',codec:'mp4a'}];mp4s.push(this);}
  async start(at){this.v.currentTime=at;this.onTracks();return '';}
  destroy(){}
}
class Mkv {
  constructor(v,url,index=-1,cache=null){this.v=v;this.url=url;this.audioIdx=index<0?0:index;this.index=cache||{cached:true};this.noAudio=mkvTracks.every(t=>t.codec==='A_EAC3');this.tracks=mkvTracks;mkvs.push(this);}
  probe(){return {ok:true,headOk:true,container:'mkv',audio:this.tracks.map((t,i)=>({id:String(i),lang:t.lang,codec:t.codec,name:'',def:i===0,forced:false})),subs:[{id:'0',lang:'spa',codec:'S_TEXT/UTF8',name:'',def:false,forced:false},{id:'1',lang:'eng',codec:'S_HDMV/PGS',name:'',def:false,forced:false}]};}
  subCues(n){return n===0?(this.cuesList||(this.cuesList=[{s:0,e:5,text:'hola'}])):null;}
  async start(at){this.v.currentTime=at;this.onTracks();return '';}
  timeOf(t){return t;}
  destroy(){}
}
class PanelHls {static supported(){return true;}}
let lives = [];
class LiveHls {static supported(){return true;}constructor(v,url,audio,noAudio,tsOnly){this.tsOnly=tsOnly;this.frozen=false;lives.push(this);}isMp4(){return !this.tsOnly;}otherAudio(){return false;}async start(){return '';}audioLangs(){return [];}diag(){return '';}destroy(){}}
const media = {
  engineDenied:()=>'',knownNow:()=>probe,knownTracks:async()=>probe||noTracks,
  fileTracks:async()=>probe||noTracks,
  mediaEngine:async()=>{calls.push('mediaEngine');return {ok:false,error:'Motor de prueba no disponible'};},
};
Module._load = function(request,parent,isMain){
  if(request==='@amazon-devices/react-native-w3cmedia') return {MediaSource:{isTypeSupported:()=>true}};
  if(request==='../api/media') return media;
  if(request==='../lib/storage') return store;
  if(request==='../lib/i18n'||request==='./i18n') return {t:(key,vars)=>key.replace(/\{(\w+)\}/g,(m,k)=>vars?.[k]??m)};
  if(request==='../api/report') return {reportError:()=>{}};
  if(request==='./shaka') return {ShakaPlayback:Shaka};
  if(request==='./mp4mse') return {Mp4Mse:Mp4};
  if(request==='./mkvmse') return {MkvMse:Mkv};
  if(request==='./hls') return {PanelHls};
  if(request==='./livehls') return {LiveHls,disableMp4:()=>{}};
  return originalLoad.call(this,request,parent,isMain);
};
const {Playback} = require('../src/player/playback.ts');
const {APP_VERSION} = require('../src/version.ts');
// equipo donde el reproductor nativo de Vega no abre (lo que probaban estas pruebas antes de la 1.0.66): el lector de la app
const noNative = () => { memory['native_live_'+APP_VERSION]='no'; memory['native_vod_'+APP_VERSION]='no'; };
after(()=>{Module._load=originalLoad;if(previousTs)require.extensions['.ts']=previousTs;else delete require.extensions['.ts'];});
function setup({tracks=[],cached=null}={}){
  memory={};noNative();calls=[];probe=cached;shakas=[];mp4s=[];mkvs=[];toasts=[];release=null;mkvTracks=[{lang:'spa',codec:'A_AAC'},{lang:'eng',codec:'A_AAC'}];
  const video={src:'',currentTime:0,duration:600,paused:false,audioTracks:tracks,textTracks:[],play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}};
  const c=new Playback(video,{toast:m=>toasts.push(m),status:()=>{},changed:()=>{},subText:()=>{},fatal:()=>{}});
  return {c,video};
}
const dual = {ok:true,container:'mkv',audio:[{lang:'es',name:'',codec:'aac',def:true},{lang:'en',name:'',codec:'aac',def:false}],subs:[]};
const tick = ()=>new Promise(r=>setTimeout(r,0));
const choose = (c,needle)=>c.select(c.menu().find(m=>m.kind==='audio' && m.label.includes(needle)));

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
  const {c,video}=setup();c.load('https://fixture.invalid/video.mp4',0,false);await tick();video.currentTime=180;choose(c,'Inglés');await tick();
  assert.equal(mp4s.length,2);assert.equal(mp4s[1].audioIdx,1);assert.equal(mp4s[1].index,mp4s[0].index);assert.equal(video.currentTime,180);assert.deepEqual(calls,[]);await c.destroy();
});
test('MKV: la app lo lee y cambia el audio en el equipo, sin servidor (como Android)',async()=>{
  const {c,video}=setup();c.load('https://fixture.invalid/video.mkv',0,false);await tick();
  assert.equal(mkvs.length,1);assert.equal(c.menu().filter(m=>m.kind==='audio').length,2);
  video.currentTime=240;choose(c,'Inglés');await tick();
  assert.equal(mkvs.length,2);assert.equal(mkvs[1].audioIdx,1);assert.equal(mkvs[1].index,mkvs[0].index);assert.equal(video.currentTime,240);assert.deepEqual(calls,[]);await c.destroy();
});
test('audio que el equipo no decodifica con el servidor apagado: aviso de encender el servidor',async()=>{
  const {c}=setup();mkvTracks=[{lang:'spa',codec:'A_AAC'},{lang:'eng',codec:'A_TRUEHD'}];c.load('https://fixture.invalid/video.mkv',0,false);await tick();
  choose(c,'Inglés');await tick();await tick();
  assert.deepEqual(calls,['mediaEngine']);assert.ok(toasts.some(m=>m.includes('es necesario encender el servidor')),toasts.join(' | '));await c.destroy();
});
test('MKV: subtítulos de texto leídos por la app, sin servidor',async()=>{
  const {c}=setup();c.load('https://fixture.invalid/video.mkv',0,false);await tick();
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
test('MKV con audio que no entra por MSE (E-AC-3): primero el lector nativo; si falla, el de la app como antes',async()=>{
  const {c,video}=setup();mkvTracks=[{lang:'spa',codec:'A_EAC3'}];c.load('https://fixture.invalid/video.mkv',0,false);await tick();await tick();
  assert.equal(mkvs.length,1);assert.equal(video.src,'https://fixture.invalid/video.mkv');assert.deepEqual(calls,[]);
  assert.equal(c.mp4Fallback(),true);await tick();
  assert.equal(mkvs.length,2);assert.equal(c.mp4Fallback('x'),true);await c.destroy();
});
test('canal congelado: primero el reproductor nativo de Vega (.ts directo, una vez por canal) y después alternando MP4 y MPEG-TS hasta 6 veces',async()=>{
  // un equipo que todavía no sabe si el nativo abre, con un canal que el nativo ya no pudo abrir: el lector propio
  lives=[];const {c,video}=setup();delete memory['native_live_'+APP_VERSION];
  c.load('http://fixture.invalid/live/u/p/1.m3u8',0,true);await tick();
  assert.equal(lives.length,0);assert.equal(video.src,'http://fixture.invalid/live/u/p/1.ts');
  assert.equal(c.liveRetryTs(),true);assert.equal(lives.length,1);
  // ese canal se congela con el lector propio: el nativo ya falló con él, así que sigue alternando el lector
  lives[0].frozen=true;assert.equal(c.liveRetryTs(),true);assert.equal(lives.length,2);assert.equal(lives[1].tsOnly,false);
  c.load('http://fixture.invalid/live/u/p/9.m3u8',0,true);await tick();lives=[];
  memory['native_live_'+APP_VERSION]='no';
});

test('canales: el reproductor nativo primero; si abre, el equipo lo recuerda; si falla 2 veces sin abrir nunca, el lector propio',async()=>{
  lives=[];let {c,video}=setup();delete memory['native_live_'+APP_VERSION];
  c.load('http://fixture.invalid/live/u/p/7.m3u8',0,true);await tick();
  assert.equal(lives.length,0);assert.equal(video.src,'http://fixture.invalid/live/u/p/7.ts');assert.match(c.liveDiag(),/modo=nativo/);
  c.onPlaying();assert.equal(memory['native_live_'+APP_VERSION],'ok');await c.destroy();
  // otro equipo donde el nativo nunca abre: 2 canales fallan y desde ahí todo por el lector propio
  // (cada canal con su reproductor, como la miniatura)
  ({c,video}=setup());delete memory['native_live_'+APP_VERSION];
  const hooks={toast(){},status(){},changed(){},subText(){},fatal(){}};
  for(const n of [21,22]){c=new Playback({...video,src:''},hooks);c.load('http://fixture.invalid/live/u/p/'+n+'.m3u8',0,true);await tick();assert.equal(c.liveRetryTs(),true);await c.destroy();}
  assert.equal(memory['native_live_'+APP_VERSION],'no');
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

test('películas: si el reproductor nativo no abre, el lector de la app al momento; 2 fallos sin abrir nunca = lector siempre',async()=>{
  let {c,video}=setup();delete memory['native_vod_'+APP_VERSION];
  for(const n of [2,3]){
    c.load('https://fixture.invalid/nat'+n+'.mp4',0,false);await tick();
    assert.equal(video.src,'https://fixture.invalid/nat'+n+'.mp4');const before=mp4s.length;
    assert.equal(c.mp4Fallback(),true);await tick();assert.equal(mp4s.length,before+1);
  }
  assert.equal(memory['native_vod_'+APP_VERSION],'no');
  const before=mp4s.length;c.load('https://fixture.invalid/nat4.mp4',0,false);await tick();assert.equal(mp4s.length,before+1);
  await c.destroy();
  // Continuar viendo: siempre el lector de la app (empieza en el segundo exacto)
  ({c,video}=setup());delete memory['native_vod_'+APP_VERSION];
  c.load('https://fixture.invalid/nat5.mkv',300,false);await tick();assert.equal(mkvs.length,1);assert.equal(video.currentTime,300);
  await c.destroy();
});

test('películas MKV con el reproductor nativo: un subtítulo de texto pasa al lector de la app (sin servidor)',async()=>{
  const {c,video}=setup();delete memory['native_vod_'+APP_VERSION];
  c.load('https://fixture.invalid/nat6.mkv',0,false);await tick();assert.equal(mkvs.length,0);
  // los idiomas y subtítulos del archivo, leídos ya sonando
  probe=new Mkv(video,'x').probe();mkvs.length=0;c.onPlaying();await new Promise(r=>setTimeout(r,200));
  const sub=c.menu().find(m=>m.kind==='text'&&m.key!=='off');assert.ok(sub,'hay subtítulos');
  video.currentTime=60;c.select(sub);await tick();
  assert.equal(mkvs.length,1);assert.equal(video.currentTime,60);assert.deepEqual(calls,[]);
  await c.destroy();
});

test('películas: en un equipo donde el nativo ya abrió, 2 títulos seguidos que no arrancan con él = el resto de la sesión con el lector',async()=>{
  const {nativeWorked}=require('../src/player/nativemode.ts');
  let {c,video}=setup();memory['native_vod_'+APP_VERSION]='ok';
  for(const n of [11,12]){
    c.load('https://fixture.invalid/nat'+n+'.mp4',0,false);await tick();
    assert.equal(video.src,'https://fixture.invalid/nat'+n+'.mp4');
    assert.equal(c.mp4Fallback(),true);await tick();
  }
  // el tercero ya no espera al nativo; el equipo sigue recordando que el nativo abre
  const before=mp4s.length;c.load('https://fixture.invalid/nat13.mp4',0,false);await tick();assert.equal(mp4s.length,before+1);
  assert.equal(memory['native_vod_'+APP_VERSION],'ok');
  await c.destroy();
  nativeWorked('vod');
  ({c,video}=setup());memory['native_vod_'+APP_VERSION]='ok';
  c.load('https://fixture.invalid/nat14.mp4',0,false);await tick();assert.equal(video.src,'https://fixture.invalid/nat14.mp4');
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
