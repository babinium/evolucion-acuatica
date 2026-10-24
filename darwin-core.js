// Portable species-only records. No credentials, world state or provider calls.
const DarwinCore = (() => {
  const types=['producer','herbivore','carnivore'];
  const traits=['size','speed','attack','defense','perception','fertility','metabolism','foodEfficiency','toxicity'];
  const text=(v,n=2000)=>String(v??'').replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim().slice(0,n);
  const folded=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function hash(value) {
    let a=2166136261,b=2246822507;
    for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,3266489909);}
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
  }
  function keyFor(sp) {return 'darwin-'+hash([sp.class,folded(sp.name),folded(sp.visualDescription)].join('|'));}
  function record(raw,{now=Date.now()}={}) {
    if(!raw || typeof raw!=='object' || !types.includes(raw.class) || !text(raw.name,70))throw new Error('Especie inválida en el libro.');
    if(Number(raw.variationDepth)>0)return null;
    const genes={};
    for(const k of traits){
      const max=k==='fertility'?(raw.class==='producer'?30:20):10;
      const v=Number(raw.traits?.[k]??(k==='fertility'?14:5));
      if(!Number.isFinite(v))throw new Error('Rasgos inválidos en el libro.');
      genes[k]=Math.max(0,Math.min(max,v));
    }
    if(raw.class!=='carnivore')genes.attack=0;
    if(raw.class==='producer')genes.speed=0;
    return {key:/^darwin-[a-f0-9]{16}$/.test(raw.bookKey)?raw.bookKey:keyFor(raw),
      name:text(raw.name,70),class:raw.class,description:text(raw.description),visualDescription:text(raw.visualDescription),
      diet:text(raw.diet,500),habitat:text(raw.habitat,500),behavior:text(raw.behavior,500),
      ancestor:text(raw.evolutionSource?.name || raw.ancestor,70),traits:genes,
      generation:Math.max(1,Math.min(999999,Math.round(Number(raw.generation)||1))),
      discoveredAt:Math.max(0,Number.isFinite(raw.discoveredAt)?raw.discoveredAt:now),
      artworkKey:/^art-[a-f0-9]{16}$/.test(raw.artworkKey)?raw.artworkKey:''};
  }
  function safeImage(url) {
    return typeof url==='string' && url.length<=1100000 &&
      (/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url) || /^assets\/darwin\/[a-z0-9-]+-(?:sprite|portrait)\.png$/.test(url));
  }
  function artwork(raw) {
    if(!raw || !safeImage(raw.spriteUrl) || !safeImage(raw.portraitUrl))return null;
    return {key:'art-'+hash(raw.spriteUrl+'|'+raw.portraitUrl),spriteUrl:raw.spriteUrl,portraitUrl:raw.portraitUrl,artworkVersion:1};
  }
  function boundedPng(url) {
    if(!url.startsWith('data:'))return true;
    const encoded=url.split(',')[1],alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',bytes=[];
    if(encoded.length<32)return false;
    for(let i=0;i<32;i+=4){const n=(alphabet.indexOf(encoded[i])<<18)|(alphabet.indexOf(encoded[i+1])<<12)|(alphabet.indexOf(encoded[i+2])<<6)|alphabet.indexOf(encoded[i+3]);bytes.push((n>>>16)&255,(n>>>8)&255,n&255);}
    if(![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')return false;
    return [bytes.slice(16,20),bytes.slice(20,24)].every(a=>{const n=a.reduce((v,b)=>v*256+b,0);return n>0&&n<=512;});
  }
  function merge(included,personal) {
    const map=new Map();
    for(const e of included)map.set(e.key,{...e,included:true,discovered:false});
    for(const e of personal){
      const old=map.get(e.key);
      map.set(e.key,{...old,...e,artworkKey:e.artworkKey || old?.artworkKey || '',
        included:!!old?.included,discovered:true,discoveredAt:old?.discoveredAt&&e.discoveredAt?Math.min(old.discoveredAt,e.discoveredAt):e.discoveredAt});
    }
    return [...map.values()];
  }
  function filter(entries,{query='',type='all',source='all'}={}) {
    const q=folded(query);
    return entries.filter(e=>(type==='all'||e.class===type) &&
      (source==='all'||(source==='included'?e.included:e.discovered)) &&
      (!q||folded([e.name,e.description,e.habitat,e.diet,e.ancestor].join(' ')).includes(q)));
  }
  function exportData(entries,assets) {
    const used=new Map();
    const species=entries.map(raw=>{
      const e=record({...raw,bookKey:raw.key});
      if(e.artworkKey){const a=artwork(assets.get(e.artworkKey));if(!a)throw new Error('Falta una ilustración del libro.');used.set(a.key,a);e.artworkKey=a.key;}
      return e;
    });
    return {format:'evolucion-darwin',version:1,species,artworkAssets:[...used.values()]};
  }
  function importData(data) {
    if(data?.format!=='evolucion-darwin'||data.version!==1||!Array.isArray(data.species)||data.species.length>500 ||
      !Array.isArray(data.artworkAssets)||data.artworkAssets.length>500)throw new Error('Este archivo no es un Libro de Darwin compatible.');
    const assets=new Map();
    for(const raw of data.artworkAssets){const a=artwork(raw);if(!a||!boundedPng(a.spriteUrl)||!boundedPng(a.portraitUrl))throw new Error('Ilustración inválida o demasiado grande en el libro.');assets.set(a.key,a);}
    const entries=data.species.map(raw=>{
      if(raw.artworkKey&&!/^art-[a-f0-9]{16}$/.test(raw.artworkKey))throw new Error('Referencia de ilustración inválida.');
      const e=record({...raw,bookKey:raw.key});
      if(!e)throw new Error('El libro contiene una variación en lugar de una especie.');
      if(e.artworkKey&&!assets.has(e.artworkKey))throw new Error('Falta una ilustración del libro.');
      return e;
    });
    return {entries:[...new Map(entries.map(e=>[e.key,e])).values()],artworks:[...assets.values()]};
  }
  function fromSave(saved) {
    if(!Array.isArray(saved?.species))return [];
    return saved.species.slice(0,500).flatMap(raw=>{
      try{const asset=saved.artworkAssets?.[raw.artworkRef];const sp={...raw,...asset};
        return record(sp)?[sp]:[];}catch{return [];}
    });
  }
  function choose(entries,counts,random=Math.random) {
    const selected=[];
    for(const type of types){
      const pool=entries.filter(e=>e.class===type);
      const count=Math.max(0,Math.min(4,Math.round(Number(counts[type])||0)));
      while(pool.length && selected.filter(e=>e.class===type).length<count){
        const i=Math.min(pool.length-1,Math.max(0,Math.floor((Number(random())||0)*pool.length)));
        selected.push(pool.splice(i,1)[0]);
      }
    }
    return selected;
  }
  return {types,traits,keyFor,record,artwork,merge,filter,choose,exportData,importData,fromSave};
})();
