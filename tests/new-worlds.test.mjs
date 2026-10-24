import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

import {freshSpecies} from './fresh-species.mjs';

test('every fresh AI response is balanced before artwork without reusing old species or retrying providers',async()=>{
  let generation=0;const requests=[];
  const game=createGame({fetch:async(url,options)=>{
    if(url==='/api/config-status')return {ok:true,json:async()=>({canUseAiText:true,canUseAiImages:true})};
    requests.push({url,body:JSON.parse(options.body)});
    return {ok:true,json:async()=>({species:freshSpecies(100+generation++)})};
  }});
  game.element('setupProducers').value='2';game.element('setupHerbivores').value='2';game.element('setupCarnivores').value='2';
  game.element('reuseAiSpecies').checked=false;
  game.run(`window.artworkBalanced=true;addSpeciesArtwork=async sp=>{
    window.artworkBalanced &&= initialSpeciesFitness(sp).valid;
    sp.spriteUrl='data:image/png;base64,c3ludGhldGlj';sp.portraitUrl=sp.spriteUrl;sp.artworkVersion=1;
  };`);
  for(let i=0;i<3;i++) {
    await game.run('startWorld(true,true)');
    assert.equal(game.run('state.started'),true);
    assert.equal(game.run('window.artworkBalanced'),true);
    assert.equal(game.run(`state.species.every(sp=>sp.name.startsWith('Nueva ${100+i}-'))`),true);
    assert.equal(game.run('state.species.every(sp=>initialSpeciesFitness(sp).valid)'),true);
    assert.equal(game.run('state.creatures.every(c=>initialSpeciesFitness({...getSpecies(c),traits:c.genes}).valid)'),true);
  }
  assert.equal(requests.length,3);assert.ok(requests.every(r=>r.url==='/api/generate-species'&&r.body.fresh===true));
});

test('new trait profiles including extremes satisfy the initial energy budget and retain their identity',()=>{
  const game=createGame();
  const sets=[...Array.from({length:100},(_,i)=>freshSpecies(i)),
    ...[0,10,30].map(value=>freshSpecies(value+700).map(sp=>({...sp,traits:Object.fromEntries(Object.keys(sp.traits).map(k=>[k,value]))})))];
  for(const raw of sets) {
    const before=JSON.stringify(raw);
    const result=game.run(`balanceInitialSpecies(${JSON.stringify(raw)}).map(sp=>({name:sp.name,class:sp.class,fitness:initialSpeciesFitness(sp)}))`);
    assert.ok(result.every(sp=>sp.fitness.valid));assert.equal(JSON.stringify(raw),before);
    assert.deepEqual(Array.from(result,sp=>sp.name),raw.map(sp=>sp.name));
    assert.deepEqual(Array.from(result,sp=>sp.class),raw.map(sp=>sp.class));
  }
});

test('a hungry grazer can eat near a resting hunter but still flees immediate danger',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    seedWorld(fallbackSpecies(1,1,1));state.chaos=0;state.creatures=[];state.resources=[];
    const herb=state.species.find(sp=>sp.class==='herbivore'),carn=state.species.find(sp=>sp.class==='carnivore');
    const grazer=spawnCreature(herb,500,500,1),hunter=spawnCreature(carn,750,500,1);
    grazer.energy=10;hunter.state='saciado';hunter.hungry=false;hunter.energy=hunter.maxEnergy;
    spawnResource(500,500,80);rebuildSpatialIndexes();
    animalThink(grazer,herb,0.2);const fed=grazer.energy>10;
    hunter.x=510;hunter.state='persiguiendo';hunter.hungry=true;rebuildSpatialIndexes();
    sense(grazer,herb,0,true);animalThink(grazer,herb,0.2);
    return {fed,fleeing:grazer.state==='huyendo'};
  })()`);
  assert.ok(result.fed && result.fleeing);
});

test('swimming effort uses actual velocity and sprinting pays its squared movement cost',()=>{
  const costs=[0,1,2].map(velocity=>{
    const game=createGame();
    return game.run(`(()=>{
      seedWorld(fallbackSpecies(1,1,1));state.creatures=[];state.resources=[];state.corpses=[];
      const sp=normalizeSpecies({class:'herbivore',traits:{size:4,speed:6,attack:0,defense:3,
        perception:5,fertility:0,metabolism:4,foodEfficiency:7,toxicity:0}});
      state.species=[sp];rebuildSpeciesIndex();const c=spawnCreature(sp,500,500,1);
      c.energy=c.maxEnergy;c.vx=${velocity};c.vy=0;animalThink=()=>{};rebuildSpatialIndexes();
      const before=c.energy,basal=bodyOf(c).basal*localWater(c).temperatureActivity;
      updateCreatures(1);return before-c.energy-basal;
    })()`);
  });
  assert.ok(Math.abs(costs[0])<1e-8);
  assert.ok(costs[1]>0.07,'58 world units/s must pay a meaningful movement cost');
  assert.ok(Math.abs(costs[2]/costs[1]-4)<1e-8,'doubling actual speed quadruples effort');
});

test('normal weather varies around the chosen biome rather than drifting into arbitrary global disasters',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    seedWorld(fallbackSpecies(1,1,1));state.chaos=0.55;Math.random=()=>0;
    const initial={...state.env};
    for(let i=0;i<300;i++)updateEnvironment(1);
    return Object.keys(envDefs).every(key=>Math.abs(state.envTarget[key]-initial[key])<=24*state.chaos+1e-8);
  })()`);
  assert.equal(result,true);
});

