// Loopback-only adapter to a separately installed OpenUtau HTTP API.
// Never serves models, local files or arbitrary proxy paths.
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildUstx,validatePlan,secondsAt} from '../src/vocal-core.js';
const key=process.env.JWOO_VOCAL_KEY||'',backendKey=process.env.OPENUTAU_API_KEY||'';
const origin=process.env.JWOO_ORIGIN||'';
const renderer=process.env.JWOO_RENDERER||'', pairing=process.env.JWOO_PAIRING==='1';
const run=promisify(execFile);
const backend=new URL(process.env.OPENUTAU_URL||'http://127.0.0.1:19471');
if(key.length<24||(!renderer&&!backendKey)||!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)&&!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||backend.protocol!=='http:'||backend.hostname!=='127.0.0.1'||backend.port==='19470'||backend.pathname!=='/'||backend.username||backend.password||backend.search||backend.hash)throw Error('Configure JWOO_VOCAL_KEY (24+ chars), JWOO_ORIGIN, OPENUTAU_API_KEY and a separate loopback OPENUTAU_URL.');
const config=JSON.parse(await readFile(process.env.JWOO_MODELS||'vocal-engine/models.local.json','utf8'));
const allowed=new Map();
for(const m of config.voices||[]){
 if(typeof m.id!=='string'||!m.id||allowed.has(m.id)||!['남성','여성','기타'].includes(m.gender)||typeof m.label!=='string'||typeof m.credit!=='string'||!/^https:\/\//.test(m.termsUrl)||m.korean!==true||m.usageAccepted!==true||!Array.isArray(m.expressions)||m.expressions.some(x=>!['tenc','brec','pexp','vibrato'].includes(x)))throw Error('Invalid or unapproved model configuration');
 allowed.set(m.id,{id:m.id,label:m.label,gender:m.gender,credit:m.credit,termsUrl:m.termsUrl,expressions:m.expressions});
}
let rendering=false;
const auth=(value)=>{const a=Buffer.from(value||''),b=Buffer.from('Bearer '+key);return a.length===b.length&&timingSafeEqual(a,b);};
const upstream=(path,options={})=>fetch(new URL(path,backend),{...options,headers:{'X-Api-Key':backendKey,...options.headers},redirect:'error',signal:AbortSignal.timeout(path.includes('render')?570000:8000)});
let voiceDiscovery=null;
async function voices(){if(renderer){if(!voiceDiscovery)voiceDiscovery=run(renderer,['list'],{timeout:120000,maxBuffer:1024*1024}).then(r=>{const singers=JSON.parse(r.stdout);return singers.filter(s=>s.singerType==='DiffSinger'&&allowed.has(s.id)).map(s=>allowed.get(s.id));}).catch(e=>{voiceDiscovery=null;throw e;});return voiceDiscovery;}const [s,p]=await Promise.all([upstream('/api/singers'),upstream('/api/phonemizers')]);if(!s.ok||!p.ok)throw Error('Engine discovery failed');
 const singers=await s.json(),phonemizers=await p.json();if(!Array.isArray(singers)||!Array.isArray(phonemizers)||!phonemizers.some(x=>x.type==='OpenUtau.Core.DiffSinger.DiffSingerKoreanPhonemizer'))throw Error('Korean phonemizer unavailable');
 return singers.filter(s=>String(s.singerType).toLowerCase()==='diffsinger'&&allowed.has(s.id)).map(s=>allowed.get(s.id));}
async function body(req){let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>2*1024*1024)throw Error('Request too large');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
async function boundedWav(response,plan){if(!response.ok)throw Error('OpenUtau render failed');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>160*1024*1024)throw Error('WAV too large');chunks.push(Buffer.from(chunk));}const b=Buffer.concat(chunks);if(b.length<44||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw Error('Invalid WAV');
 // Parse chunks, reject silent output and gross timeline mismatch.
 let fmt=null,data=null;for(let i=12;i+8<=b.length;){const id=b.toString('ascii',i,i+4),len=b.readUInt32LE(i+4),start=i+8;if(start+len>b.length)throw Error('Truncated WAV');if(id==='fmt '&&len>=16)fmt={format:b.readUInt16LE(start),channels:b.readUInt16LE(start+2),rate:b.readUInt32LE(start+4),align:b.readUInt16LE(start+12),bits:b.readUInt16LE(start+14)};if(id==='data')data=b.subarray(start,start+len);i=start+len+(len%2);}
 if(!fmt||!data||!fmt.align||!fmt.rate||!data.length||data.length%fmt.align)throw Error('Missing WAV data');
 if(!data.some(x=>x!==0))throw Error('Silent WAV');
 const duration=data.length/fmt.align/fmt.rate,last=plan.notes.at(-1),expected=secondsAt(plan,last.position+last.duration);
 if(duration<expected-0.5||duration>secondsAt(plan,plan.duration)+10)throw Error('Unexpected audio duration');
 // Preserve the original timeline through trailing silence if needed; PCM/float only, never trim audio.
 const full=secondsAt(plan,plan.duration);if(duration<full&&[1,3].includes(fmt.format)&&fmt.bits>=16){
  const frames=Math.ceil(full*fmt.rate),target=frames*fmt.align;
  if(target>160*1024*1024)throw Error('Audio too large');
  const out=Buffer.alloc(44+target);out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(fmt.format,20);out.writeUInt16LE(fmt.channels,22);out.writeUInt32LE(fmt.rate,24);out.writeUInt32LE(fmt.rate*fmt.align,28);out.writeUInt16LE(fmt.align,32);out.writeUInt16LE(fmt.bits,34);out.write('data',36);out.writeUInt32LE(target,40);data.copy(out,44);return out;
 }return b;}
