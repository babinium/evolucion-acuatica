import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createGame} from './harness.mjs';

const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('darwin-data.js','utf8')+';globalThis.starter=DARWIN_STARTER',ctx);

test('the shipped collection contains at least four illustrated species of each diet with bounded local PNGs',()=>{
 const entries=ctx.starter;assert.ok(entries.length>=47);let bytes=0;
 assert.equal(new Set(entries.map(e=>e.bookKey)).size,entries.length);
 for(const type of ['producer','herbivore','carnivore'])assert.ok(entries.filter(e=>e.class===type).length>=4);
 for(const e of entries)for(const [field,size] of [['spriteUrl',192],['portraitUrl',384]]){
  assert.match(e[field],/^assets\/darwin\/darwin-[a-f0-9]{16}-(sprite|portrait)\.png$/);
  const b=fs.readFileSync(e[field]);assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(b.readUInt32BE(16),size);assert.equal(b.readUInt32BE(20),size);bytes+=b.length;
 }
 // The collection grows with discoveries; bound artwork cost per entry rather
 // than forcing older species out to fit a fixed catalogue-wide budget.
 assert.ok(bytes<entries.length*192*1024);
});

test('a new installation can start an illustrated world from the book without generation calls',async()=>{
 const calls=[];const g=createGame({fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({})};}});
 await g.run(`document.getElementById('setupSpeciesSource').value='book';document.getElementById('setupProducers').value=4;
  document.getElementById('setupHerbivores').value=4;document.getElementById('setupCarnivores').value=4;startWorld(false)`);
 assert.equal(g.run('state.species.length'),12);
 assert.ok(g.run('state.species.every(sp=>sp.artworkVersion===1 && sp.portraitUrl.startsWith("assets/darwin/"))'));
 assert.equal(g.run('state.aiCalls'),0);assert.equal(calls.filter(c=>c.options?.method==='POST').length,0);
 assert.equal(g.run('state.evolutionAiEnabled'),false);
});

test('old saved species migrate before playing without rewriting or loading the saved world',async()=>{
 const saved=JSON.stringify({species:[{name:'Recuerdo antiguo',class:'producer',traits:{size:4},visualDescription:'green',variationDepth:0}]});
 const storage=new Map([['evo-save',saved]]),g=createGame({storage});
 await g.run('darwinReady');await g.run('flushDarwinBook()');
 assert.equal(storage.get('evo-save'),saved);assert.equal(g.run('state.started'),false);
 assert.ok(g.run('darwinEntries().some(e=>e.name==="Recuerdo antiguo" && e.discovered)'));
});

test('discoveries survive another world and repeated captures do not keep writing identical records',async()=>{
 const g=createGame();g.run('seedWorld(fallbackSpecies(1,1,1))');await g.run('flushDarwinBook()');
 const first=g.run('[...darwinPersonal.keys()]');
 g.run(`window.bookWrites=0;const originalWrite=darwinVault.write.bind(darwinVault);
  darwinVault.write=(...args)=>{window.bookWrites++;return originalWrite(...args);};
  for(const sp of state.species)queueBookSpecies(sp)`);
 await g.run('flushDarwinBook()');assert.equal(g.run('window.bookWrites'),0);
 g.run('seedWorld(fallbackSpecies(2,2,1))');await g.run('flushDarwinBook()');
 assert.ok(first.every(key=>g.run(`darwinPersonal.has('${key}')`)));
 g.run('state.creatures=[];recalcSpecies()');assert.ok(first.every(key=>g.run(`darwinPersonal.has('${key}')`)));
});

test('a third variation becomes a distinct book identity and its final AI name updates that same entry',async()=>{
 const g=createGame();
 g.run(`seedWorld(fallbackSpecies(1,1,1));state.evolutionAiEnabled=true;
  window.branch=state.species.find(sp=>sp.class==='herbivore');window.originalKey=window.branch.bookKey;
  for(let i=0;i<3;i++){const genes={...window.branch.traits,speed:window.branch.traits.speed>5?1:10};
  window.branch=maybeMutateSpecies(window.branch,{generation:i+1},genes);}`);
 assert.equal(g.run('window.branch.variationDepth'),0);assert.notEqual(g.run('window.branch.bookKey'),g.run('window.originalKey'));
 await g.run('flushDarwinBook()');const key=g.run('window.branch.bookKey');
 g.run(`applyEvolutionIdentity(window.branch,{name:'Identidad definitiva',description:'Nueva especie',visualDescription:'New dorsal body'})`);
 await g.run('flushDarwinBook()');
 assert.equal(g.run(`darwinPersonal.get('${key}').name`),'Identidad definitiva');
 assert.equal(g.run(`darwinEntries().filter(e=>e.key==='${key}').length`),1);
});

