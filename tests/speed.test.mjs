import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

test('speed buttons move by whole numbers between 1x and 10x',()=>{
  const game=createGame();
  for(let speed=2;speed<=10;speed++) {
    game.listeners.get('speedUp:click')();
    assert.equal(game.run('state.speed'),speed);
    assert.equal(game.element('speedLabel').textContent,`${speed}x`);
  }
  game.listeners.get('speedUp:click')();
  assert.equal(game.run('state.speed'),10);
  for(let speed=9;speed>=1;speed--) {
    game.listeners.get('speedDown:click')();
    assert.equal(game.run('state.speed'),speed);
    assert.equal(game.element('speedLabel').textContent,`${speed}x`);
  }
  game.listeners.get('speedDown:click')();
  assert.equal(game.run('state.speed'),1);
});

test('saves retain 10x while old fractional and invalid speeds are normalized',()=>{
  const game=createGame();
  game.run('seedWorld(fallbackSpecies(1,1,1));setSimulationSpeed(10);saveWorld();setSimulationSpeed(1);loadWorld()');
  assert.equal(game.run('state.speed'),10);
  assert.equal(game.element('speedLabel').textContent,'10x');
  const saved=JSON.parse(game.values.get('evo-save'));
  for(const [value,expected] of [[2.75,3],[99,10],[-5,1],['bad',1]]) {
    game.values.set('evo-save',JSON.stringify({...saved,speed:value}));
    game.run('loadWorld()');
    assert.equal(game.run('state.speed'),expected);
  }
});

test('10x advances twice as much as 5x using the same safe ecological steps',()=>{
  function simulate(speed,frames) {
    const game=createGame();
    return game.run(`(()=>{
      seedWorld(fallbackSpecies(1,1,1));state.chaos=0;setSimulationSpeed(${speed});
      for(let i=0;i<${frames};i++) update(1/30);
      return JSON.stringify({day:state.day,creatures:state.creatures,resources:state.resources,
        corpses:state.corpses,species:state.species,habitats:state.habitats});
    })()`);
  }
  assert.ok(simulate(10,180)===simulate(5,360),'10x and twice as many 5x frames must produce the same world');
});

test('10x leaves the camera speed and pause unchanged and keeps population bounds',()=>{
  const game=createGame();
  const result=game.run(`(()=>{
    seedWorld(fallbackSpecies(1,1,1));setSimulationSpeed(10);state.chaos=0;
    for(let i=0;i<180;i++)update(1/30);
    state.paused=true;keys.add('d');
    const x=state.camera.x,day=state.day;update(1/30);
    const fastPan=state.camera.x-x;
    setSimulationSpeed(1);const slowX=state.camera.x;update(1/30);
    return {sameCamera:Math.abs(fastPan-(state.camera.x-slowX))<1e-8,
      paused:state.day===day,day,
      bounded:state.creatures.length<=MAX_CREATURES && state.species.length<=MAX_EVOLVED_SPECIES
        && state.resources.length<=MAX_RESOURCES && state.corpses.length<=MAX_CORPSES,
      finite:state.creatures.every(c=>[c.x,c.y,c.health,c.energy,...Object.values(c.genes)].every(Number.isFinite))};
  })()`);
  assert.ok(Math.abs(result.day-60*0.018)<1e-10);
  assert.ok(result.sameCamera && result.paused && result.bounded && result.finite);
});
