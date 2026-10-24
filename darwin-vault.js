// IndexedDB keeps portraits out of the small localStorage used by saved worlds.
class DarwinVault {
  constructor(factory=typeof indexedDB==='undefined'?null:indexedDB) {
    this.persistent=false;this.memoryEntries=new Map();this.memoryArt=new Map();
    this.ready=factory?new Promise(resolve=>{
      let request,settled=false,timer=0;
      try{request=factory.open('evolucion-darwin',1);}catch{resolve(null);return;}
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains('species'))db.createObjectStore('species',{keyPath:'key'});
        if(!db.objectStoreNames.contains('artwork'))db.createObjectStore('artwork',{keyPath:'key'});
      };
      const unavailable=()=>{if(!settled){settled=true;clearTimeout(timer);resolve(null);}};
      request.onerror=unavailable;request.onblocked=unavailable;
      request.onsuccess=()=>{
        if(settled){request.result.close();return;}
        settled=true;clearTimeout(timer);this.persistent=true;request.result.onversionchange=()=>request.result.close();resolve(request.result);
      };
      timer=setTimeout(unavailable,2000);
    }):Promise.resolve(null);
  }
  async list(){
    const db=await this.ready;
    if(!db)return [...this.memoryEntries.values()];
    return this.read(db,'species');
  }
  async artwork(key){
    const db=await this.ready;
    if(!db)return this.memoryArt.get(key)||null;
    return this.read(db,'artwork',key);
  }
  read(db,store,key){
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store),object=tx.objectStore(store),r=key?object.get(key):object.getAll();
      const timer=setTimeout(()=>{reject(new Error('El almacenamiento no responde.'));try{tx.abort();}catch{}},2500);
      r.onsuccess=()=>{clearTimeout(timer);resolve(r.result||null);};r.onerror=()=>{clearTimeout(timer);reject(r.error);};
    });
  }
  async write(entries,artworks){
    const db=await this.ready;
    if(!db){for(const e of entries)this.memoryEntries.set(e.key,e);for(const a of artworks)this.memoryArt.set(a.key,a);return;}
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['species','artwork'],'readwrite');
      const timer=setTimeout(()=>{reject(new Error('El almacenamiento no responde.'));try{tx.abort();}catch{}},4000);
      tx.oncomplete=()=>{clearTimeout(timer);resolve();};tx.onabort=()=>{clearTimeout(timer);reject(tx.error||new Error('No se pudo guardar el libro.'));};tx.onerror=()=>{};
      for(const a of artworks)tx.objectStore('artwork').put(a);
      for(const e of entries)tx.objectStore('species').put(e);
    });
  }
}
