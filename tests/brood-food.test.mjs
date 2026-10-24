import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

function scene(herbivores=0,carnivores=1) {
  const g=createGame();
  g.run(`seedWorld(fallbackSpecies(1,1,1));state.creatures=[];state.resources=[];state.corpses=[];
    state.mutationRate=0;animalThink=()=>{};Math.random=()=>0.999999;
    window.preySpecies=state.species.find(sp=>sp.class==='herbivore');
    window.predatorSpecies=state.species.find(sp=>sp.class==='carnivore');
    for(let i=0;i<${herbivores};i++)spawnCreature(window.preySpecies,1000+i,1000,1,{...window.preySpecies.traits,fertility:0});
    for(let i=0;i<${carnivores};i++){
      const c=spawnCreature(window.predatorSpecies,500+i,500,1);
      c.age=100;c.cooldown=0;c.energy=c.maxEnergy;c.health=c.maxHealth;c.hungry=false;
    }
    rebuildSpatialIndexes();`);
  return g;
}

test('a ready predator waits without paying or restarting its clock when prey are scarce',()=>{
  const g=scene();
  const result=g.run(`(()=>{const c=state.creatures[0],energy=c.energy;
    state.corpses=[{id:'finite',x:500,y:500,amount:1000,radius:30,toxicity:0}];
    updateCreatures(0);return {count:state.creatures.length,energy:c.energy===energy,clock:c.cooldown};})()`);
  assert.equal(result.count,1);assert.ok(result.energy);assert.equal(result.clock,0);
});

test('the prospective child requires twelve living herbivores per carnivore',()=>{
  for(const [herbivores,expected] of [[23,1],[24,2]]) {
    const g=scene(herbivores);
    g.run('updateCreatures(0)');
    assert.equal(g.run('countLivingClasses().carnivore'),expected);
  }
  const g=scene(24);g.run('state.creatures[0].health=0;updateCreatures(0)');
  assert.equal(g.run('countLivingClasses().carnivore'),1);
});

test('simultaneous broods share one prey budget and only allowed parents pay',()=>{
  const g=scene(36,2);
  const result=g.run(`(()=>{const parents=state.creatures.filter(c=>getSpecies(c).class==='carnivore');
    updateCreatures(0);return {count:countLivingClasses().carnivore,
      first:parents[0].energy/parents[0].maxEnergy,second:parents[1].energy/parents[1].maxEnergy};})()`);
  assert.equal(result.count,3);assert.equal(result.first,0.75);assert.equal(result.second,1);
});

test('recovering prey unlocks one brood immediately, while waiting does not stop aging',()=>{
  const g=scene();
  const result=g.run(`(()=>{const p=state.creatures[0],remaining=lifeOf(p).remaining;
    updateCreatures(2);const aged=remaining-lifeOf(p).remaining;
    for(let i=0;i<24;i++)spawnCreature(window.preySpecies,1000+i,1000,1,{...window.preySpecies.traits,fertility:0});
    p.energy=p.maxEnergy;updateCreatures(0);const born=countLivingClasses().carnivore;
    p.energy=p.maxEnergy;updateCreatures(0);
    return {aged,born,again:countLivingClasses().carnivore,clock:p.cooldown,wait:bodyOf(p).birthWait};})()`);
  assert.ok(Math.abs(result.aged-2)<1e-8);assert.equal(result.born,2);assert.equal(result.again,2);
  assert.equal(result.clock,result.wait);
});

test('the inspector identifies waiting for prey and herbivores do not inherit that veto',()=>{
  const g=scene();
  const cells=Array.from({length:12},()=>({textContent:''}));
  g.element('selectionPanel').querySelectorAll=()=>cells;
  g.run('state.selected=state.creatures[0];updateSelection()');
  assert.equal(cells[10].textContent,'Espera presas');
  g.run(`state.creatures=[];const h=spawnCreature(window.preySpecies,500,500,1);
    h.age=100;h.cooldown=0;h.energy=h.maxEnergy;h.health=h.maxHealth;h.hungry=false;
    rebuildSpatialIndexes();updateCreatures(0)`);
  assert.equal(g.run('countLivingClasses().herbivore'),2);
});
