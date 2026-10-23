import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './harness.mjs';

function world() {
  const game = createGame();
  game.run(`seedWorld(fallbackSpecies(1,1,1)); state.paused = true; state.creatures = []; state.resources = []; state.corpses = []; state.zones = [];
    spawnCreature(state.species[1], 500, 500, 1);
    spawnCreature(state.species[1], 1100, 500, 1);
    for (const c of state.creatures) { c.energy = 80; c.health = c.maxHealth; c.age = 0; }
    rebuildSpatialIndexes(); recalcSpecies(); state.toolRadius = 150;`);
  return game;
}

function cast(game, type, x = 500, y = 500) {
  return game.run(`state.activeTool = ${JSON.stringify(type)}; applyTool(${x}, ${y})`);
}

test('protection prevents catastrophe damage inside its area', () => {
  const game = world();
  cast(game, 'protect');
  const health = game.run('state.creatures[0].health');
  cast(game, 'disaster');
  assert.equal(game.run('state.creatures[0].health'), health);
});

test('protection applies to later arrivals for the lifetime of the zone', () => {
  const game = world();
  cast(game, 'protect');
  game.run('state.creatures[1].x = 500; state.creatures[0].x = 2000; rebuildSpatialIndexes()');
  const health = game.run('state.creatures[1].health');
  cast(game, 'disaster');
  assert.equal(game.run('state.creatures[1].health'), health);
});

test('catastrophe removes dead creatures and creates one corpse immediately in pause', () => {
  const game = world();
  game.run('state.creatures[0].health = 1');
  cast(game, 'disaster');
  assert.equal(game.run('state.creatures.length'), 1);
  assert.equal(game.run('state.corpses.length'), 1);
  cast(game, 'disaster');
  assert.equal(game.run('state.corpses.length'), 1);
});

test('clicking outside the world does not apply a power along the border', () => {
  const game = world();
  cast(game, 'nutrientBloom', -1000, 500);
  assert.equal(game.run('state.resources.length'), 0);
});

test('a power stays selected for repeated applications', () => {
  const game = world();
  cast(game, 'nutrientBloom');
  assert.equal(game.run('state.activeTool'), 'nutrientBloom');
  assert.ok(game.run('state.resources.length') > 0);
});

test('feeding restores animal energy only inside the brush and respects the cap', () => {
  const game = world();
  game.run('spawnCreature(state.species[0], 500, 500, 1); spawnCreature(state.species[2], 510, 500, 1); state.creatures[2].energy=80; state.creatures[3].energy=120; rebuildSpatialIndexes()');
  const result = cast(game, 'feed');
  assert.equal(result.affected, 2);
  assert.equal(game.run('state.creatures[0].energy'), game.run('Math.min(125,state.creatures[0].maxEnergy)'));
  assert.equal(game.run('state.creatures[1].energy'), 80);
  assert.equal(game.run('state.creatures[2].energy'), 80);
  assert.equal(game.run('state.creatures[3].energy'), game.run('Math.min(165,state.creatures[3].maxEnergy)'));
  for(let i=0;i<4;i++) cast(game, 'feed');
  assert.equal(game.run('state.creatures[0].energy'), game.run('state.creatures[0].maxEnergy'));
  assert.equal(cast(game, 'feed').ok, false);
});

test('clean water is local, persists in saves, and stops mitigating harm when it expires', () => {
  const game = world();
  game.run('state.env.oxygen = state.envTarget.oxygen = 0; state.env.toxicity = state.envTarget.toxicity = 100');
  cast(game, 'cleanse');
  const health = game.run('state.creatures[0].health');
  game.run('updateCreatures(1/30)');
  assert.equal(game.run('state.creatures[0].health'), health);
  assert.ok(game.run('state.creatures[1].health') < health);
  assert.equal(game.run('state.env.toxicity'), 100);
  assert.equal(game.run('state.env.oxygen'), 0);
  game.run('saveWorld(); state.zones = []; loadWorld()');
  assert.equal(game.run('localWater(state.creatures[0]).toxicity'), 20);
  game.run('updateZones(61); updateCreatures(1/30)');
  assert.ok(game.run('state.creatures[0].health') < health);
});

test('a shield blocks predation as well as environmental damage, and expires', () => {
  const game = world();
  game.run('spawnCreature(state.species[2], 505, 500, 1); state.creatures[2].energy=10; rebuildSpatialIndexes()');
  cast(game, 'protect');
  const health = game.run('state.creatures[0].health');
  game.run('hunt(state.creatures[2], state.species[2], 1/30)');
  assert.equal(game.run('state.creatures[0].health'), health);
  game.run('state.env.oxygen=0; state.env.toxicity=100; updateCreatures(1/30)');
  assert.equal(game.run('state.creatures[0].health'), health);
  game.run('updateZones(81)');
  cast(game, 'disaster');
  assert.equal(game.run('state.creatures[0].health'), health - 60);
});

test('favor uses an explicit species even without a selected individual, and spawns in the actual brush', () => {
  const game = world();
  const before = game.run('state.creatures.length');
  game.run('state.selected = null; favorSpeciesId = state.species[1].id');
  const result = cast(game, 'favor', 0, 0);
  assert.equal(result.ok, true);
  assert.equal(game.run('state.creatures.length'), before + result.affected);
  assert.equal(game.run(`state.creatures.slice(${before}).every(c => c.speciesId === state.species[1].id && c.x >= 8 && c.y >= 8 && Math.hypot(c.x,c.y) <= 150)`), true);
});

