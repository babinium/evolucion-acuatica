import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

function family({fertility=10,type='carnivore'}={}) {
  const game=createGame();
  game.run(`seedWorld(fallbackSpecies(1,1,1));state.chaos=0;state.mutationRate=0;
    state.creatures=[];state.resources=[];state.corpses=[];
    state.species=[normalizeSpecies({id:'hunter',class:'${type}',traits:{size:5,speed:8,attack:6,defense:3,
      perception:6,fertility:${fertility},metabolism:4,foodEfficiency:8,toxicity:0}})];
    rebuildSpeciesIndex();window.parent=spawnCreature(state.species[0],500,500,1);
    window.parent.age=100;window.parent.cooldown=0;window.parent.hungry=false;
    window.parent.energy=window.parent.maxEnergy*0.75;window.parent.health=window.parent.maxHealth*0.55;
    animalThink=()=>{};rebuildSpatialIndexes();Math.random=()=>0.999999;`);
  return game;
}

for(const type of ['carnivore','herbivore'])test(`${type} birth accepts exact 55/75 thresholds, costs 25% maximum and grants child 75%`,()=>{
  const game=family({type});
  const result=game.run(`(()=>{const p=window.parent,before=p.energy;updateCreatures(0);
    const child=state.creatures[1];return {count:state.creatures.length,spent:(before-p.energy)/p.maxEnergy,
      newborn:child?.energy/child?.maxEnergy,cooldown:p.cooldown,wait:bodyOf(p).birthWait,
      childAge:child?.age,firstWait:child?.cooldown,childWait:child?bodyOf(child).birthWait:0,parentId:child?.parentCreatureId,parent:p.id};})()`);
  assert.equal(result.count,2);assert.equal(result.spent,0.25);assert.equal(result.newborn,0.75);
  assert.equal(result.cooldown,result.wait);assert.equal(result.childAge,0);assert.equal(result.parentId,result.parent);
  assert.equal(result.firstWait,result.childWait);
});

for(const [health,energy] of [[0.5499,0.75],[0.55,0.7499]])test(`both health and energy are required (${health},${energy})`,()=>{
  const game=family();game.run(`window.parent.health=window.parent.maxHealth*${health};window.parent.energy=window.parent.maxEnergy*${energy};updateCreatures(0)`);
  assert.equal(game.run('state.creatures.length'),1);assert.equal(game.run('window.parent.cooldown'),0);
});

test('ready parents wait for reserves, reproduce immediately and never accumulate pending births',()=>{
  const game=family();
  const result=game.run(`(()=>{
    const p=window.parent;p.energy=p.maxEnergy*0.7;
    for(let i=0;i<30;i++)updateCreatures(0);const waiting=state.creatures.length;
    p.energy=p.maxEnergy*0.75;updateCreatures(0);const first=state.creatures.length;
    p.energy=p.maxEnergy;updateCreatures(0);const repeated=state.creatures.length;
    p.cooldown=0;p.energy=p.maxEnergy*0.75;updateCreatures(0);
    return {waiting,first,repeated,last:state.creatures.length};})()`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{waiting:1,first:2,repeated:2,last:3});
});

test('fertility sets the interval, zero is sterile and immature newborns cannot reproduce',()=>{
  const slow=family({fertility:5}),fast=family({fertility:20}),sterile=family({fertility:0});
  slow.run('updateCreatures(0)');fast.run('updateCreatures(0)');sterile.run('updateCreatures(0)');
  assert.ok(slow.run('window.parent.cooldown')>fast.run('window.parent.cooldown'));
  assert.equal(sterile.run('state.creatures.length'),1);
  fast.run('window.parent.age=0;window.parent.energy=window.parent.maxEnergy;window.parent.cooldown=0;updateCreatures(0)');
  assert.equal(fast.run('state.creatures.length'),2);
});

