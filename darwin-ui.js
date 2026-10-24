const darwinVault=new DarwinVault();
const darwinIncludedArt=new Map();
const darwinIncluded=DARWIN_STARTER.map(raw=>{
  const art=DarwinCore.artwork(raw);if(art)darwinIncludedArt.set(art.key,art);
  return {...DarwinCore.record(raw,{now:0}),artworkKey:art?.key||''};
});
const darwinPersonal=new Map(),darwinPending=new Map(),darwinSignatures=new Map(),darwinChosen=new Set(),darwinUnsavedArt=new Map(),darwinUnsavedKeys=new Set();
let darwinReady=Promise.resolve(),darwinWrite=Promise.resolve(),darwinTimer=0,darwinError='';
let darwinPage=0,darwinType='all',darwinView=0,darwinDetailView=0,darwinSelected='',darwinUseSelection=false;
let darwinReturnFocus=null,darwinWasPaused=false,darwinWasStarted=false;
const DARWIN_PAGE_SIZE=24;
function darwinEntries(){return DarwinCore.merge(darwinIncluded,[...darwinPersonal.values()]);}
function darwinMessage(message){document.getElementById('bookStatus').textContent=message;}
function updateBookCount(){
  const n=darwinEntries().length;
  document.getElementById('setupBookCount').textContent=`${n} especies · Ilustraciones incluidas · Sin API`;
  document.getElementById('bookSummary').textContent=`${n} especies · ${darwinIncluded.length} incluidas · ${darwinPersonal.size} registradas en este navegador`;
}
function queueBookSpecies(sp){
  if(!sp || Number(sp.variationDepth)>0)return;
  try{
    sp.bookKey ||= DarwinCore.keyFor(sp);
    const record=DarwinCore.record(sp),art=DarwinCore.artwork(sp);
    const signature=JSON.stringify({...record,discoveredAt:0,artworkKey:art?.key||''});
    if(darwinSignatures.get(record.key)===signature)return;
    darwinPending.set(record.key,{record,art,signature});
    if(!darwinTimer)darwinTimer=setTimeout(()=>{darwinTimer=0;flushDarwinBook();},0);
  }catch{darwinError='Una especie no pudo añadirse al libro.';}
}
function localBookArtwork(entry){
  const sp={...entry,id:entry.key,color:colorFor(entry.class,entry.traits)};
  const urls={spriteUrl:getProceduralSprite(sp,192).toDataURL('image/png'),portraitUrl:getProceduralSprite(sp,384).toDataURL('image/png')};
  proceduralSprites.delete(entry.key+':192');proceduralSprites.delete(entry.key+':384');
  return DarwinCore.artwork(urls);
}
async function flushDarwinBook(){
  await darwinReady;
  const pending=[...darwinPending.values()];darwinPending.clear();
  if(!pending.length)return darwinWrite;
  darwinWrite=darwinWrite.then(async()=>{
    const entries=[],assets=[];
    for(const item of pending){
      const old=darwinPersonal.get(item.record.key);
      const included=darwinIncluded.find(e=>e.key===item.record.key);
      const art=item.art || (!old?.artworkKey&&!included?.artworkKey?localBookArtwork(item.record):null);
      const entry={...item.record,discoveredAt:old?.discoveredAt || item.record.discoveredAt,
        artworkKey:art?.key || old?.artworkKey || included?.artworkKey || ''};
      entries.push(entry);if(art&&!darwinIncludedArt.has(art.key))assets.push(art);
    }
    // One atomic write: a saved entry never points to a half-written image.
    try {
      await darwinVault.write(entries,assets);
      for(const a of assets)darwinUnsavedArt.delete(a.key);
      for(const e of entries)darwinUnsavedKeys.delete(e.key);
      for(const item of pending)darwinSignatures.set(item.record.key,item.signature);
      if(!darwinUnsavedKeys.size)darwinError='';
    } catch {
      // Keep this session's new illustrations exportable when disk quota fails.
      for(const a of assets)darwinUnsavedArt.set(a.key,a);
      for(const e of entries)darwinUnsavedKeys.add(e.key);
      darwinError='No se pudo guardar la colección. Comprobá el espacio del navegador y exportá el libro como respaldo.';
      darwinMessage(darwinError);
    }
    for(const e of entries)darwinPersonal.set(e.key,e);
    updateBookCount();
  }).catch(()=>{darwinError='No se pudo guardar la colección. Comprobá el espacio del navegador y exportá el libro como respaldo.';darwinMessage(darwinError);});
  return darwinWrite;
}
async function bookArtwork(entry){
  try{return darwinIncludedArt.get(entry.artworkKey) || darwinUnsavedArt.get(entry.artworkKey) || (entry.artworkKey?await darwinVault.artwork(entry.artworkKey):null);}
  catch{return null;}
}
async function readDarwinRecords(){
  for(const raw of await darwinVault.list()){
    try{const e=DarwinCore.record({...raw,bookKey:raw.key});if(e&&!darwinUnsavedKeys.has(e.key))darwinPersonal.set(e.key,e);}catch{}
  }
}
async function bookEntriesForWorld(counts){
  // The included library is immediately playable even if personal storage fails.
  const entries=darwinEntries();
  const selected=darwinUseSelection?entries.filter(e=>darwinChosen.has(e.key)):DarwinCore.choose(entries,counts);
  if(darwinUseSelection){
    const missing=Object.fromEntries(DarwinCore.types.map(t=>[t,Math.max(0,counts[t]-selected.filter(e=>e.class===t).length)]));
    selected.push(...DarwinCore.choose(entries.filter(e=>!selected.some(s=>s.key===e.key)),missing));
  }
  return Promise.all(selected.map(async entry=>{
    const art=await bookArtwork(entry);
    return {...entry,id:uid('sp'),bookKey:entry.key,...art,artworkVersion:art?1:0,
      artworkError:art?'':'No se pudo leer la ilustración guardada. Se usa un dibujo local.'};
  }));
}
function bookFiltered(entries=darwinEntries()){return DarwinCore.filter(entries,{
  query:document.getElementById('bookSearch').value,type:darwinType,source:document.getElementById('bookSource').value});}
