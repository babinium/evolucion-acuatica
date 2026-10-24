import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

function feedingScene() {
  const game=createGame();
  game.run(`seedWorld(fallbackSpecies(1,1,1));state.chaos=0;state.mutationRate=0;
    state.creatures=[];state.resources=[];state.corpses=[];state.zones=[];
    state.species=[normalizeSpecies({id:'grazer',class:'herbivore',traits:{size:5,speed:5,defense:3,
      perception:5,fertility:10,metabolism:5,foodEfficiency:8,toxicity:0}}),
      normalizeSpecies({id:'plant',class:'producer',traits:{size:5,defense:0,toxicity:0}})];
    rebuildSpeciesIndex();window.grazer=spawnCreature(state.species[0],500,500,1);
    window.grazer.energy=1;window.grazer.cooldown=999;`);
  return game;
}

for(const kind of ['alga','producer'])test(`a hungry grazer takes a small reachable ${kind} meal without eating its roots`,()=>{
  const game=feedingScene();
  const result=game.run(`(()=>{
    const c=window.grazer;
    ${kind==='alga' ? "spawnResource(500,500,8);const food=state.resources[0];"
      : "const food=spawnCreature(state.species[1],500,500,1),body=bodyOf(food);food.energy=body.rootReserve+7;food.tissue=body.holdfast;"}
    rebuildSpatialIndexes();const available=edibleFood(food,'${kind}'),before=c.energy;
    const brain=sense(c,getSpecies(c),0,true),chosen=brain.target===food;
    animalThink(c,getSpecies(c),0.5);
    return {chosen,gain:c.energy-before,spent:available-edibleFood(food,'${kind}'),
      assimilation:bodyOf(c).assimilation,roots:${kind==='alga' ? 'food.amount>=food.root' : 'food.energy>=bodyOf(food).rootReserve && food.tissue>=bodyOf(food).holdfast'}};
  })()`);
  assert.ok(result.chosen && result.gain>0,'reachable food is used instead of aimless exploration');
  assert.ok(Math.abs(result.gain-result.spent*result.assimilation)<1e-8);
  assert.ok(result.roots && result.spent>0 && result.spent<=7.36);
});

test('a grazer with critical reserves eats a reachable snack before travelling to a rich patch',()=>{
  const game=feedingScene();
  const result=game.run(`(()=>{
    spawnResource(500,500,8);spawnResource(700,500,160);rebuildSpatialIndexes();
    const c=window.grazer,before=c.energy;
    const first=sense(c,getSpecies(c),0,true).target===state.resources[0];
    animalThink(c,getSpecies(c),10);
    const second=sense(c,getSpecies(c),0,true).target===state.resources[1];
    return {first,second,gain:c.energy-before,edible:edibleFood(state.resources[0],'alga')};
  })()`);
  assert.ok(result.first && result.second,'snack first, then leave the inedible holdfast');
  assert.ok(result.gain>0 && result.edible<1e-8);
});

test('grazers still reject distant scraps and move on from sub-bite regrowth',()=>{
  const game=feedingScene();
  const result=game.run(`(()=>{
    const c=window.grazer;
    spawnResource(500,500,80);state.resources[0].amount=state.resources[0].root+0.5;
    spawnResource(600,500,8);spawnResource(800,500,80);rebuildSpatialIndexes();
    return sense(c,getSpecies(c),0,true).target===state.resources[2];
  })()`);
  assert.ok(result,'tiny regrowth cannot keep a hungry grazer camping on stripped roots');
});

test('a satiated grazer rests without grazing even on an accessible snack',()=>{
  const game=feedingScene();
  const result=game.run(`(()=>{
    const c=window.grazer;c.energy=c.maxEnergy;c.hungry=false;
    spawnResource(500,500,8);rebuildSpatialIndexes();const before=state.resources[0].amount;
    animalThink(c,getSpecies(c),0.5);
    return {state:c.state,unchanged:state.resources[0].amount===before};
  })()`);
  assert.equal(result.state,'saciado');assert.ok(result.unchanged);
});

function chaseSpeed(reserves,kind='herbivore') {
  const game=createGame();
  return game.run(`(()=>{
    seedWorld(fallbackSpecies(1,1,1));state.creatures=[];state.resources=[];state.corpses=[];
    const sp=state.species.find(s=>s.class==='carnivore'),c=spawnCreature(sp,500,500,1);
    const prey=spawnCreature(state.species.find(s=>s.class==='${kind==='corpse'?'herbivore':kind}'),700,500,1);
    const target=${kind==='corpse' ? "{x:700,y:500,amount:80,radius:15,toxicity:0}" : 'prey'};
    c.energy=c.maxEnergy*${reserves};c.hungry=true;c.activity=1;
    const before=c.energy,health=target.health;
    hunt(c,sp,0.2,{kind:'${kind==='corpse'?'corpse':'prey'}',target});
    return {multiplier:c.vx/(bodyOf(c).speed/58*(1-Math.exp(-0.8))),
      energyUnchanged:c.energy===before,healthUnchanged:target.health===health};
  })()`);
}

test('herbivore pursuit slows continuously below 25% reserves instead of losing its boost in one step',()=>{
  const above=chaseSpeed(0.25001),below=chaseSpeed(0.24999),half=chaseSpeed(0.125),empty=chaseSpeed(0);
  assert.ok(above.multiplier-below.multiplier<0.0001,'crossing 25% must not abruptly lose one sixth of chase speed');
  assert.ok(Math.abs(above.multiplier-1.2)<1e-8);
  assert.ok(Math.abs(half.multiplier-1.1)<1e-8);
  assert.ok(Math.abs(empty.multiplier-1)<1e-8);
  assert.ok(above.energyUnchanged && below.energyUnchanged && half.energyUnchanged && empty.energyUnchanged);
});

test('the pursuit boost stays bounded as reserves fall and never accelerates emergency cannibalism or carrion travel',()=>{
  const speeds=[-0.1,0,0.05,0.125,0.2,0.25,0.5,0.75].map(e=>chaseSpeed(e).multiplier);
  assert.ok(speeds.every(s=>s>=1-1e-8 && s<=1.2+1e-8));
  assert.ok(speeds.every((s,i)=>i===0 || s>=speeds[i-1]-1e-8));
  for(const kind of ['carnivore','corpse']) {
    const result=chaseSpeed(0.125,kind);
    assert.ok(Math.abs(result.multiplier-1)<1e-8);
    assert.ok(result.energyUnchanged && result.healthUnchanged,'travelling never grants food or attack damage');
  }
});
