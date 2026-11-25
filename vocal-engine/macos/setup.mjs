import {mkdir,cp,writeFile,stat,mkdtemp,rename,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {homedir,tmpdir,arch,platform,totalmem} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
const src=process.argv[2],home=homedir(),root=path.join(home,'Library/Application Support/J-WOO Vocal Engine'),data=path.join(root,'Data');
const origin='https://j-woo.production-cew.com',site=origin+'/';
if(platform()!=='darwin'||!['arm64','x64'].includes(arch())||!src)throw Error('지원하지 않는 시스템');
if(totalmem()<4*1024**3)throw Error('메모리 4GB 미만은 지원하지 않습니다.');
let nativeArm=false;try{nativeArm=execFileSync('/usr/sbin/sysctl',['-n','hw.optional.arm64'],{encoding:'utf8'}).trim()==='1';}catch{}
if((nativeArm&&arch()!=='arm64')||(!nativeArm&&arch()!=='x64'))throw Error('Mac 프로세서에 맞는 설치 이미지를 사용하세요.');
const version=execFileSync('/usr/bin/sw_vers',['-productVersion'],{encoding:'utf8'}).trim();
if(Number(version.split('.')[0])<12)throw Error('macOS 12 이상 필요 (실제 런타임 호환성 별도 확인).');
await mkdir(root,{recursive:true,mode:0o700});
const free=execFileSync('/bin/df',['-k',root],{encoding:'utf8'}).trim().split('\n').at(-1).split(/\s+/);
if(Number(free[3])*1024<8*1024**3)throw Error('최소 8GB 여유 공간이 필요합니다.');
try{await stat(path.join(root,'installed.json'));throw Error('기존 설치 발견: 자동 덮어쓰지 않습니다.');}catch(e){if(e.code!=='ENOENT')throw e;}
const final=path.join(root,'v1'),label='com.jwoo.vocal-engine';
const agentDir=path.join(home,'Library/LaunchAgents'),agent=path.join(agentDir,label+'.plist');
for(const p of [final,agent]){try{await stat(p);throw Error('기존 파일이 있어 설치 중단: '+p);}catch(e){if(e.code!=='ENOENT')throw e;}}
let installedDir=false,agentCreated=false,agentLoaded=false,markerCreated=false;
const staging=await mkdtemp(path.join(root,'install-')),download=path.join(staging,'Chiaki.zip'),engineData=path.join(staging,'Data');
try{
 for(const x of ['engine','runtime','src','licenses','vocal-engine','package.json','voice-import.mjs','Add-Voice.command'])await cp(path.join(src,x),path.join(staging,x),{recursive:true,errorOnExist:true,force:false});
 const url='https://github.com/chiakich/OpenUtau-chiaki/releases/download/voicebank-v7/Chiaki.zip';
 const res=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(900000)});
 if(!res.ok||!res.body||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(new URL(res.url).hostname))throw Error('공식 모델 다운로드 실패');
 let count=0;const hash=createHash('sha256');
 const meter=new Transform({transform(c,_,cb){count+=c.length;if(count>451333586)return cb(Error('모델 크기 불일치'));hash.update(c);cb(null,c);}});
 await pipeline(Readable.fromWeb(res.body),meter,createWriteStream(download,{flags:'wx',mode:0o600}));
 if(count!==451333586||hash.digest('hex')!=='20bdc0c4a70580be3697013be54ad895c2e115cc8dea0e924d441d2fa97a8424')throw Error('모델 SHA-256 검증 실패');
 const renderer=path.join(staging,'engine/JwooRender'),env={...process.env,JWOO_ENGINE_DATA:engineData};
 execFileSync(renderer,['install-chiaki',download],{env,timeout:180000,stdio:'inherit'});
 const voices=JSON.parse(execFileSync(renderer,['list'],{env,timeout:120000,encoding:'utf8',maxBuffer:1024*1024}));
 const m=voices.find(v=>/chiaki/i.test(v.name));if(!m)throw Error('Chiaki 모델 등록 확인 실패');
 const config={voices:[{id:m.id,label:m.name,gender:'여성',credit:'Chiaki',termsUrl:'https://chiaki.ch/en/character/chiaki',korean:true,usageAccepted:true,expressions:['tenc','brec','pexp','vibrato']}]};
 await writeFile(path.join(staging,'models.local.json'),JSON.stringify(config,null,2),{mode:0o600});
 await rm(download);
 await rename(staging,final);installedDir=true;
 const key=randomBytes(32).toString('hex');
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const args=[path.join(final,'runtime/node'),path.join(final,'vocal-engine/server.mjs')];
 const vars={JWOO_VOCAL_KEY:key,JWOO_ORIGIN:origin,JWOO_MODELS:path.join(final,'models.local.json'),JWOO_RENDERER:path.join(final,'engine/JwooRender'),JWOO_ENGINE_DATA:path.join(final,'Data'),JWOO_PAIRING:'1'};
 const plist='<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>'+label+'</string><key>ProgramArguments</key><array>'+args.map(v=>'<string>'+esc(v)+'</string>').join('')+'</array><key>EnvironmentVariables</key><dict>'+Object.entries(vars).map(([k,v])=>'<key>'+esc(k)+'</key><string>'+esc(v)+'</string>').join('')+'</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>WorkingDirectory</key><string>'+esc(final)+'</string></dict></plist>';
 await mkdir(agentDir,{recursive:true});await writeFile(agent,plist,{flag:'wx',mode:0o600});agentCreated=true;
 execFileSync('/usr/bin/plutil',['-lint',agent],{stdio:'inherit'});
 execFileSync('/bin/launchctl',['bootstrap','gui/'+process.getuid(),agent],{stdio:'inherit'});agentLoaded=true;
 await writeFile(path.join(root,'installed.json'),JSON.stringify({version:1,arch:arch(),agent,label,site}),{flag:'wx',mode:0o600});markerCreated=true;
 try{execFileSync('/usr/bin/open',[site]);}catch{console.log('브라우저에서 '+site+' 를 열어 주세요.');}
 console.log('설치 및 로그인 항목 등록 완료. 웹사이트에서 연결 승인을 진행하세요.');
}catch(e){console.error('설치 중단:',e.message);if(agentLoaded){try{execFileSync('/bin/launchctl',['bootout','gui/'+process.getuid(),agent]);}catch{console.error('자동 등록 해제 실패: 기존 설치 파일을 보존합니다.');throw e;}}if(markerCreated)await rm(path.join(root,'installed.json'));if(agentCreated)await rm(agent);if(installedDir)await rm(final,{recursive:true});else await rm(staging,{recursive:true});throw e;}
