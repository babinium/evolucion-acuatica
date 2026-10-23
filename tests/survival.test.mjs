import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createGame} from './harness.mjs';

const ecosystems=JSON.parse(readFileSync(new URL('./fixtures/ai-ecosystems.json',import.meta.url),'utf8'));
function colony() {
  const game=createGame();
  game.run(`seedWorld(${JSON.stringify(ecosystems[0].species)});state.chaos=0;state.mutationRate=0;
    state.creatures=[];state.resources=[];state.corpses=[];state.zones=[];
    window.plant=spawnCreature(state.species[0],500,500,1);
    window.grazer=spawnCreature(state.species[1],500,500,1);
    window.plant.energy=100;window.grazer.energy=10;rebuildSpatialIndexes();`);
  return game;
}

test('grazed roots retain finite reserves, cease being food and still pay maintenance',()=>{
  const game=colony();
  const result=game.run(`(()=>{
    const plant=window.plant,grazer=window.grazer;
    const before=plant.energy+plant.tissue+grazer.energy;
    eatProducer(grazer,getSpecies(grazer),100);
    const reserve=plant.energy,edible=edibleFood(plant,'producer');
    const after=plant.energy+plant.tissue+grazer.energy;
    spawnResource(600,500,80);rebuildSpatialIndexes();
    const target=sense(grazer,getSpecies(grazer),0,true).target;
    state.env.light=0;refreshWater();updateCreatures(1);
    const spent=plant.energy<reserve;
    damageCreature(plant,plant.maxHealth);
    return {reserve,edible,after,before,spent,movedOn:target===state.resources[0],canDie:plant.health===0};
  })()`);
  assert.ok(result.reserve>0,'roots keep a reserve instead of being drained to zero');
  assert.ok(result.edible<1e-8,'reserved energy is not advertised as another meal');
  assert.ok(result.after<=result.before+1e-8,'grazing never creates food energy');
  assert.ok(result.spent && result.movedOn && result.canDie);
});

test('plants can bud from moderate reserves and every offspring is paid for',()=>{
  const game=colony();
  const result=game.run(`(()=>{
    state.creatures=[window.plant];rebuildSpatialIndexes();
    const parent=window.plant;parent.energy=parent.maxEnergy*0.5;parent.health=parent.maxHealth*0.5;
    parent.cooldown=0;parent.age=100;state.env.light=0;refreshWater();Math.random=()=>0;
    const before=parent.energy+parent.tissue;updateCreatures(0.1);
    return {count:state.creatures.length,before,after:state.creatures.reduce((s,c)=>s+c.energy+c.tissue,0),
      childAge:state.creatures[1]?.age,parentEnergy:parent.energy};
  })()`);
  assert.equal(result.count,2);
  assert.ok(result.after<result.before,'the parent pays reserves, tissue and reproductive overhead');
  assert.ok(result.parentEnergy>0);assert.equal(result.childAge,0);
});

test('darkness can extinguish a fertile colony and extinction never triggers a rescue',()=>{
  const game=colony();
  const result=game.run(`(()=>{
    state.creatures=[window.plant];rebuildSpatialIndexes();
    state.env.light=state.envTarget.light=0;state.env.algaeRate=state.envTarget.algaeRate=0;
    for(let i=0;i<3600;i++)update(1/6);
    const extinct=state.creatures.length;
    for(let i=0;i<1200;i++)update(1/6);
    return {extinct,later:state.creatures.length};
  })()`);
  assert.equal(result.extinct,0);assert.equal(result.later,0);
});

test('initial hunters share the prey budget without rewriting genes or imposing a later population ratio',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    const species=fallbackSpecies(1,1,4),genes=JSON.stringify(species.map(sp=>sp.traits));
    seedWorld(species);
    const counts=countLivingClasses(),hunters=state.species.filter(sp=>sp.class==='carnivore');
    const represented=hunters.every(sp=>sp.population>0);
    for(let i=0;i<3;i++)spawnCreature(hunters[0],500,500,1);
    return {counts,represented,later:countLivingClasses().carnivore,
      unchanged:JSON.stringify(state.species.map(sp=>sp.traits))===genes};
  })()`);
  assert.equal(result.counts.herbivore,24);assert.equal(result.counts.carnivore,4);
  assert.ok(result.represented && result.unchanged);
  assert.equal(result.later,7,'the initial budget never caps the evolving hunter population');
});

test('hunters can go extinct while plants survive and prey-free food stays unusable to them',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    seedWorld(fallbackSpecies(1,0,1));state.chaos=0;state.mutationRate=0;
    for(const c of state.creatures)if(getSpecies(c).class==='carnivore')c.energy=1;
    for(let i=0;i<1800;i++)update(1/6);
    return countLivingClasses();
  })()`);
  assert.equal(result.carnivore,0);assert.ok(result.producer>0);
});

test('loading a depleted plant preserves its energy, injuries, genes and reproductive cooldown',()=>{
  const game=colony();
  const result=game.run(`(()=>{
    const plant=window.plant;plant.energy=plant.maxEnergy*0.1;plant.health=plant.maxHealth*0.3;plant.cooldown=22;
    state.selected=plant;const before={energy:plant.energy,health:plant.health,genes:JSON.stringify(plant.genes)};
    saveWorld();loadWorld();const loaded=state.selected;
    return {before,energy:loaded.energy,health:loaded.health,genes:JSON.stringify(loaded.genes),
      cooldown:loaded.cooldown,reserve:bodyOf(loaded).rootReserve};
  })()`);
  assert.equal(result.energy,result.before.energy);assert.ok(Math.abs(result.health-result.before.health)<1e-8);
  assert.equal(result.genes,result.before.genes);assert.equal(result.cooldown,22);
  assert.ok(result.energy<result.reserve,'loading grants no free root reserve or survival bonus');
});

test('the diagnosed AI food web renews producers beyond the original cohorts',()=>{
  const game=createGame({seed:123456});
  const result=game.run(`(()=>{
    seedWorld(${JSON.stringify(ecosystems[0].species)});state.chaos=0;
    let lateBirths=0,bounded=true;
    const originalSpawn=spawnCreature;
    spawnCreature=(sp,...args)=>{if(sp.class==='producer' && state.day>=1200*0.018)lateBirths++;return originalSpawn(sp,...args);};
    for(let i=0;i<10800;i++){
      update(1/6);
      bounded &&= state.creatures.length<=MAX_CREATURES && state.species.length<=MAX_EVOLVED_SPECIES
        && state.resources.length<=MAX_RESOURCES && state.corpses.length<=MAX_CORPSES;
    }
    return {producers:countLivingClasses().producer,lateBirths,bounded,
      generation:Math.max(0,...state.creatures.filter(c=>getSpecies(c).class==='producer').map(c=>c.generation)),
      finite:state.creatures.every(c=>[c.x,c.y,c.health,c.energy,...Object.values(c.genes)].every(Number.isFinite))};
  })()`);
  assert.ok(result.producers>0,'the low-defense AI colony can renew itself under ordinary grazing');
  assert.ok(result.lateBirths>0 && result.generation>=3,'survivors come from renewed generations');
  assert.ok(result.bounded && result.finite);
});