let pairBusy=false,lastPair=0;
async function renderNative(ustx,plan){
 const dir=await mkdtemp(path.join(tmpdir(),'jwoo-vocal-'));try{
 const input=path.join(dir,'guide.ustx'),output=path.join(dir,'guide.wav');
 await writeFile(input,ustx,{mode:0o600,flag:'wx'});
 await run(renderer,['render',input,output],{timeout:550000,maxBuffer:1024*1024});
 const size=(await stat(output)).size;if(size>160*1024*1024||size<44)throw Error('Invalid output length');
 return await boundedWav(new Response(await readFile(output)),plan);
 }finally{await rm(dir,{recursive:true,force:true});}
}
const server=http.createServer(async(req,res)=>{
 const json=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
 if(req.headers.host!=='127.0.0.1:19470'||req.headers.origin!==origin){json(403,{error:'Origin denied'});return;}
 res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Cache-Control','no-store');
 if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);res.end();return;}
 if(req.method==='GET'&&req.url==='/health'){json(200,{engine:'jwoo-vocal',version:1,pairing});return;}
 if(req.method==='POST'&&req.url==='/pair'&&pairing){
  if(pairBusy||Date.now()-lastPair<15000){json(429,{error:'Pairing busy'});return;}
  pairBusy=true;lastPair=Date.now();
  try{await run('/usr/bin/osascript',['-e','display dialog "J-WOO 웹사이트가 이 Mac의 보컬 엔진에 연결하려고 합니다. 이 연결을 승인할까요?" buttons {"거부", "연결 승인"} default button "연결 승인" cancel button "거부"'],{timeout:60000});json(200,{key});}catch{json(403,{error:'Pairing denied'});}finally{pairBusy=false;}return;
 }
 if(!auth(req.headers.authorization)){json(401,{error:'Unauthorized'});return;}
 try{
 if(req.method==='GET'&&req.url==='/voices'){json(200,{voices:await voices()});return;}
 if(req.method==='POST'&&req.url==='/render'){
  if(rendering){json(409,{error:'Already rendering'});return;}
  rendering=true;
  try{const x=await body(req);validatePlan(x.plan);const model=(await voices()).find(v=>v.id===x.modelId);if(!model)throw Error('Model unavailable');const ustx=buildUstx(x.plan,model,x.style);const form=new FormData();form.append('file',new Blob([ustx],{type:'text/yaml'}),'jwoo.ustx');const wav=renderer?await renderNative(ustx,x.plan):await boundedWav(await upstream('/api/project/render?format=wav',{method:'POST',body:form}),x.plan);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':wav.length});res.end(wav);}
  finally{rendering=false;}return;
 }
 json(404,{error:'Not found'});
 }catch(e){console.error('Vocal engine:',e.message);if(!res.headersSent)json(422,{error:'Vocal engine request failed'});else res.end();}
});
server.requestTimeout=30000;server.headersTimeout=10000;server.listen(19470,'127.0.0.1',()=>console.log('J-WOO vocal bridge on loopback port 19470'));
