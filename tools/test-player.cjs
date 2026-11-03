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
  constructor(v,url,index=-1,cache=null){this.v=v;this.url=url;this.audioIdx=index<0?0:index;this.index=cache||{cached:true};this.noAudio=false;this.tracks=mkvTracks;mkvs.push(this);}
  probe(){return {ok:true,headOk:true,container:'mkv',audio:this.tracks.map((t,i)=>({id:String(i),lang:t.lang,codec:t.codec,name:'',def:i===0,forced:false})),subs:[{id:'0',lang:'spa',codec:'S_TEXT/UTF8',name:'',def:false,forced:false},{id:'1',lang:'eng',codec:'S_HDMV/PGS',name:'',def:false,forced:false}]};}
  subCues(n){return n===0?(this.cuesList||(this.cuesList=[{s:0,e:5,text:'hola'}])):null;}
  async start(at){this.v.currentTime=at;this.onTracks();return '';}
  timeOf(t){return t;}
  destroy(){}
}
class PanelHls {static supported(){return true;}}
class LiveHls {static supported(){return true;}async start(){return '';}audioLangs(){return [];}diag(){return '';}destroy(){}}
const media = {
  engineDenied:()=>'',knownNow:()=>probe,knownTracks:async()=>probe||noTracks,
  fileTracks:async()=>probe||noTracks,
  mediaEngine:async()=>{calls.push('mediaEngine');return {ok:false,error:'Motor de prueba no disponible'};},
};
// almacenamiento de Vega (AsyncStorage): en la app de LG no está instalado; en las pruebas basta uno en memoria
const memStore = {getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{},getAllKeys:async()=>[],multiGet:async()=>[],multiSet:async()=>{},multiRemove:async()=>{},clear:async()=>{}};
Module._load = function(request,parent,isMain){
  if(request==='@react-native-async-storage/async-storage'){try{return originalLoad.call(this,request,parent,isMain);}catch{return {default:memStore,...memStore};}}
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
after(()=>{Module._load=originalLoad;if(previousTs)require.extensions['.ts']=previousTs;else delete require.extensions['.ts'];});
function setup({tracks=[],cached=null}={}){
  memory={};calls=[];probe=cached;shakas=[];mp4s=[];mkvs=[];toasts=[];release=null;mkvTracks=[{lang:'spa',codec:'A_AAC'},{lang:'eng',codec:'A_AAC'}];
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
// ---------- LG webOS: el reproductor del televisor primero, el servidor al final ----------
const tvVideo=(video,ok)=>{const sel=[];video.nativeFiles=true;video.tvSelectTrack=async(type,i)=>{sel.push([type,i]);return ok;};video.tvSubtitleOff=async()=>true;return sel;};
test('LG: el MKV lo abre el televisor y el idioma cambia con su servicio de medios, sin servidor',async()=>{
  const {c,video}=setup({cached:dual});const sel=tvVideo(video,true);
  c.load('https://fixture.invalid/video.mkv',0,false);await tick();
  assert.equal(mkvs.length,0);assert.equal(video.src,'https://fixture.invalid/video.mkv');
  choose(c,'Inglés');await tick();await tick();
  assert.deepEqual(sel,[['audio',1]]);assert.deepEqual(calls,[]);assert.ok(c.menu().find(m=>m.kind==='audio'&&m.label.includes('Inglés')).on);await c.destroy();
});
test('LG: si el televisor no cambia el idioma, lo cambia el lector de la app (sin servidor)',async()=>{
  const {c,video}=setup({cached:dual});tvVideo(video,false);
  c.load('https://fixture.invalid/video.mkv',0,false);await tick();video.currentTime=300;
  choose(c,'Inglés');await tick();await tick();await tick();
  assert.equal(mkvs.length,1);assert.equal(mkvs[0].audioIdx,1);assert.equal(video.currentTime,300);assert.deepEqual(calls,[]);await c.destroy();
});
test('LG: los canales HLS los abre el televisor (no el lector de Vega)',async()=>{
  const {c,video}=setup();tvVideo(video,true);c.load('https://fixture.invalid/canal.m3u8',0,true);assert.equal(video.src,'https://fixture.invalid/canal.m3u8');await c.destroy();
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
// Shaka solo va en Vega (en LG no se instala: tools/build-webos.js lo deja fuera)
let hasShaka=true;try{require.resolve('@xmldom/xmldom');}catch{hasShaka=false;}
test('Shaka 4.16: audios sin id mantienen identidad distinta y seleccionan el idioma correcto',{skip:!hasShaka&&'Shaka solo en Vega'},()=>{
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
