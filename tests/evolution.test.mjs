import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

const identity={name:'Aleta de jade',description:'Descendiente de cuerpo acorazado que se alimenta de plantas.',visualDescription:'Jade aquatic grazer with broad sturdy fins and a ridged shell.'};
async function lineage({type='herbivore',ai=false,fetch}={}) {
  const calls=[];
  const game=createGame({fetch:async(path,options)=>{
    if(path==='/api/config-status') return {ok:true,json:async()=>({canUseAiText:true,canUseAiImages:true})};
    calls.push({path,body:JSON.parse(options.body)});
    return fetch ? fetch(path,options) : {ok:true,json:async()=>path==='/api/evolve-species'?{identity}:{image:'synthetic-image'}};
  }});
  await game.run('loadConfigStatus()');
  game.run(`seedWorld([normalizeSpecies({id:'ancestor',name:'Origen',class:'${type}',description:'Especie ancestral.',
    portraitUrl:'original-portrait',spriteUrl:'original-sprite',artworkVersion:1,
    traits:{size:2,speed:2,attack:2,defense:2,perception:2,fertility:10,metabolism:2,foodEfficiency:2,toxicity:2}})]);
    state.evolutionAiEnabled=${ai};state.mutationRate=0.2;state.paused=true;
    window.ancestralGenes=JSON.stringify(state.creatures[0].genes);
    window.cursor=state.species[0];
    window.advance=()=>{
      const before=window.cursor;
      const genes=Object.fromEntries(traitKeys.map(k=>[k,traitMax(k,before.class) ? (before.traits[k]>traitMax(k,before.class)/2 ? traitMax(k,before.class)*0.2 : traitMax(k,before.class)*0.8) : 0]));
      const parent=state.creatures.find(c=>c.speciesId===before.id);
      const child=maybeMutateSpecies(before,parent,genes);
      spawnCreature(child,600,600,parent.generation+1,genes);recalcSpecies();
      state.selected=state.creatures.at(-1);window.cursor=child;
      return child;
    };
    prepareSpeciesArtwork=async()=>({portraitUrl:'new-portrait',spriteUrl:'new-sprite',artworkVersion:1});`);
  return {game,calls};
}

for(const type of ['producer','herbivore','carnivore']) test(`${type}: third successive branch creates an identity, never changes its ancestors or diet`,async()=>{
  const {game,calls}=await lineage({type});
  for(let i=1;i<=7;i++) {
    const child=game.run('window.advance()');
    assert.equal(child.class,type);
    assert.equal(child.variationDepth,i%3);
    assert.equal(child.identityId,i%3===0 ? child.id : game.run(`state.species[${i-i%3}].id`));
    if(i%3===0) {
      assert.notEqual(child.name,'Origen');assert.ok(child.evolutionSource);
      assert.notEqual(child.description,'Especie ancestral.');
      assert.equal(child.portraitUrl,'');
      game.run('ensureLocalEvolutionArtwork(window.cursor)');
      assert.match(child.portraitUrl,/^data:image\/png;base64,/);
    } else assert.match(child.name,new RegExp(`var. ${i%3}`));
    await game.run('processEvolutionQueue()');
  }
  assert.equal(game.run('state.species[0].name'),'Origen');
  assert.equal(game.run('state.species[0].portraitUrl'),'original-portrait');
  assert.equal(game.run('JSON.stringify(state.creatures[0].genes)'),game.run('window.ancestralGenes'));
  assert.equal(calls.length,0);
  assert.equal(game.run('livingIdentities().size'),3);
});

test('sibling branches count their own depth and nearby offspring reuse the same branch',async()=>{
  const {game}=await lineage();
  game.run('window.advance();window.advance();window.deep=window.cursor;window.cursor=state.species[0]');
  const sibling=game.run(`(() => {const sp=window.cursor,genes={...sp.traits,size:8,defense:8,perception:8};
    return maybeMutateSpecies(sp,state.creatures[0],genes);})()`);
  assert.equal(sibling.variationDepth,1);
  assert.equal(sibling.identityId,'ancestor');
  const count=game.run('state.species.length');
  assert.equal(game.run(`maybeMutateSpecies(state.species[0],state.creatures[0],${JSON.stringify(sibling.traits)}).id`),sibling.id);
  assert.equal(game.run('state.species.length'),count);
  game.run('window.cursor=window.deep');
  assert.equal(game.run('window.advance().variationDepth'),0);
});

