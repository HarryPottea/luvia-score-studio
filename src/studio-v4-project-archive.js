// Portable J-WOO score projects: user-controlled, local ZIP backups.
// Includes the complete MusicXML score and explicit named recovery snapshots.
// Every entry is SHA-256 verified before anything may be opened or imported.
// No remote access, no executable content, no implicit overwrite of local work.
import JSZip from 'jszip';
import {baseScoreName} from './part-export.js';

const FORMAT='J-WOO-PROJECT',VERSION=1;
const MAX_XML_BYTES=8*1024*1024,MAX_ARCHIVE_BYTES=48*1024*1024,
  MAX_UNPACKED_BYTES=40*1024*1024,MAX_VERSIONS=20;
const fail=message=>{throw new Error(message);};
const encode=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const validFilename=name=>typeof name==='string'&&name.trim().length>0&&
  name.trim().length<=180&&!/[\/\\\u0000-\u001f]/u.test(name);
const validLabel=value=>typeof value==='string'&&value.length<=80&&
  !/[\u0000-\u001f]/u.test(value);
function validXml(bytes){
  const xml=decoder.decode(bytes);
  if(!xml.includes('<score-partwise')||!xml.includes('</score-partwise>')||
     /<!DOCTYPE|<!ENTITY/i.test(xml))
    fail('프로젝트의 악보가 안전한 MusicXML partwise 문서가 아닙니다.');
  return xml;
}
function validName(name){
  if(!validFilename(name))fail('프로젝트 악보 파일 이름이 올바르지 않습니다.');
  return name.trim();
}
async function digest(bytes){
  if(!globalThis.crypto?.subtle)fail('SHA-256 검사에 필요한 보안 기능을 사용할 수 없습니다.');
  const d=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function checkManifest(manifest){
  if(!manifest||manifest.format!==FORMAT||manifest.version!==VERSION||
     !manifest.current||!Array.isArray(manifest.versions)||
     manifest.versions.length>MAX_VERSIONS)
    fail('지원하지 않는 프로젝트 백업 형식입니다.');
  const entries=[manifest.current,...manifest.versions];
  let total=0;
  for(const [i,item] of entries.entries()){
    const expected=i===0?'score.musicxml':
      'versions/'+String(i).padStart(4,'0')+'.musicxml';
    if(!item||item.path!==expected||!validFilename(item.filename)||
       typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)||
       !Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>MAX_XML_BYTES||
       (i>0&&!validLabel(item.label)))
      fail('프로젝트 백업의 파일 경로·크기·해시가 올바르지 않습니다.');
    total+=item.bytes;
  }
  if(total>MAX_UNPACKED_BYTES)fail('프로젝트 백업 용량이 허용 범위를 초과했습니다.');
  return entries;
}
export async function createPortableScoreProject({xml,filename,snapshots=[]}={}){
  if(!validFilename(filename)||typeof xml!=='string'||!Array.isArray(snapshots)||
     snapshots.length>MAX_VERSIONS)
    fail('프로젝트 이름 또는 버전 목록이 올바르지 않습니다.');
  const main=encode.encode(xml);
  if(main.byteLength>MAX_XML_BYTES)fail('프로젝트 악보는 8MiB 이하만 저장할 수 있습니다.');
  validXml(main);
  const zip=new JSZip(),manifest={format:FORMAT,version:VERSION,
    createdAt:new Date().toISOString(),current:null,versions:[]};
  zip.file('score.musicxml',main);
  manifest.current={path:'score.musicxml',filename:validName(filename),
    bytes:main.byteLength,sha256:await digest(main)};
  let total=main.byteLength;
  for(const [index,snapshot] of snapshots.entries()){
    if(!snapshot||typeof snapshot.xml!=='string'||!validFilename(snapshot.filename)||
       !validLabel(snapshot.label??''))
      fail('복원 시점의 파일 이름 또는 설명이 올바르지 않습니다.');
    const bytes=encode.encode(snapshot.xml);
    validXml(bytes);
    if(bytes.byteLength>MAX_XML_BYTES)fail('복원 시점이 개별 8MiB 제한을 넘었습니다.');
    total+=bytes.byteLength;
    if(total>MAX_UNPACKED_BYTES)fail('프로젝트 복원 시점의 총용량이 너무 큽니다.');
    const path='versions/'+String(index+1).padStart(4,'0')+'.musicxml';
    zip.file(path,bytes);
    manifest.versions.push({path,filename:validName(snapshot.filename),
      label:snapshot.label??'',bytes:bytes.byteLength,sha256:await digest(bytes)});
  }
  checkManifest(manifest);
  zip.file('manifest.json',JSON.stringify(manifest,null,2));
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',
    compressionOptions:{level:5}});
  if(blob.size>MAX_ARCHIVE_BYTES)fail('프로젝트 ZIP이 48MiB를 초과했습니다.');
  return {blob,filename:baseScoreName(filename)+'.jwoo',snapshots:manifest.versions.length,
    currentSha256:manifest.current.sha256,bytes:blob.size};
}
export async function readPortableScoreProject(file){
  if(!file||typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||
     file.size<100||file.size>MAX_ARCHIVE_BYTES)
    fail('프로젝트 백업 파일 크기 또는 형식을 확인할 수 없습니다.');
  let zip;
  try{zip=await JSZip.loadAsync(await file.arrayBuffer(),{checkCRC32:false});}
  catch{fail('프로젝트 ZIP이 손상됐거나 읽을 수 없습니다.');}
  // JSZip's checkCRC32:true decompresses all entries before we can inspect
  // limits. Verify compressed entry metadata first; subsequent SHA-256 checks
  // also provide stronger content integrity than CRC32.
  let expectedTotal=0;
  for(const entry of Object.values(zip.files)){
    if(entry.dir)continue;
    const size=entry._data?.uncompressedSize;
    if(!Number.isSafeInteger(size)||size<0||size>MAX_XML_BYTES||
       entry.name==='manifest.json'&&size>65536)
      fail('프로젝트 ZIP에 과도하거나 확인 불가능한 압축 해제 크기가 있습니다.');
    expectedTotal+=size;
    if(expectedTotal>MAX_UNPACKED_BYTES+65536)
      fail('프로젝트 ZIP의 총 압축 해제 크기가 허용 범위를 초과했습니다.');
  }
  const manifestFile=zip.file('manifest.json');
  if(!manifestFile)fail('프로젝트 백업의 manifest.json이 없습니다.');
  const json=await manifestFile.async('uint8array');
  if(json.byteLength>65536)fail('프로젝트 정보 파일이 너무 큽니다.');
  let manifest;
  try{manifest=JSON.parse(decoder.decode(json));}
  catch{fail('프로젝트 정보 JSON을 해석할 수 없습니다.');}
  const entries=checkManifest(manifest);
  const actual=Object.values(zip.files).filter(item=>!item.dir).map(item=>item.name).sort();
  const expected=['manifest.json',...entries.map(x=>x.path)].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    fail('프로젝트 ZIP에 예상하지 않은 파일이나 누락된 파일이 있습니다.');
  const versions=[];
  for(const [i,item] of entries.entries()){
    const fileEntry=zip.file(item.path);
    if(!fileEntry)fail('프로젝트 파일이 누락됐습니다.');
    const bytes=await fileEntry.async('uint8array');
    if(bytes.byteLength!==item.bytes||await digest(bytes)!==item.sha256)
      fail('프로젝트 파일의 크기 또는 SHA-256 무결성 검사가 실패했습니다.');
    const decoded=validXml(bytes);
    if(i===0){
      manifest.current.xml=decoded;
    }else versions.push({xml:decoded,filename:item.filename,label:item.label,
      sha256:item.sha256});
  }
  return {xml:manifest.current.xml,filename:manifest.current.filename,
    sha256:manifest.current.sha256,snapshots:versions,version:manifest.version};
}
