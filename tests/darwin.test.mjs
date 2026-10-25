import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console,Map,Set,Date,JSON});
vm.runInContext(fs.readFileSync('darwin-core.js','utf8')+';globalThis.book=DarwinCore',context);
const book=context.book;
const specimen=(name='Fronda',type='producer')=>({name,class:type,visualDescription:'A compact green colony',
  description:'Una colonia que aprovecha la luz.',artworkSource:'ai',traits:{size:4,speed:5,attack:8,defense:3,perception:6,
  fertility:14,metabolism:3,foodEfficiency:7,toxicity:1}});
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

test('collection records whitelist species data and discard credentials and live-world state',()=>{
 const raw={...specimen(),openrouterApiKey:'private',headers:{Authorization:'private'},population:99,extinct:true,energy:20};
 const entry=book.record(raw,{now:123});
 assert.equal(entry.name,'Fronda');assert.equal(entry.traits.speed,0);assert.equal(entry.traits.attack,0);
 assert.equal(entry.discoveredAt,123);
 for(const key of ['openrouterApiKey','headers','population','extinct','energy'])assert.equal(key in entry,false);
});

test('same named identity from a restarted world is deduplicated despite new game ids and population',()=>{
 const a=book.record({...specimen(),id:'world-a'}),b=book.record({...specimen(),id:'world-b',population:18});
 assert.equal(a.key,b.key);
 const union=book.merge([a],[{...b,discoveredAt:10}]);
 assert.equal(union.length,1);assert.ok(union[0].included);assert.ok(union[0].discovered);
});

test('the two variations do not create duplicate species and a renamed evolved identity keeps its book key',()=>{
 assert.equal(book.record({...specimen(),variationDepth:1}),null);
 const a=book.record(specimen());
 const b=book.record({...specimen('Nuevo nombre'),bookKey:a.key,evolutionSource:{name:'Ancestro'}});
 assert.equal(a.key,b.key);assert.equal(b.ancestor,'Ancestro');
 assert.equal(book.merge([], [a,b]).length,1);
});

test('malformed classes and non-finite traits cannot become playable archive entries',()=>{
 assert.throws(()=>book.record({...specimen(),class:'other'}));
 assert.throws(()=>book.record({...specimen(),traits:{size:Infinity}}));
 const c=book.record({...specimen('Presa','herbivore'),traits:{size:999,fertility:999}});
 assert.equal(c.traits.size,10);assert.equal(c.traits.fertility,20);assert.equal(c.traits.attack,0);
});

test('artwork accepts local prepared PNGs, rejects remote and executable URLs',()=>{
 assert.ok(book.artwork({spriteUrl:png,portraitUrl:png}));
 assert.ok(book.artwork({spriteUrl:'assets/darwin/fronda-sprite.png',portraitUrl:'assets/darwin/fronda-portrait.png'}));
 for(const url of ['javascript:alert(1)','https://tracker.example/a.png','../config.local.json','data:image/svg+xml;base64,PHN2Zz4=']) {
  assert.equal(book.artwork({spriteUrl:url,portraitUrl:url}),null);
 }
});

test('search tolerates accents and filters by diet and collection source',()=>{
 const entries=book.merge([book.record(specimen('Nácar azul','herbivore'))],[book.record(specimen('Lanza','carnivore'))]);
 assert.equal(book.filter(entries,{query:'nacar',type:'herbivore'}).length,1);
 assert.equal(book.filter(entries,{source:'discovered'}).length,1);
 assert.equal(book.filter(entries,{source:'included',type:'carnivore'}).length,0);
});

test('an exported collection imports with deduplicated artwork and no unrelated fields',()=>{
 const a=book.record(specimen()),b=book.record(specimen('Otro'));
 const art=book.artwork({spriteUrl:png,portraitUrl:png});
 const payload=book.exportData([{...a,artworkKey:art.key},{...b,artworkKey:art.key}],new Map([[art.key,art]]));
 assert.equal(payload.artworkAssets.length,1);
 const result=book.importData(JSON.parse(JSON.stringify({...payload,apiKey:'omit'})));
 assert.equal(result.entries.length,2);assert.equal(result.artworks.length,1);
 assert.equal(JSON.stringify(result).includes('apiKey'),false);
});

test('imports reject incompatible versions, missing images and remote image references before writing',()=>{
 assert.throws(()=>book.importData({format:'other',version:1,species:[]}));
 assert.throws(()=>book.importData({format:'evolucion-darwin',version:9,species:[]}));
 const a=book.record(specimen());
 assert.throws(()=>book.importData({format:'evolucion-darwin',version:1,species:[{...a,artworkKey:'missing'}],artworkAssets:[]}));
 assert.throws(()=>book.importData({format:'evolucion-darwin',version:1,species:[a],artworkAssets:[{spriteUrl:'https://example.com/a.png',portraitUrl:png}]}));
});

test('saved-world extraction restores packed artwork without changing the saved world or requiring an API',()=>{
 const saved={species:[{...specimen(),artworkRef:0},{...specimen('Variante'),variationDepth:1}],artworkAssets:[{spriteUrl:png,portraitUrl:png}]};
 const before=JSON.stringify(saved),entries=book.fromSave(saved);
 assert.equal(entries.length,1);assert.equal(entries[0].portraitUrl,png);assert.equal(JSON.stringify(saved),before);
});

test('offline world selection respects requested diets, picks unique identities and leaves the catalog unchanged',()=>{
 const entries=['producer','herbivore','carnivore'].flatMap(type=>[1,2,3,4].map(i=>book.record(specimen(type+i,type))));
 const before=JSON.stringify(entries),selected=book.choose(entries,{producer:2,herbivore:3,carnivore:0},()=>0.5);
 assert.equal(selected.length,5);assert.equal(new Set(selected.map(e=>e.key)).size,5);
 assert.equal(selected.filter(e=>e.class==='producer').length,2);assert.equal(JSON.stringify(entries),before);
});

test('an import rejects disguised images and PNG dimensions that could exhaust browser memory',()=>{
 for(const bad of ['data:image/png;base64,YWJj',(()=>{
  const header=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.write('IHDR',12);header.writeUInt32BE(100000,16);header.writeUInt32BE(100000,20);
  return 'data:image/png;base64,'+header.toString('base64');})()]){
  assert.throws(()=>book.importData({format:'evolucion-darwin',version:1,species:[],artworkAssets:[{spriteUrl:bad,portraitUrl:bad}]}));
 }
});
