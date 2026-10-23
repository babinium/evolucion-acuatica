import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

test('an eight minute default ecosystem reproduces, branches and retains its food web', () => {
  const g=createGame({seed:123456});
  const result=g.run(`(() => {
    seedWorld(fallbackSpecies(1,1,1));state.chaos=0;
    let bounded=true;
    for(let i=0;i<2880;i++) {
      update(1/6);
      bounded &&= state.creatures.length<=MAX_CREATURES && state.resources.length<=MAX_RESOURCES
        && state.corpses.length<=MAX_CORPSES && state.species.length<=MAX_EVOLVED_SPECIES;
    }
    return {counts:countLivingClasses(),species:state.species.length,
      generation:Math.max(...state.creatures.map(c=>c.generation)),bounded,
      finite:state.creatures.every(c=>[c.x,c.y,c.vx,c.vy,c.energy,c.health,c.maxEnergy,c.tissue,...Object.values(c.genes)].every(Number.isFinite)),
      validWater:state.habitats.every(h=>h.stock>=0&&h.stock<=1&&Number.isFinite(h.oxygen))};
  })()`);
  assert.ok(Object.values(result.counts).every(n=>n>0));
  assert.ok(result.species>3);assert.ok(result.generation>=4);
  assert.ok(result.bounded && result.finite && result.validWater);
});

test('scarce light selects low metabolism instead of preserving both populations artificially', () => {
  const g=createGame();
  const result=g.run(`(() => {
    const traits={size:5,speed:0,attack:0,defense:5,perception:5,fertility:0,metabolism:0,foodEfficiency:5,toxicity:0};
    seedWorld([normalizeSpecies({id:'slow',class:'producer',traits}),
      normalizeSpecies({id:'fast',class:'producer',traits:{...traits,metabolism:10}})]);
    state.chaos=0;state.creatures=[];state.resources=[];
    state.env.light=state.envTarget.light=5;
    for(const sp of state.species)for(let i=0;i<12;i++) {
      const c=spawnCreature(sp,sp.id==='slow'?500:2500,500+i*20,1);c.energy=c.maxEnergy*0.7;
    }
    for(let i=0;i<1200;i++)update(0.25);
    return state.species.map(sp=>sp.population);
  })()`);
  assert.equal(result[0],12);assert.equal(result[1],0);
});

test('all environmental extremes remain finite and respect world bounds', () => {
  for(const key of ['temperature','light','oxygen','nutrients','toxicity','currents','algaeRate'])for(const value of [0,100]) {
    const g=createGame();
    const valid=g.run(`(() => {
      seedWorld(fallbackSpecies(1,1,1));state.chaos=0;state.env.${key}=state.envTarget.${key}=${value};
      for(let i=0;i<120;i++)update(0.25);
      return state.creatures.every(c=>[c.x,c.y,c.vx,c.vy,c.energy,c.health].every(Number.isFinite)
        &&c.x>=8&&c.y>=8&&c.x<=state.worldSize-8&&c.y<=state.worldSize-8)
        &&state.resources.every(r=>Number.isFinite(r.amount)&&r.amount>=0)
        &&state.habitats.every(h=>h.stock>=0&&h.stock<=1&&Number.isFinite(h.oxygen));
    })()`);
    assert.ok(valid,`${key}=${value}`);
  }
});