test('small mutations and the population limit do not create or buy identities',async()=>{
  const {game,calls}=await lineage({ai:true});
  assert.equal(game.run('maybeMutateSpecies(window.cursor,state.creatures[0],{...window.cursor.traits,size:2.01}).id'),'ancestor');
  game.run(`for(let i=1;i<MAX_EVOLVED_SPECIES;i++) state.species.push(normalizeSpecies({id:'limit-'+i,class:'herbivore'}));rebuildSpeciesIndex();`);
  assert.equal(game.run('window.advance().id'),'ancestor');
  assert.equal(game.run('state.species.length'),48);
  await game.run('processEvolutionQueue()');assert.equal(calls.length,0);
});

test('only extinct variations can release a slot; living individuals and full identities remain',async()=>{
  const {game}=await lineage();game.run('window.advance()');
  assert.equal(game.run('retireExtinctVariation()'),false);
  game.run('window.cursor.extinct=true');
  assert.equal(game.run('retireExtinctVariation()'),false,'stale flags must never remove living creatures');
  game.run('window.cursor.extinct=false');
  game.run(`state.creatures=state.creatures.filter(c=>c.speciesId==='ancestor');recalcSpecies();`);
  assert.equal(game.run('retireExtinctVariation()'),true);
  assert.equal(game.run('speciesById.size'),1);
  game.run('state.creatures=[];recalcSpecies()');
  assert.equal(game.run('retireExtinctVariation()'),false);
});

test('retiring an extinct sibling never duplicates a surviving variation name',async()=>{
  const {game}=await lineage();game.run('window.advance();window.first=window.cursor');
  game.run(`window.sibling=maybeMutateSpecies(state.species[0],state.creatures[0],{...state.species[0].traits,size:9,defense:9,perception:9});
    state.creatures=state.creatures.filter(c=>c.speciesId!==window.first.id);recalcSpecies();retireExtinctVariation();
    window.sibling.extinct=false;
    window.another=maybeMutateSpecies(state.species[0],state.creatures[0],{...state.species[0].traits,toxicity:9,speed:9});`);
  assert.notEqual(game.run('window.sibling.name'),game.run('window.another.name'));
});

test('only the third branch requests one text and one image; descendants share the finished art',async()=>{
  let release;
  const {game,calls}=await lineage({ai:true,fetch:async path=>{
    if(path==='/api/evolve-species') await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>path==='/api/evolve-species'?{identity}:{image:'synthetic-image'}};
  }});
  for(let i=0;i<2;i++) {game.run('window.advance()');await game.run('processEvolutionQueue()');}
  assert.equal(calls.length,0);game.run('window.advance()');
  const pending=game.run('processEvolutionQueue()');
  assert.equal(game.run('processEvolutionQueue()'),pending);
  game.run('window.advance()'); // Born while its new identity is still being prepared.
  release();await pending;
  assert.deepEqual(calls.map(c=>c.path),['/api/evolve-species','/api/generate-images']);
  assert.equal(calls[0].body.class,'herbivore');
  assert.equal(game.run('state.species[3].name'),identity.name);
  assert.equal(game.run('state.species[4].name'),identity.name+' var. 1');
  assert.equal(game.run('state.species[4].portraitUrl'),'new-portrait');
  assert.equal(game.run('state.species[3].evolutionImageStatus'),'ready');
  assert.equal(game.run('state.species[0].portraitUrl'),'original-portrait');
  game.run('saveWorld();loadWorld()');await game.run('processEvolutionQueue()');
  assert.equal(calls.length,2);assert.equal(game.run('state.species[3].name'),identity.name);
});

test('an API failure stops the queue and loading does not retry it or buy an image',async()=>{
  const {game,calls}=await lineage({ai:true,fetch:async()=>({ok:false,status:402,json:async()=>({error:'Sin saldo.'})})});
  for(let i=0;i<6;i++) game.run('window.advance()');
  await game.run('processEvolutionQueue()');
  assert.equal(game.run('state.species[3].evolutionTextStatus'),'failed');
  assert.match(game.run('state.species[3].portraitUrl'),/^data:image\/png;base64,/);
  assert.equal(game.run('state.evolutionAiBlocked'),'Sin saldo.');
  game.run('saveWorld();loadWorld()');await game.run('processEvolutionQueue()');
  assert.equal(calls.length,1);
});

