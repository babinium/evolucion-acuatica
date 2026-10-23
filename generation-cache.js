import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export class GenerationCache {
  constructor(directory) { this.directory=directory; this.pending=new Map(); }

  key(kind,request) {
    return kind+'-'+createHash('sha256').update(kind+'\n'+canonicalJson(request)).digest('hex');
  }

  async get(kind,request) { return this.read(this.key(kind,request),kind); }

  async read(key,kind) {
    const path=join(this.directory,key+'.json');
    try {
      const record=JSON.parse(await readFile(path,'utf8'));
      if(record.version!==1||record.kind!==kind||!('value' in record)) throw new Error('Caché de IA inválida.');
      await utimes(path,new Date(),new Date()).catch(()=>{});
      return record;
    } catch(error) {if(error.code!=='ENOENT') throw error;return null;}
  }

  async getOrCreate(kind,request,generate,{fresh=false}={}) {
    const key=this.key(kind,request);
    if(this.pending.has(key)) return this.pending.get(key);
    const operation=this.resolve(key,kind,generate,fresh);
    this.pending.set(key,operation);
    try {return await operation;} finally {this.pending.delete(key);}
  }

  async resolve(key,kind,generate,fresh) {
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,key+'.json');
    if(!fresh) {
      const record=await this.read(key,kind);
      if(record) return record;
    }
    const result=await generate();
    // No headers, credential or complete provider response are ever stored.
    const record={version:1,kind,value:result.value,usage:result.usage||null};
    const temp=join(this.directory,`.${key}.${randomUUID()}.tmp`);
    try {
      await writeFile(temp,JSON.stringify(record),{mode:0o600});
      await rename(temp,path);
      await this.trim();
    } catch {
      await unlink(temp).catch(()=>{});
      console.warn('No se pudo conservar la generación en la caché local.');
    }
    return record;
  }

  async trim() {
    const files=[];
    for(const name of await readdir(this.directory)) {
      if(!/^(image|species)-[a-f0-9]{64}\.json$/.test(name)) continue;
      const path=join(this.directory,name),info=await stat(path);
      files.push({path,size:info.size,time:info.mtimeMs});
    }
    files.sort((a,b)=>a.time-b.time);
    let bytes=files.reduce((s,f)=>s+f.size,0),count=files.length;
    for(const file of files) {
      if(count<=128&&bytes<=64*1024*1024) break;
      await unlink(file.path);bytes-=file.size;count--;
    }
  }
}
