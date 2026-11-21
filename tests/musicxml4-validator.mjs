// Independent W3C MusicXML 4.0 schema validation CLI bridge.
// Uses the unmodified, hash-pinned, locally vendored official XSDs. Only
// schemaLocation links are rewritten in a temporary *copy* to prevent
// external network access. Java's JAXP implements XSD verification.
import {readFile,mkdir,writeFile,copyFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

const root=resolve('.');
const manifestFile=join(root,'tests/musicxml-4-pinned-corpus.json');
const sourceRoot=join(root,'tests/musicxml4-official');
const javaSource=join(root,'scripts/MusicXmlSchemaValidator.java');
const fail=m=>{throw new Error(m);};

const blobHash=bytes=>createHash('sha1')
  .update(Buffer.from('blob '+bytes.length+'\0','utf8'))
  .update(bytes).digest('hex');

export async function verifyOfficialMusicXml4Fixtures(){
  const pin=JSON.parse(await readFile(manifestFile,'utf8'));
  const verified=[];
  for(const [category,folder] of [['schema','schema'],['corpus','corpus']]){
    const filenames=Object.entries(pin[category].files);
    if(category==='schema'&&filenames.length!==3||
       category==='corpus'&&filenames.length!==10)
      fail('W3C MusicXML 4.0 schema/corpus fixture count changed');
    for(const [file,sha] of filenames){
      if(!/^[\w.-]+$/.test(file)||!/^[a-f0-9]{40}$/.test(sha))
        fail('Invalid pinned MusicXML4 fixture path or digest');
      const data=await readFile(join(sourceRoot,folder,file));
      if(data.length<1||data.length>8*1024*1024||blobHash(data)!==sha)
        fail('W3C MusicXML4 pinned-source hash mismatch: '+file);
      verified.push(file);
    }
  }
  return {manifest:pin,verified};
}
export async function validateMusicXml4Files(files,{expectAtLeast=1}={}){
  if(!Array.isArray(files)||files.length<expectAtLeast||files.length>240)
    fail('No independent MusicXML 4.0 validation inputs');
  const {verified}=await verifyOfficialMusicXml4Fixtures();
  const tmp=await mkdtemp(join(tmpdir(),'jwoo-musicxml4-'));
  try{
    const schemaDir=join(tmp,'schema');
    await mkdir(schemaDir,{recursive:true});
    const source=join(sourceRoot,'schema');
    const xml=await readFile(join(source,'musicxml.xsd'),'utf8');
    const patterns=[
      ['http://www.musicxml.org/xsd/xml.xsd','xml.xsd'],
      ['http://www.musicxml.org/xsd/xlink.xsd','xlink.xsd'],
    ];
    let patched=xml;
    for(const [from,to] of patterns){
      if(!patched.includes(from))fail('W3C 4.0 schema import has changed');
      patched=patched.replaceAll(from,to);
    }
    await writeFile(join(schemaDir,'musicxml.xsd'),patched);
    for(const filename of ['xml.xsd','xlink.xsd'])
      await copyFile(join(source,filename),join(schemaDir,filename));
    const java=spawnSync('java',['--version'],{encoding:'utf8',timeout:10000});
    if(java.error||java.status!==0)
      fail('Independent XSD validator requires a Java 17+ runtime');
    const validation=spawnSync('java',[javaSource,join(schemaDir,'musicxml.xsd'),
      ...files.map(file=>resolve(file))],{
      encoding:'utf8',timeout:120000,maxBuffer:1024*1024,env:{...process.env,
        JAVA_TOOL_OPTIONS:'-Djavax.xml.accessExternalDTD= -Djavax.xml.accessExternalSchema=file'}
    });
    if(validation.error||validation.status!==0)
      fail('Independent MusicXML XSD failed: '+
        String(validation.stderr||validation.error||validation.stdout).slice(-2600));
    if(!/MUSICXML_4_XSD=PASS cases=\d+ negatives=2 internet=disabled/.test(validation.stdout))
      fail('Independent XMLSchema verdict missing');
    return {status:'PASS_MUSICXML4_INDEPENDENT_XSD',files:files.length,
      fixtureHashes:verified.length,output:validation.stdout.trim()};
  }finally{
    await rm(tmp,{recursive:true,force:true});
  }
}
export async function verifyW3cCorpusSchema(){
  const {manifest}=await verifyOfficialMusicXml4Fixtures();
  const names=Object.keys(manifest.corpus.files);
  const local=manifest.local.map(p=>join(root,p));
  return await validateMusicXml4Files(
    [...names.map(name=>join(sourceRoot,'corpus',name)),...local],
    {expectAtLeast:names.length+local.length});
}