test('periodic favor refreshes do not rewrite an unchanged native selector', () => {
  const game=createGame();
  game.run('seedWorld(fallbackSpecies(1,1,1));selectTool("favor")');
  const select=game.element('favorSpecies');
  const writes=[];
  for(const property of ['value','disabled','innerHTML']) {
    let current=select[property];
    Object.defineProperty(select,property,{get(){return current;},set(value){writes.push(property);current=value;}});
  }
  game.run('for(let i=0;i<5;i++) updateSpeciesList()');
  assert.deepEqual(writes,[]);
});

test('a pending favor choice survives live list changes and commits before casting', () => {
  const game=createGame();
  game.run('seedWorld(fallbackSpecies(1,1,1));state.paused=true;selectTool("favor")');
  const select=game.element('favorSpecies');
  const target=game.run('state.species[2].id');
  const originalOptions=select.innerHTML;
  game.context.document.activeElement=select;
  // A native popup can highlight an option before its change event commits it.
  select.value=target;
  game.run('state.species[1].name="Nombre actualizado";updateSpeciesList()');
  assert.equal(select.value,target);
  assert.equal(select.innerHTML,originalOptions);
  game.listeners.get('favorSpecies:change')({target:select});
  game.context.document.activeElement=null;
  game.listeners.get('favorSpecies:blur')();
  assert.match(select.innerHTML,/Nombre actualizado/);
  assert.equal(select.value,target);
  const before=game.run('state.creatures.length');
  const result=game.run('applyTool(500,500)');
  assert.equal(result.ok,true);
  assert.equal(game.run(`state.creatures.slice(${before}).every(c=>c.speciesId===favorSpeciesId&&c.speciesId===state.species[2].id)`),true);
});

test('resource and population limits give honest feedback without overflowing', () => {
  const game = world();
  game.run('for(let i=0;i<MAX_RESOURCES;i++) spawnResource(1000,1000,40)');
  const result = cast(game, 'nutrientBloom');
  assert.equal(result.ok, false);
  assert.match(result.message, /Límite de algas/);
  assert.equal(game.run('state.resources.length'), 2400);
  game.run('while(state.creatures.length < MAX_CREATURES) spawnCreature(state.species[1],1000,1000,1); recalcSpecies(); favorSpeciesId=state.species[1].id;');
  assert.equal(cast(game, 'favor').ok, false);
  assert.equal(game.run('state.creatures.length'), 2400);
  game.run('state.creatures.pop(); recalcSpecies()');
  assert.equal(cast(game, 'favor').affected, 1);
  assert.equal(game.run('state.creatures.length'), 2400);
});

test('zones can be renewed but have a bounded total', () => {
  const game = world();
  game.run('state.toolRadius = 60');
  for (let i=0;i<12;i++) assert.equal(cast(game, 'cleanse', 200 + (i%4)*500, 200 + Math.floor(i/4)*500).ok, true);
  assert.equal(game.run('state.zones.length'), 12);
  assert.equal(cast(game, 'protect', 2000, 2000).ok, false);
  game.run('updateZones(10)');
  assert.equal(cast(game, 'cleanse', 200, 200).ok, true);
  assert.equal(game.run('state.zones.length'), 12);
  assert.equal(game.run('state.zones[0].ttl'), 60);
});

test('brush settings are remembered per power and single application is optional', () => {
  const game = world();
  game.run('selectTool("protect"); setToolRadius(380); selectTool("feed"); selectTool("protect")');
  assert.equal(game.run('state.toolRadius'), 380);
  game.run('setToolRadius(9999)');
  assert.equal(game.run('state.toolRadius'), 650);
  game.run('setToolRadius(NaN)');
  assert.equal(game.run('state.toolRadius'), 650);
  game.run('toolRepeat = false');
  cast(game, 'nutrientBloom');
  assert.equal(game.run('state.activeTool'), null);
  cast(game, 'feed', 3400, 3400);
  assert.equal(game.run('state.activeTool'), 'feed');
});

test('dragging pans the camera without casting, and right click cancels', () => {
  const game = world();
  game.run('selectTool("nutrientBloom")');
  const before = game.run('state.camera.x');
  game.listeners.get('world:pointerdown')({button:0, clientX:600, clientY:300});
  game.listeners.get('window:pointermove')({clientX:660, clientY:300});
  game.listeners.get('window:pointerup')();
  game.listeners.get('world:click')({button:0, clientX:660, clientY:300});
  assert.equal(game.run('state.resources.length'), 0);
  assert.notEqual(game.run('state.camera.x'), before);
  let prevented = false;
  game.listeners.get('world:contextmenu')({preventDefault() {prevented=true;}});
  assert.equal(game.run('state.activeTool'), null);
  assert.equal(prevented, true);
});

test('shortcuts do not activate powers while typing and the wheel can still zoom', () => {
  const game = world();
  const keydown = game.listeners.get('window:keydown');
  keydown({key:'6', target:{closest:() => ({})}});
  assert.equal(game.run('state.activeTool'), null);
  keydown({key:'6', target:{closest:() => null}, preventDefault() {}});
  assert.equal(game.run('state.activeTool'), 'cleanse');
  const wheel = game.listeners.get('world:wheel');
  const zoom = game.run('state.camera.zoom');
  const radius = game.run('state.toolRadius');
  wheel({clientX:600, clientY:300, deltaY:1, shiftKey:true, preventDefault() {}});
  assert.ok(game.run('state.camera.zoom') < zoom);
  assert.equal(game.run('state.toolRadius'), radius);
  wheel({clientX:600, clientY:300, deltaY:-1, shiftKey:false, preventDefault() {}});
  assert.equal(game.run('state.toolRadius'), radius + 20);
});