test('opening the book suspends simulation steps, shortcuts and pending paid identity work',async()=>{
 const g=createGame();g.run('seedWorld(fallbackSpecies(1,1,1));document.getElementById("darwinBook").open=true;window.beforeDay=state.day;loop(5000)');
 assert.equal(g.run('state.day'),g.run('window.beforeDay'));
 await g.run('processEvolutionQueue()');assert.equal(g.run('state.aiCalls'),0);
 const handler=g.listeners.get('window:keydown');handler({key:'2',target:{closest:()=>null},preventDefault(){}});
 assert.equal(g.run('state.activeTool'),null);
});

test('a full browser disk leaves the game alive and the failed discovery exportable in this session',async()=>{
 const g=createGame();await g.run('darwinReady');
 g.run(`darwinVault.write=async()=>{throw new Error('quota')};seedWorld(fallbackSpecies(1,1,1))`);
 await g.run('flushDarwinBook()');
 assert.equal(g.run('state.started'),true);assert.equal(g.run('darwinPersonal.size'),3);
 assert.ok(g.run('darwinUnsavedArt.size')>0);assert.match(g.element('bookStatus').textContent,/export/);
});

test('a blocked archive stays explicitly temporary even if the database later opens',async()=>{
 const g=createGame();
 const result=await g.run(`(async()=>{let request={};let closed=false;
  const vault=new DarwinVault({open:()=>request});request.onblocked();await vault.ready;
  request.result={close(){closed=true;}};request.onsuccess();
  return {closed,persistent:vault.persistent,db:await vault.ready};})()`);
 assert.ok(result.closed);assert.equal(result.persistent,false);assert.equal(result.db,null);
});

test('a quota error while updating a discovery keeps the newer name when re-reading stored entries',async()=>{
 const g=createGame();g.run('seedWorld(fallbackSpecies(1,1,1))');await g.run('flushDarwinBook()');
 g.run(`window.remembered=state.species[0];darwinVault.write=async()=>{throw new Error('quota')};
  window.remembered.name='Nombre que aún no pudo guardarse';queueBookSpecies(window.remembered)`);
 await g.run('flushDarwinBook()');await g.run('readDarwinRecords()');
 assert.equal(g.run('darwinPersonal.get(window.remembered.bookKey).name'),'Nombre que aún no pudo guardarse');
});

test('a bundled species portrait is visible in the game inspector and arbitrary local paths stay blocked',async()=>{
 const g=createGame();await g.run(`document.getElementById('setupSpeciesSource').value='book';startWorld(false)`);
 g.run('state.selected=state.creatures[0];updateSelection()');
 assert.match(g.element('selectionPanel').innerHTML,/<img class="portrait" src="assets\/darwin\//);
 assert.equal(g.run('safeImageUrl("config.local.json")'),'');
 assert.equal(g.run('safeImageUrl("assets/darwin/../../config.local.json")'),'');
});

test('the book create button works with no selection instead of silently disabling itself',async()=>{
 const g=createGame();g.run('syncBookSelection()');assert.equal(g.element('bookPlay').disabled,false);
 await g.element('bookPlay').onclick();assert.equal(g.run('state.started'),true);
 assert.equal(g.run('state.aiCalls'),0);
});

test('choosing only a carnivore automatically completes producers and herbivores from the illustrated book',async()=>{
 const g=createGame();g.run(`darwinChosen.add(darwinIncluded.find(e=>e.class==='carnivore').key);syncBookSelection()`);
 await g.element('bookPlay').onclick();assert.equal(g.run('state.started'),true);
 assert.equal(g.run('state.species.length'),3);
 assert.ok(g.run("['producer','herbivore','carnivore'].every(type=>state.species.some(sp=>sp.class===type))"));
 assert.ok(g.run('state.species.every(sp=>sp.portraitUrl.startsWith("assets/darwin/"))'));
});

test('starting with included images never waits for an unavailable personal archive',async()=>{
 const g=createGame();
 const start=g.run(`darwinReady=new Promise(()=>{});document.getElementById('setupSpeciesSource').value='book';startWorld(false)`);
 const completed=await Promise.race([start.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),300))]);
 assert.ok(completed,'the included catalog must remain playable when personal storage does not respond');
 assert.equal(g.run('state.started'),true);
});

test('book creation failures appear inside the open book and restore the create button',async()=>{
 const g=createGame();g.run(`document.getElementById('setupSpeciesSource').value='book';document.getElementById('darwinBook').open=true;
  bookEntriesForWorld=async()=>{throw new Error('No se pudo leer el catálogo de prueba');}`);
 await g.run('startWorld(false)');assert.match(g.element('bookStatus').textContent,/catálogo de prueba/);
 assert.equal(g.run('worldStarting'),false);assert.equal(g.element('startLocal').disabled,false);
});

test('prepared local images can load from a downloaded file without a cross-origin request',()=>{
 const g=createGame();
 const result=g.run(`(()=>{location.protocol='file:';Image=class {constructor(){window.loadedImage=this;}set src(v){this.url=v;}};
  const sp=normalizeSpecies(DARWIN_STARTER[0]);getSprite(sp);return {crossOrigin:window.loadedImage.crossOrigin,url:window.loadedImage.url};})()`);
 assert.equal(result.crossOrigin,undefined);assert.match(result.url,/^assets\/darwin\//);
});