function renderDarwinBook(){
  const all=darwinEntries(),positions=new Map(all.map((e,i)=>[e.key,i+1]));
  const epoch=++darwinView,entries=bookFiltered(all),pages=Math.max(1,Math.ceil(entries.length/DARWIN_PAGE_SIZE));
  darwinPage=Math.min(darwinPage,pages-1);
  const page=entries.slice(darwinPage*DARWIN_PAGE_SIZE,(darwinPage+1)*DARWIN_PAGE_SIZE);
  const grid=document.getElementById('bookGrid');
  grid.innerHTML=page.map(e=>`<button class="book-card ${darwinSelected===e.key?'active':''}" data-book-key="${e.key}" aria-label="Ver ${escapeHtml(e.name)}">
    <span class="book-card-art"><img data-book-image="${e.key}" alt="" loading="lazy" decoding="async"/><span class="book-card-number">${String(positions.get(e.key)).padStart(3,'0')}</span></span>
    <span class="species-chip ${e.class}">${escapeHtml(className(e.class))}</span><strong>${escapeHtml(e.name)}</strong>
    <span class="book-card-origin">${e.included?'Incluida en el juego':'Descubierta'}${darwinChosen.has(e.key)?' · Elegida':''}</span></button>`).join('');
  document.getElementById('bookEmpty').classList.toggle('hidden',entries.length>0);
  document.getElementById('bookResults').textContent=`${entries.length} ${entries.length===1?'especie':'especies'}`;
  document.getElementById('bookPage').textContent=`${darwinPage+1} / ${pages}`;
  document.getElementById('bookPrev').disabled=darwinPage===0;
  document.getElementById('bookNext').disabled=darwinPage>=pages-1;
  document.querySelectorAll('[data-book-type]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.bookType===darwinType)));
  for(const entry of page)bookArtwork(entry).then(art=>{
    if(epoch!==darwinView)return;
    const img=grid.querySelector(`[data-book-image="${entry.key}"]`);
    if(img){img.src=art?.portraitUrl || localBookArtwork(entry)?.portraitUrl || '';img.onerror=()=>img.classList.add('hidden');}
  }).catch(()=>{});
  syncBookSelection();
}
async function showBookDetail(key){
  const entry=darwinEntries().find(e=>e.key===key);if(!entry)return;
  const epoch=++darwinDetailView;darwinSelected=key;
  document.querySelectorAll('[data-book-key]').forEach(b=>b.classList.toggle('active',b.dataset.bookKey===key));
  const panel=document.getElementById('bookDetail');
  panel.classList.remove('hidden');document.getElementById('bookLayout').classList.add('has-detail');
  panel.innerHTML=`<div class="book-detail-toolbar"><button class="text-button book-detail-close" id="bookCloseDetail">← Colección</button><button id="bookChoose" class="book-choose ${darwinChosen.has(key)?'selected':''}" ${state.started?'disabled':''}>${darwinChosen.has(key)?'Quitar del mundo':'+ Añadir al mundo'}</button></div>
    <button class="portrait-button book-portrait" data-zoom-portrait aria-label="Ampliar ilustración de ${escapeHtml(entry.name)}"><img id="bookPortrait" class="portrait" alt="${escapeHtml(entry.name)}"/><span class="portrait-zoom">×3</span></button>
    <span class="species-chip ${entry.class}">${escapeHtml(className(entry.class))}</span>
    <h2 id="bookDetailTitle" tabindex="-1">${escapeHtml(entry.name)}</h2><p class="book-description">${escapeHtml(entry.description)}</p>
    <p class="book-origin">${entry.included?'Forma parte de la colección incluida con el juego.':'Descubrimiento conservado en este navegador.'}${entry.ancestor?` Descendiente de ${escapeHtml(entry.ancestor)}.`:''}</p>
    <dl class="book-facts"><div><dt>Alimentación</dt><dd>${escapeHtml(entry.diet || (entry.class==='producer'?'Luz y nutrientes':entry.class==='herbivore'?'Algas y productores':'Presas y carroña'))}</dd></div><div><dt>Hábitat</dt><dd>${escapeHtml(entry.habitat||'Aguas medias')}</dd></div></dl>
    <h3>Rasgos de la especie</h3><div class="trait-list">${traitKeys.map(k=>traitBar(k,entry.traits[k],entry.class)).join('')}</div>`;
  document.getElementById('bookCloseDetail').onclick=closeBookDetail;
  document.getElementById('bookChoose').onclick=()=>{
    if(darwinChosen.has(key))darwinChosen.delete(key);
    else{
      const count=darwinEntries().filter(e=>e.class===entry.class&&darwinChosen.has(e.key)).length;
      if(count>=4){darwinMessage('Podés elegir hasta 4 especies de cada grupo.');return;}
      darwinChosen.add(key);
    }
    renderDarwinBook();showBookDetail(key);
  };
  panel.querySelector('[data-zoom-portrait]').onclick=event=>openPortrait(event.currentTarget);
  document.getElementById('bookDetailTitle').focus({preventScroll:true});
  const art=await bookArtwork(entry);
  if(epoch===darwinDetailView)document.getElementById('bookPortrait').src=art?.portraitUrl || localBookArtwork(entry)?.portraitUrl || '';
}
function closeBookDetail(){
  ++darwinDetailView;document.getElementById('bookDetail').classList.add('hidden');
  document.getElementById('bookDetail').innerHTML='';document.getElementById('bookLayout').classList.remove('has-detail');
  const key=darwinSelected;darwinSelected='';renderDarwinBook();
  document.querySelector(`[data-book-key="${key}"]`)?.focus({preventScroll:true});
}
function resetBookListing(){
  darwinPage=0;++darwinDetailView;darwinSelected='';
  document.getElementById('bookDetail').classList.add('hidden');document.getElementById('bookDetail').innerHTML='';
  document.getElementById('bookLayout').classList.remove('has-detail');renderDarwinBook();
}
function syncBookSelection(){
  const selected=darwinEntries().filter(e=>darwinChosen.has(e.key));
  const count=Object.fromEntries(DarwinCore.types.map(t=>[t,selected.filter(e=>e.class===t).length]));
  document.getElementById('bookSelection').classList.toggle('hidden',state.started);
  const missing=[];if(!count.producer)missing.push('1 productor');if(!count.herbivore)missing.push('1 herbívoro');
  document.getElementById('bookPlay').disabled=worldStarting;
  document.getElementById('bookSelectionSummary').textContent=selected.length?`${count.producer} ${count.producer===1?'productor':'productores'} · ${count.herbivore} ${count.herbivore===1?'herbívoro':'herbívoros'} · ${count.carnivore} ${count.carnivore===1?'carnívoro':'carnívoros'}.${missing.length?' Se '+(missing.length===1?'añadirá ':'añadirán ')+missing.join(' y ')+' del libro.':''}`:'Podés elegir habitantes o crear un mundo al azar con las cantidades del menú.';
  document.getElementById('bookPlay').textContent=worldStarting?'Preparando mundo…':selected.length?`Crear mundo · ${selected.length+missing.length} especies`:'Crear mundo al azar';
  document.getElementById('bookClear').disabled=!selected.length;
}
async function openDarwinBook(button){
  const dialog=document.getElementById('darwinBook');if(dialog.open)return;
  darwinReturnFocus=button;darwinWasPaused=state.paused;darwinWasStarted=state.started;
  if(state.started){state.paused=true;syncPauseButton();}
  keys.clear();dragging=false;dialog.showModal();
  updateBookCount();renderDarwinBook();darwinMessage('La colección incluida está lista. Abriendo tus descubrimientos…');
  await darwinReady;
  try{await readDarwinRecords();}catch{darwinError='No se pudo actualizar la colección de este navegador.';}
  await flushDarwinBook();
  if(!dialog.open)return;
  updateBookCount();renderDarwinBook();
  darwinMessage(darwinError || (darwinVault.persistent?'Los descubrimientos se guardan aquí, incluso si su especie se extingue.':'El navegador no permite guardar el libro de forma permanente. Exportalo para conservarlo.'));
}
async function exportDarwinBook(){
  const button=document.getElementById('bookExport');button.disabled=true;darwinMessage('Preparando el libro y sus ilustraciones…');
  try{
    await flushDarwinBook();const entries=darwinEntries(),assets=new Map();
    const portable=async url=>{
      if(url.startsWith('data:'))return url;
      if(location.protocol==='file:')return url;
      const response=await fetch(url,{cache:'force-cache'});
      if(!response.ok)throw new Error('No se pudo abrir una ilustración incluida.');
      const blob=await response.blob();
      return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('No se pudo incluir una ilustración.'));r.readAsDataURL(blob);});
    };
    for(const e of entries){
      const art=await bookArtwork(e);
      if(art&&!assets.has(art.key))assets.set(art.key,{...art,spriteUrl:await portable(art.spriteUrl),portraitUrl:await portable(art.portraitUrl)});
    }
    const data=DarwinCore.exportData(entries,assets);
    const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='libro-de-darwin.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    darwinMessage(location.protocol==='file:'?'Libro exportado. Las ilustraciones incluidas necesitan también la carpeta assets/darwin del juego.':'Libro exportado. Conservá el archivo para llevar la colección a otro navegador.');
  }catch(error){darwinMessage('No se pudo exportar: '+error.message);}
  finally{button.disabled=false;}
}
async function importDarwinBook(file){
  if(!file)return;
  document.getElementById('bookImport').disabled=true;darwinMessage('Comprobando e incorporando el libro…');
  try{
    if(file.size>32*1024*1024)throw new Error('El archivo supera los 32 MB.');
    const imported=DarwinCore.importData(JSON.parse(await file.text()));
    await darwinReady;await flushDarwinBook();
    const entries=imported.entries.map(e=>{
      const old=darwinPersonal.get(e.key);
      return {...e,artworkKey:e.artworkKey || old?.artworkKey || '',discoveredAt:old?.discoveredAt?Math.min(old.discoveredAt,e.discoveredAt):e.discoveredAt};
    });
    await darwinVault.write(entries,imported.artworks);
    for(const e of entries)darwinPersonal.set(e.key,e);
    updateBookCount();darwinPage=0;renderDarwinBook();darwinMessage(`${entries.length} especies incorporadas al libro. Tu partida no cambió.`);
  }catch(error){darwinMessage('No se pudo importar: '+error.message);}
  finally{document.getElementById('bookFile').value='';document.getElementById('bookImport').disabled=false;}
}
function initDarwinBook(){
  darwinReady=(async()=>{
    try{await readDarwinRecords();}catch{darwinError='No se pudo leer la colección de este navegador. La colección incluida sigue disponible.';}
    try{const saved=JSON.parse(localStorage.getItem('evo-save')||'null');for(const sp of DarwinCore.fromSave(saved))queueBookSpecies(sp);}catch{}
    updateBookCount();
  })();
  document.getElementById('setupBook').onclick=event=>openDarwinBook(event.currentTarget);
  document.getElementById('bookBtn').onclick=event=>openDarwinBook(event.currentTarget);
  const dialog=document.getElementById('darwinBook');
  document.getElementById('bookClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    ++darwinView;++darwinDetailView;
    document.getElementById('bookGrid').innerHTML='';document.getElementById('bookDetail').innerHTML='';
    document.getElementById('bookDetail').classList.add('hidden');document.getElementById('bookLayout').classList.remove('has-detail');
    darwinSelected='';keys.clear();simulationAccumulator=0;
    if(darwinWasStarted){state.paused=darwinWasPaused;syncPauseButton();}
    if(state.started&&!darwinWasStarted)document.getElementById('pauseBtn').focus({preventScroll:true});
    else darwinReturnFocus?.focus({preventScroll:true});
    invalidate();
  });
  document.getElementById('bookSearch').addEventListener('input',resetBookListing);
  document.getElementById('bookSource').addEventListener('change',resetBookListing);
  document.querySelectorAll('[data-book-type]').forEach(b=>b.onclick=()=>{darwinType=b.dataset.bookType;resetBookListing();});
  document.getElementById('bookGrid').onclick=event=>{const b=event.target.closest('[data-book-key]');if(b)showBookDetail(b.dataset.bookKey);};
  document.getElementById('bookPrev').onclick=()=>{darwinPage=Math.max(0,darwinPage-1);renderDarwinBook();document.getElementById('bookCards').scrollTop=0;};
  document.getElementById('bookNext').onclick=()=>{darwinPage++;renderDarwinBook();document.getElementById('bookCards').scrollTop=0;};
  document.getElementById('bookClear').onclick=()=>{darwinChosen.clear();renderDarwinBook();if(darwinSelected)showBookDetail(darwinSelected);};
  document.getElementById('bookPlay').onclick=async()=>{
    if(state.started||worldStarting)return;
    const selected=darwinEntries().filter(e=>darwinChosen.has(e.key));
    if(selected.length)for(const [type,id] of [['producer','setupProducers'],['herbivore','setupHerbivores'],['carnivore','setupCarnivores']])document.getElementById(id).value=Math.max(type==='carnivore'?0:1,selected.filter(e=>e.class===type).length);
    document.getElementById('setupSpeciesSource').value='book';darwinUseSelection=selected.length>0;
    try{await startWorld(false);if(state.started)dialog.close();else darwinMessage(document.getElementById('setupStatus').textContent);}
    finally{darwinUseSelection=false;syncBookSelection();}
  };
  document.getElementById('bookExport').onclick=exportDarwinBook;
  document.getElementById('bookImport').onclick=()=>document.getElementById('bookFile').click();
  document.getElementById('bookFile').addEventListener('change',event=>importDarwinBook(event.target.files[0]));
}
