import {mkdir,cp,writeFile,stat,mkdtemp,rename,rm,statfs} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {arch,platform,totalmem,release} from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
const src=process.argv[2],root=path.join(process.env.LOCALAPPDATA||'', 'J-WOO Vocal Engine');
const origin='https://harrypottea.github.io',site=origin+'/luvia-score-studio/';
if(platform()!=='win32'||arch()!=='x64'||!src||!process.env.LOCALAPPDATA||!process.env.APPDATA||Number(release().split('.')[0])<10)throw Error('Windows 10/11 x64 필요');
if(totalmem()<4*1024**3)throw Error('메모리 4GB 이상 필요');
await mkdir(root,{recursive:true});const f=await statfs(root);if(f.bavail*f.bsize<8*1024**3)throw Error('8GB 여유 공간 필요');
const final=path.join(root,'v1'),marker=path.join(root,'installed.json'),startup=path.join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs/Startup/J-WOO Vocal Engine.vbs');
for(const p of [final,marker,startup]){try{await stat(p);throw Error('기존 설치 발견: '+p);}catch(e){if(e.code!=='ENOENT')throw e;}}
const staging=await mkdtemp(path.join(root,'install-'));let moved=false,registered=false,marked=false,child=null;
try{
 for(const x of ['engine','runtime','src','licenses','vocal-engine','package.json','voice-import.mjs','Add-Voice.ps1','Add-Voice.cmd'])await cp(path.join(src,x),path.join(staging,x),{recursive:true,errorOnExist:true,force:false});
 const zip=path.join(staging,'Chiaki.zip'),r=await fetch('https://github.com/chiakich/OpenUtau-chiaki/releases/download/voicebank-v7/Chiaki.zip',{redirect:'follow',signal:AbortSignal.timeout(900000)});
 if(!r.ok||!r.body||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(new URL(r.url).hostname))throw Error('모델 다운로드 실패');
 let n=0;const h=createHash('sha256');await pipeline(Readable.fromWeb(r.body),new Transform({transform(c,_,cb){n+=c.length;if(n>451333586)return cb(Error('크기 오류'));h.update(c);cb(null,c);}}),createWriteStream(zip,{flags:'wx'}));
 if(n!==451333586||h.digest('hex')!=='20bdc0c4a70580be3697013be54ad895c2e115cc8dea0e924d441d2fa97a8424')throw Error('모델 SHA-256 오류');
 const renderer=path.join(staging,'engine/JwooRender.exe'),env={...process.env,JWOO_ENGINE_DATA:path.join(staging,'Data')};
 execFileSync(renderer,['install-chiaki',zip],{env,timeout:180000,stdio:'inherit'});
 const voices=JSON.parse(execFileSync(renderer,['list'],{env,timeout:120000,encoding:'utf8'}));const m=voices.find(x=>/chiaki/i.test(x.name));if(!m)throw Error('모델 등록 실패');
 await writeFile(path.join(staging,'models.local.json'),JSON.stringify({voices:[{id:m.id,label:m.name,gender:'여성',credit:'Chiaki',termsUrl:'https://chiaki.ch/en/character/chiaki',korean:true,usageAccepted:true,expressions:['tenc','brec','pexp','vibrato']}]}),{flag:'wx'});await rm(zip);
 const settings={JWOO_VOCAL_KEY:randomBytes(32).toString('hex'),JWOO_ORIGIN:origin,JWOO_MODELS:path.join(final,'models.local.json'),JWOO_RENDERER:path.join(final,'engine/JwooRender.exe'),JWOO_ENGINE_DATA:path.join(final,'Data'),JWOO_PAIRING:'1'};
 await writeFile(path.join(staging,'start.mjs'),'import {readFile} from "node:fs/promises";\nObject.assign(process.env,JSON.parse(await readFile(new URL("./settings.json",import.meta.url),"utf8")));\nawait import("./vocal-engine/server.mjs");\n',{flag:'wx'});
 await writeFile(path.join(staging,'settings.json'),JSON.stringify(settings),{flag:'wx'});
 await rename(staging,final);moved=true;
 const q=s=>'"'+String(s).replaceAll('"','""')+'"';
 const node=path.join(final,'runtime/node.exe'),script=path.join(final,'start.mjs');
 const vbs='Set shell = CreateObject("WScript.Shell")\r\nshell.Run Chr(34) & '+q(node)+' & Chr(34) & " " & Chr(34) & '+q(script)+' & Chr(34), 0, False\r\n';
 await writeFile(startup,Buffer.concat([Buffer.from([255,254]),Buffer.from(vbs,'utf16le')]),{flag:'wx'});
 registered=true;
 child=spawn(node,[script],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();
 // Authenticated origin-bound health check verifies that the service is live.
 let ok=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));try{const x=await fetch('http://127.0.0.1:19470/health',{headers:{Origin:origin},signal:AbortSignal.timeout(1000)});const j=await x.json();if(x.ok&&j.engine==='jwoo-vocal'){ok=true;break;}}catch{}}
 if(!ok)throw Error('로컬 엔진 기동 실패');
 await writeFile(marker,JSON.stringify({version:1,arch:arch(),site,startup}),{flag:'wx'});marked=true;
 console.log('설치 완료. 사이트에서 최초 연결 승인 및 남성 모델 등록을 진행하세요.');
}catch(e){if(child)try{child.kill();}catch{}if(registered)await rm(startup);if(marked)await rm(marker);if(moved)await rm(final,{recursive:true});else await rm(staging,{recursive:true});throw e;}