test('founders have food within perception range even in a large new world',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    state.worldSize=7200;seedWorld(fallbackSpecies(2,2,2));
    return state.creatures.filter(c=>getSpecies(c).class==='herbivore')
      .every(c=>state.resources.some(r=>dist(c,r)<bodyOf(c).vision));
  })()`);
  assert.equal(result,true);
});

test('predators delay reproduction with scarce prey and pay for a brood when food is plentiful',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    seedWorld(balanceInitialSpecies(fallbackSpecies(1,1,1)));
    state.creatures=[];state.resources=[];state.corpses=[];state.mutationRate=0;
    const hunter=spawnCreature(state.species.find(sp=>sp.class==='carnivore'),500,500,1);
    hunter.energy=hunter.maxEnergy;hunter.hungry=false;hunter.age=100;hunter.cooldown=0;
    Math.random=()=>0;rebuildSpatialIndexes();updateCreatures(0.1);
    const scarce=state.creatures.length;
    const herb=state.species.find(sp=>sp.class==='herbivore');
    for(let i=0;i<8;i++){const c=spawnCreature(herb,800+i*10,500,1);c.energy=c.maxEnergy;}
    hunter.energy=hunter.maxEnergy;hunter.cooldown=0;rebuildSpatialIndexes();
    const before=hunter.energy;updateCreatures(0.1);
    return {scarce,brood:state.creatures.filter(c=>getSpecies(c).class==='carnivore').length,
      paid:hunter.energy<before-bodyOf(hunter).birthCost+1};
  })()`);
  assert.equal(result.scarce,1);assert.equal(result.brood,2);assert.ok(result.paid);
});

test('weather baseline survives saving, manual changes, and legacy saves without adding reserves',()=>{
  const game=createGame();
  game.run('seedWorld(balanceInitialSpecies(fallbackSpecies(1,1,1)))');
  const input={dataset:{env:'light'},value:'31',nextElementSibling:{textContent:''}};
  game.listeners.get('envControls:input')({target:{closest:()=>input}});
  game.run('saveWorld();state.envBaseline.light=99;loadWorld()');
  assert.equal(game.run('state.envBaseline.light'),31);
  game.run(`(()=>{const saved=JSON.parse(localStorage.getItem('evo-save'));delete saved.envBaseline;
    saved.envTarget.light=17;localStorage.setItem('evo-save',JSON.stringify(saved));loadWorld();})()`);
  assert.equal(game.run('state.envBaseline.light'),17);
});

test('finite meals alone do not justify a brood when prey cannot renew themselves',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    seedWorld(balanceInitialSpecies(fallbackSpecies(1,1,1)));
    state.creatures=[];state.resources=[];state.corpses=[];
    const c=spawnCreature(state.species.find(sp=>sp.class==='carnivore'),500,500,1);
    c.energy=c.maxEnergy;
    state.corpses=[{id:'finite',x:520,y:500,amount:100,radius:15,toxicity:0}];
    const herb=state.species.find(sp=>sp.class==='herbivore');
    for(let i=0;i<8;i++){const prey=spawnCreature(herb,800+i*10,500,1);prey.energy=prey.maxEnergy;}
    rebuildSpatialIndexes();const before=c.energy+state.corpses[0].amount;
    const renewed=foodSupportsBrood(c,bodyOf(c));
    for(const prey of state.creatures)if(getSpecies(prey).class==='herbivore')prey.energy=prey.maxEnergy*0.2;
    rebuildSpatialIndexes();
    const depleted=foodSupportsBrood(c,bodyOf(c));
    return {renewed,depleted,unchanged:before===c.energy+state.corpses[0].amount};
  })()`);
  assert.ok(result.renewed && !result.depleted && result.unchanged);
});

for(const sample of [
  {name:'medium',profile:10001,seed:42,size:3600,counts:[2,2,2]},
  {name:'large',profile:11002,seed:7,size:7200,counts:[4,4,4]}
])test(`an unseen ${sample.name} food web renews animals beyond the founders without rescue`,()=>{
  const game=createGame({seed:sample.seed});
  const result=game.run(`(()=>{
    state.worldSize=${sample.size};
    seedWorld(balanceInitialSpecies(${JSON.stringify(freshSpecies(sample.profile,sample.counts))}),{balancedFounders:true});
    state.chaos=0.55;state.evolutionAiEnabled=false;
    const spawn=spawnCreature;let lateAnimalBirths=0,bounded=true;
    spawnCreature=(sp,...args)=>{if(sp.class!=='producer'&&state.day>600*0.018)lateAnimalBirths++;return spawn(sp,...args);};
    for(let i=0;i<7200;i++) {
      update(1/6);
      bounded &&= state.creatures.length<=MAX_CREATURES && state.resources.length<=MAX_RESOURCES
        && state.corpses.length<=MAX_CORPSES && state.species.length<=MAX_EVOLVED_SPECIES;
    }
    return {counts:countLivingClasses(),lateAnimalBirths,bounded,
      generation:Math.max(0,...state.creatures.map(c=>c.generation)),
      finite:state.creatures.every(c=>[c.x,c.y,c.health,c.energy,...Object.values(c.genes)].every(Number.isFinite))};
  })()`);
  assert.ok(result.counts.producer>0 && result.counts.herbivore>0);
  assert.ok(result.lateAnimalBirths>0 && result.generation>=3);
  assert.ok(result.bounded && result.finite);
});
