// Local Windows Beta, no login item, no cloud uploads, no changes to installed production engine.
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,stat,rename,mkdtemp,rm,realpath,statfs} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {arch,totalmem,release} from 'node:os';
const here=path.dirname(fileURLToPath(import.meta.url));
const betaOrigin='http://127.0.0.1:19472',engineOrigin='http://127.0.0.1:19473';
const mode=process.argv[2]||'';
if(process.platform!=='win32'||arch()!=='x64'||!process.env.LOCALAPPDATA||Number(release().split('.')[0])<10)throw Error('Windows 10/11 x64 required.');
if(totalmem()<4*1024**3)throw Error('Minimum 4 GB RAM required.');
const smoke=mode==='--smoke';
const root=smoke?await mkdtemp(path.join(process.env.TEMP||here,'jwoo-beta-smoke-')):path.join(process.env.LOCALAPPDATA,'J-WOO Vocal Beta');
const final=path.join(root,'v1'),data=path.join(final,'Data'),registry=path.join(final,'models.local.json'),renderer=path.join(here,'engine','JwooRender.exe');
await mkdir(data,{recursive:true});
try{await writeFile(registry,'{"voices":[]}',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
const dist=await realpath(path.join(here,'site'));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.jpg':'image/jpeg','.woff2':'font/woff2','.woff':'font/woff','.wasm':'application/wasm','.xml':'application/xml','.musicxml':'application/xml','.txt':'text/plain; charset=utf-8'};
const site=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!=='127.0.0.1:19472'||!['GET','HEAD'].includes(req.method)){res.writeHead(403);res.end();return;}
  let name=decodeURIComponent(new URL(req.url,betaOrigin).pathname);
  if(name==='/')name='/index.html';
  if(name.includes('\\')||name.includes('\0')||name.split('/').some(s=>s==='..'||s==='.'))throw Error('Bad path');
  const p=await realpath(path.resolve(dist,'.'+name));
  if(!p.toLowerCase().startsWith((dist+path.sep).toLowerCase()))throw Error('Bad path');
  const s=await stat(p);if(!s.isFile())throw Error('Not a file');
  res.writeHead(200,{'Content-Type':types[path.extname(p).toLowerCase()]||'application/octet-stream','Content-Length':s.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  if(req.method==='HEAD')res.end();else createReadStream(p).pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{site.once('error',reject);site.listen(19472,'127.0.0.1',resolve);});
const key=randomBytes(32).toString('hex');
const env={...process.env,JWOO_ENGINE_DATA:data};
const list=()=>JSON.parse(execFileSync(renderer,['list'],{env,timeout:120000,encoding:'utf8',maxBuffer:1024*1024}));
const openBrowser=url=>{const cmd='Start-Process "'+url.replaceAll('"','')+'"';spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',cmd],{windowsHide:true,stdio:'ignore'}).on('error',()=>{});};
async function ask(question){const rl=createInterface({input:process.stdin,output:process.stdout});try{return (await rl.question(question)).trim();}finally{rl.close();}}
async function installFemale(){
 const c=JSON.parse(await readFile(registry,'utf8'));
 if(c.voices.some(v=>v.credit==='Chiaki'))return;
 openBrowser('https://chiaki.ch/en/character/chiaki');
 console.log('Chiaki voice (~451 MB): review the official terms and include Vocal: Chiaki credit. No voice model is bundled.');
 if((await ask('Accept the terms for your intended use and download the official model? [y/N] ')).toLowerCase()!=='y')return;
 const free=await statfs(root);if(free.bavail*free.bsize<4*1024**3)throw Error('4 GB free space required for model setup.');
 const staging=await mkdtemp(path.join(root,'download-')),zip=path.join(staging,'Chiaki.zip'),sha='20bdc0c4a70580be3697013be54ad895c2e115cc8dea0e924d441d2fa97a8424';
 try{
  const r=await fetch('https://github.com/chiakich/OpenUtau-chiaki/releases/download/voicebank-v7/Chiaki.zip',{redirect:'follow',signal:AbortSignal.timeout(900000)});
  if(!r.ok||!r.body||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(new URL(r.url).hostname))throw Error('Official download failed.');
  let n=0;const hash=createHash('sha256');
  await pipeline(Readable.fromWeb(r.body),new Transform({transform(chunk,_,cb){n+=chunk.length;if(n>451333586)return cb(Error('Model size mismatch'));hash.update(chunk);cb(null,chunk);}}),createWriteStream(zip,{flags:'wx'}));
  if(n!==451333586||hash.digest('hex')!==sha)throw Error('Model SHA256 mismatch.');
  const before=new Set(list().map(v=>v.id));
  execFileSync(renderer,['install-voice',zip,sha],{env,timeout:240000,stdio:'inherit'});
  const matches=list().filter(v=>!before.has(v.id)&&/chiaki/i.test(v.name));
  if(matches.length!==1)throw Error('Chiaki discovery failed; no model was registered.');
  const m=matches[0];
  c.voices.push({id:m.id,label:m.name,gender:'여성',credit:'Chiaki',termsUrl:'https://chiaki.ch/en/character/chiaki',korean:true,usageAccepted:true,expressions:['tenc','brec','pexp','vibrato']});
  const tmp=registry+'.new';await writeFile(tmp,JSON.stringify(c,null,2),{flag:'wx'});await rename(tmp,registry);
 }finally{await rm(staging,{recursive:true,force:true});}
}
try{
 if(mode==='--add-voice'){
  console.log('Close all other Beta sessions. Only official, appropriately licensed Korean DiffSinger ZIP files.');
  const file=(await ask('Official ZIP path: ')).replace(/^"|"$/g,'');
  const gender=(await ask('Voice gender (M/F): ')).toUpperCase();
  const credit=await ask('Official voice credit: '),terms=await ask('Official HTTPS terms URL: ');
  if(!['M','F'].includes(gender)||!/^https:\/\/[^ ]+$/.test(terms))throw Error('Invalid model information.');
  if((await ask('Confirm independent voice, Korean support, and rights for intended commercial/religious use where applicable? [y/N] ')).toLowerCase()!=='y')throw Error('Not approved.');
  execFileSync(process.execPath,[path.join(here,'voice-import.mjs'),file,gender==='M'?'남성':'여성',credit,terms,'I_HAVE_RIGHTS'],{env:{...process.env,JWOO_BETA_PACKAGE:here},timeout:500000,stdio:'inherit'});
  site.close();process.exit(0);
 }
 if(!smoke)await installFemale();
 Object.assign(process.env,{JWOO_PORT:'19473',JWOO_VOCAL_KEY:key,JWOO_ORIGIN:betaOrigin,JWOO_MODELS:registry,JWOO_RENDERER:renderer,JWOO_ENGINE_DATA:data,JWOO_PAIRING:'1'});
 await import('./vocal-engine/server.mjs');
 let ready=false;for(let i=0;i<30;i++){try{const r=await fetch(engineOrigin+'/health',{headers:{Origin:betaOrigin},signal:AbortSignal.timeout(1000)});const a=await r.json();if(r.ok&&a.engine==='jwoo-vocal'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 if(!ready)throw Error('Beta engine startup failed.');
 if(smoke){
  const page=await fetch(betaOrigin+'/'),body=await page.text();
  if(!page.ok||!body.includes('JaeWoo Score Studio'))throw Error('Beta page unavailable');
  const r=await fetch(engineOrigin+'/voices',{headers:{Origin:betaOrigin,Authorization:'Bearer '+key},signal:AbortSignal.timeout(135000)});
  const a=await r.json();if(!r.ok||!Array.isArray(a.voices)||a.voices.length!==0)throw Error('Clean profile discovery failed');
  const denied=await fetch(engineOrigin+'/voices',{headers:{Origin:'https://untrusted.invalid',Authorization:'Bearer '+key}});
  if(denied.status!==403)throw Error('Origin isolation failed');
  const unauthorized=await fetch(engineOrigin+'/voices',{headers:{Origin:betaOrigin}});
  if(unauthorized.status!==401)throw Error('Authentication failed');
  console.log('PASS_BETA_LOCAL_SITE_AND_EMPTY_ENGINE; no singing model or audio render tested.');
  await rm(root,{recursive:true,force:true});process.exit(0);
 }
 console.log('J-WOO Beta: '+betaOrigin+' — keep this console open. Ctrl+C stops both local servers.');
 console.log('No files are sent to a cloud singing service. Experimental, unsigned package; trusted own scores only.');
 openBrowser(betaOrigin+'/');
}catch(e){console.error(e.message);site.close();process.exit(1);}