test('hidden tabs, disabled AI and extinct families never start paid work',async()=>{
  const {game,calls}=await lineage({ai:true});for(let i=0;i<3;i++) game.run('window.advance()');
  game.run('document.hidden=true');await game.run('processEvolutionQueue()');
  game.run('document.hidden=false;state.evolutionAiEnabled=false');await game.run('processEvolutionQueue()');
  assert.equal(calls.length,0);
  game.run(`state.evolutionAiEnabled=true;state.creatures=state.creatures.filter(c=>c.speciesId==='ancestor')`);
  await game.run('processEvolutionQueue()');assert.equal(calls.length,0);
  assert.equal(game.run('state.species[3].evolutionTextStatus'),'skipped');
});

test('changing worlds while text is in flight prevents stale images and state changes',async()=>{
  let release;
  const {game,calls}=await lineage({ai:true,fetch:async()=>{
    await new Promise(resolve=>{release=resolve;});return {ok:true,json:async()=>({identity})};
  }});
  for(let i=0;i<3;i++) game.run('window.advance()');
  const pending=game.run('processEvolutionQueue()');
  game.run('seedWorld(fallbackSpecies(1,0,0))');release();await pending;
  assert.equal(calls.length,1);assert.equal(game.run('state.species.length'),1);
  assert.equal(game.run('state.species.some(sp=>sp.name==="Aleta de jade")'),false);
});

test('hiding the tab during text generation defers the image until it becomes visible',async()=>{
  let release;
  const {game,calls}=await lineage({ai:true,fetch:async path=>{
    if(path==='/api/evolve-species') await new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>path==='/api/evolve-species'?{identity}:{image:'synthetic-image'}};
  }});
  for(let i=0;i<3;i++) game.run('window.advance()');
  const pending=game.run('processEvolutionQueue()');
  game.run('document.hidden=true');release();await pending;
  assert.equal(calls.length,1,'only the already submitted text may finish in a hidden tab');
  assert.equal(game.run('state.species[3].evolutionImageStatus'),'pending');
  game.run('document.hidden=false');await game.run('processEvolutionQueue()');
  assert.equal(calls.length,2);assert.equal(game.run('state.species[3].evolutionImageStatus'),'ready');
});

test('legacy global variation numbers migrate by ancestry without generating identities',async()=>{
  const {game,calls}=await lineage();for(let i=0;i<2;i++) game.run('window.advance()');
  game.run(`state.species[1].name='Origen var. 28';state.species[2].name='Origen var. 42';
    for(const sp of state.species) for(const k of ['lineageVersion','identityId','variationDepth','lineageName']) delete sp[k];
    saveWorld();loadWorld();`);
  assert.deepEqual(Array.from(game.run('state.species.map(sp=>sp.variationDepth)')),[0,1,2]);
  assert.equal(game.run('state.species[2].name'),'Origen var. 42');
  await game.run('processEvolutionQueue()');assert.equal(calls.length,0);
  game.run('window.cursor=state.species[2]');assert.equal(game.run('window.advance().variationDepth'),0);
});

test('artwork is stored once per identity and interrupted requests never restart after load',async()=>{
  const {game}=await lineage({ai:true});for(let i=0;i<3;i++) game.run('window.advance()');
  game.run(`state.species[3].evolutionTextStatus='generating';saveWorld()`);
  const saved=JSON.parse(game.values.get('evo-save'));
  assert.equal(saved.artworkAssets.length,1);
  assert.equal(JSON.stringify(saved).split('original-portrait').length-1,1);
  game.run('loadWorld()');
  assert.equal(game.run('state.species[2].portraitUrl'),'original-portrait');
  assert.equal(game.run('state.species[3].evolutionTextStatus'),'failed');
  assert.equal(game.run('state.species[3].evolutionImageStatus'),'failed');
  assert.match(game.run('state.species[3].evolutionError'),/no se reenvía/);
});