test('vegetation does not sterilize a fed herbivore and its offspring receive the divine reserve',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    seedWorld(fallbackSpecies(1,1,1));state.creatures=[];state.resources=[];state.corpses=[];state.mutationRate=0;
    const herb=state.species.find(s=>s.class==='herbivore'),plant=state.species.find(s=>s.class==='producer');
    const p=spawnCreature(herb,500,500,1);p.age=100;p.energy=p.maxEnergy;p.health=p.maxHealth;p.cooldown=0;p.hungry=false;
    for(let i=0;i<15;i++)spawnCreature(plant,500+i,500,1);rebuildSpatialIndexes();Math.random=()=>0;
    updateCreatures(0.1);const renewed=state.creatures.filter(c=>getSpecies(c).class==='herbivore').length;
    for(let i=0;i<12;i++)spawnCreature(herb,500+i,500,1);rebuildSpatialIndexes();
    return {renewed,ratio:state.creatures.find(c=>c.parentCreatureId===p.id)?.energy/p.maxEnergy};})()`);
  assert.equal(result.renewed,2);assert.equal(result.ratio,0.75);
});

test('renewal estimates and plants crowding a hunter do not veto an otherwise ready brood',()=>{
  const game=family();
  const result=game.run(`(()=>{const plant=normalizeSpecies({id:'plants',class:'producer'});state.species.push(plant);rebuildSpeciesIndex();
    for(let i=0;i<15;i++)spawnCreature(plant,500+i,500,1);rebuildSpatialIndexes();
    updateCreatures(0);return state.creatures.filter(c=>getSpecies(c).class==='carnivore').length;})()`);
  assert.equal(result,2);
});

function huntScene() {
  const game=createGame();
  game.run(`seedWorld(fallbackSpecies(1,1,2));state.creatures=[];state.resources=[];state.corpses=[];
    window.hunter=spawnCreature(state.species.find(s=>s.class==='carnivore'),500,500,1);
    window.rival=spawnCreature(state.species.filter(s=>s.class==='carnivore')[1],510,500,1);
    window.hunter.energy=window.hunter.maxEnergy*0.25;window.hunter.cooldown=999;
    window.rival.energy=window.rival.maxEnergy;window.rival.cooldown=999;
    rebuildSpatialIndexes();`);
  return game;
}

test('carnivores hunt rivals only at 25% energy or less; injury alone is not hunger',()=>{
  const game=huntScene();
  const result=game.run(`(()=>{const c=window.hunter,sp=getSpecies(c);
    const extreme=sense(c,sp,0,true).target===window.rival;
    c.energy=c.maxEnergy*0.251;c.health=c.maxHealth*0.1;
    const injured=sense(c,sp,0,true).target;
    c.energy=c.maxEnergy*0.25;c.health=c.maxHealth;
    const before=window.rival.health,brain=sense(c,sp,0,true);hunt(c,sp,0.1,brain);const after=window.rival.health;
    c.energy=c.maxEnergy*0.5;hunt(c,sp,0.1,brain);
    return {extreme,injured:!!injured,bitten:after<before,stopped:after===window.rival.health};})()`);
  assert.ok(result.extreme && !result.injured && result.bitten);
  assert.ok(result.stopped);
});

test('even starving hunters prefer a visible herbivore over a nearby rival',()=>{
  const game=huntScene();
  game.run(`window.prey=spawnCreature(state.species.find(s=>s.class==='herbivore'),700,500,1);rebuildSpatialIndexes()`);
  assert.equal(game.run('sense(window.hunter,getSpecies(window.hunter),0,true).target===window.prey'),true);
});

test('available carrion prevents emergency attacks on living carnivores',()=>{
  const game=huntScene();
  game.run("state.corpses=[{id:'meal',x:650,y:500,amount:80,radius:15,toxicity:0}];rebuildSpatialIndexes()");
  assert.equal(game.run("sense(window.hunter,getSpecies(window.hunter),0,true).kind"),'corpse');
});

test('a useful nearby carcass is eaten before killing another herbivore',()=>{
  const game=huntScene();
  game.run(`window.prey=spawnCreature(state.species.find(s=>s.class==='herbivore'),520,500,1);
    window.prey.energy=window.prey.maxEnergy;
    state.corpses=[{id:'meal',x:750,y:500,amount:80,radius:15,toxicity:0}];rebuildSpatialIndexes()`);
  assert.equal(game.run("sense(window.hunter,getSpecies(window.hunter),0,true).kind"),'corpse');
});

test('hungry carnivores smell carrion beyond visual range without expanding their prey detection',()=>{
  const game=huntScene();
  const result=game.run(`(()=>{
    const c=window.hunter,vision=bodyOf(c).vision;c.energy=c.maxEnergy*0.5;
    state.corpses=[{id:'scent',x:c.x+vision*1.5,y:c.y,amount:80,radius:15,toxicity:0}];
    rebuildSpatialIndexes();const brain=sense(c,getSpecies(c),0,true);
    return {kind:brain.kind,id:brain.target?.id,vision:bodyOf(c).vision,original:vision};})()`);
  assert.equal(result.kind,'corpse');assert.equal(result.id,'scent');assert.equal(result.vision,result.original);
});

test('a distant carcass does not pull a hunter away from an immediately reachable herbivore',()=>{
  const game=huntScene();
  const result=game.run(`(()=>{const c=window.hunter;c.energy=c.maxEnergy*0.5;
    const prey=spawnCreature(state.species.find(s=>s.class==='herbivore'),550,500,1);prey.energy=prey.maxEnergy;
    state.corpses=[{id:'distant',x:c.x+bodyOf(c).vision*1.5,y:500,amount:30,radius:10,toxicity:0}];
    rebuildSpatialIndexes();return sense(c,getSpecies(c),0,true).target===prey;})()`);
  assert.ok(result);
});

test('a parent cannot hunt its immature descendant even after genetic divergence',()=>{
  const game=huntScene();
  game.run('window.rival.parentCreatureId=window.hunter.id;window.rival.age=0');
  assert.equal(game.run('!!sense(window.hunter,getSpecies(window.hunter),0,true).target'),false);
});

test('last-resort predation also applies to unrelated adults of the same carnivore species',()=>{
  const game=huntScene();
  game.run('window.rival.speciesId=window.hunter.speciesId;window.rival.age=100;rebuildSpatialIndexes()');
  assert.equal(game.run('sense(window.hunter,getSpecies(window.hunter),0,true).target===window.rival'),true);
});

test('saving a hungry parent preserves energy, cooldown, parentage and the new birth rule',()=>{
  const game=family();
  const result=game.run(`(()=>{updateCreatures(0);const child=state.creatures[1];state.selected=child;
    window.parent.cooldown=37;saveWorld();loadWorld();const p=state.creatures.find(c=>c.id===window.parent.id);
    return {energy:p.energy/p.maxEnergy,cooldown:p.cooldown,newborn:state.selected.energy/state.selected.maxEnergy,
      parent:state.selected.parentCreatureId===p.id,cost:bodyOf(p).birthCost/p.maxEnergy};})()`);
  assert.equal(result.energy,0.5);assert.equal(result.cooldown,37);assert.equal(result.newborn,0.75);
  assert.ok(result.parent);assert.equal(result.cost,0.25);
});

test('the divine reserve is based on the newborn capacity even after a size mutation',()=>{
  const game=family();
  const result=game.run(`(()=>{inheritGenes=p=>({...p.genes,size:9});updateCreatures(0);
    return {ratio:state.creatures[1].energy/state.creatures[1].maxEnergy,
      childMax:state.creatures[1].maxEnergy,parentMax:window.parent.maxEnergy};})()`);
  assert.equal(result.ratio,0.75);assert.notEqual(result.childMax,result.parentMax);
});

test('queued divine births respect the population cap and only successful parents pay',()=>{
  const game=family();
  const result=game.run(`(()=>{
    const first=window.parent,sp=state.species[0];first.energy=first.maxEnergy;
    const second=spawnCreature(sp,700,500,1);second.age=100;second.cooldown=0;second.energy=second.maxEnergy;
    for(let i=state.creatures.length;i<MAX_CREATURES-1;i++) {
      const c=spawnCreature(sp,900,900,1,{...sp.traits,fertility:0});c.cooldown=999;
    }
    rebuildSpatialIndexes();updateCreatures(0);
    return {count:state.creatures.length,cap:MAX_CREATURES,first:first.energy/first.maxEnergy,
      second:second.energy/second.maxEnergy};})()`);
  assert.equal(result.count,result.cap);assert.equal(result.first,0.75);assert.equal(result.second,1);
});
