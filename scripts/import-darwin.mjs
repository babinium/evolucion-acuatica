// Add an exported species-only book to the collection shipped in the repository.
// No provider, network, browser storage or configuration access.
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const input=process.argv.slice(2).find(a=>!a.startsWith('--'));
if(!input){console.error('Uso: node scripts/import-darwin.mjs libro-de-darwin.json [--check]');process.exit(1);}
const context=vm.createContext({Map,Set,Date,JSON});
vm.runInContext(fs.readFileSync(path.join(root,'darwin-core.js'),'utf8')+';globalThis.core=DarwinCore',context);
vm.runInContext(fs.readFileSync(path.join(root,'darwin-data.js'),'utf8')+';globalThis.included=DARWIN_STARTER',context);
const {core,included}=context;
try{
  const stat=fs.statSync(input);if(stat.size>32*1024*1024)throw new Error('El libro supera los 32 MB.');
  const {entries,artworks}=core.importData(JSON.parse(fs.readFileSync(input,'utf8')));
  const assets=new Map(artworks.map(a=>[a.key,a])),merged=new Map(included.map(e=>[e.bookKey,e]));
  const writes=[];let skipped=0;
  for(const entry of entries){
    if(entry.artworkSource==='procedural'){skipped++;continue;}
    if(entry.artworkSource!=='ai')throw new Error(`La ilustración de ${entry.name} no tiene origen verificado. Solo se incorporan especies con imagen de IA terminada.`);
    const art=assets.get(entry.artworkKey);
    if(!art)throw new Error(`Falta la ilustración de ${entry.name}.`);
    const urls={};
    for(const [field,size,label] of [['spriteUrl',192,'sprite'],['portraitUrl',384,'portrait']]){
      const value=art[field],bytes=value.startsWith('data:')?Buffer.from(value.split(',')[1],'base64'):fs.readFileSync(path.join(root,value));
      if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(16)!==size||bytes.readUInt32BE(20)!==size)throw new Error(`PNG inválido o sin preparar: ${entry.name}.`);
      const relative=`assets/darwin/${entry.key}-${label}.png`;writes.push({relative,bytes});urls[field]=relative;
    }
    const {artworkKey,discoveredAt,...metadata}=entry;
    merged.set(entry.key,{...metadata,id:entry.key,bookKey:entry.key,...urls,artworkVersion:1,discoveredAt:0});
  }
  if(!process.argv.includes('--check')){
    fs.mkdirSync(path.join(root,'assets/darwin'),{recursive:true});
    for(const {relative,bytes} of writes)fs.writeFileSync(path.join(root,relative),bytes);
    const target=path.join(root,'darwin-data.js'),temp=target+'.tmp';
    fs.writeFileSync(temp,'// Included species and prepared local artwork. No API or browser storage required.\nconst DARWIN_STARTER = '+JSON.stringify([...merged.values()],null,2)+';\n');fs.renameSync(temp,target);
  }
  console.log(`${entries.length-skipped} especies ilustradas verificadas; ${skipped} genéricas omitidas. Colección resultante: ${merged.size}. ${process.argv.includes('--check')?'Sin modificar archivos.':'Revisá los cambios con git diff antes de publicarlos.'}`);
}catch(error){console.error('No se pudo incorporar el libro: '+error.message);process.exit(1);}
