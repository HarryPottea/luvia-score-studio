// Local-only installer; cannot be triggered by a remote HTTP request.
import {readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {homedir,platform} from 'node:os';
import path from 'node:path';
const windows=platform()==='win32';
const beta=process.env.JWOO_BETA_PACKAGE;
if(beta&&(!windows||!path.isAbsolute(beta)||!process.env.LOCALAPPDATA))throw Error('Invalid Beta package');
const root=beta?path.join(process.env.LOCALAPPDATA,'J-WOO Vocal Beta'):windows?path.join(process.env.LOCALAPPDATA||'', 'J-WOO Vocal Engine'):path.join(homedir(),'Library/Application Support/J-WOO Vocal Engine');
const final=path.join(root,'v1'),data=path.join(final,'Data'),configPath=path.join(final,'models.local.json');
const [file,gender,credit,terms,consent]=process.argv.slice(2);
if(consent!=='I_HAVE_RIGHTS'||!['남성','여성'].includes(gender)||!file?.toLowerCase().endsWith('.zip')||!credit?.trim()||credit.length>150||!/^https:\/\/[^ ]+$/.test(terms||''))throw Error('공식 ZIP, 성별, 크레딧, 이용약관 URL 및 사용권 확인이 필요합니다.');
const config=JSON.parse(await readFile(configPath,'utf8'));
if(!Array.isArray(config.voices))throw Error('Invalid voice registry');
const renderer=path.join(beta||final,'engine',windows?'JwooRender.exe':'JwooRender'),env={...process.env,JWOO_ENGINE_DATA:data};
const list=()=>JSON.parse(execFileSync(renderer,['list'],{env,timeout:120000,encoding:'utf8',maxBuffer:1024*1024}));
const before=new Set(list().map(v=>v.id));
const st=await stat(file);if(!st.isFile()||st.size>2*1024**3)throw Error('ZIP 최대 2GB');
const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);const hash=h.digest('hex');
const bank=path.join(data,'Singers','bank-'+hash);
try{
 execFileSync(renderer,['install-voice',file,hash],{env,timeout:240000,stdio:'inherit'});
 const added=list().filter(v=>!before.has(v.id));
 if(added.length!==1)throw Error('단일 DiffSinger 보컬만 등록할 수 있습니다.');
 const m=added[0];
 // No unsupported expression advertising. Verified native/model expression capabilities required separately.
 config.voices.push({id:m.id,label:m.name,gender,credit:credit.trim(),termsUrl:terms,korean:true,usageAccepted:true,expressions:[],archiveSha256:hash,source:'USER_LICENSED_LOCAL'});
 const temp=configPath+'.new';
 await writeFile(temp,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
 await rename(temp,configPath);
 console.log('보컬 등록 완료: '+m.name+' ('+gender+'). 브라우저에서 엔진 재연결을 선택하세요.');
}catch(e){if(!before.has(hash))console.error('모델 등록 실패: '+e.message+' — 기존 등록 보컬은 변경하지 않습니다. 미등록 파일은 수동 검토 대상입니다.');throw e;}
