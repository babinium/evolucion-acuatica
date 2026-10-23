import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './harness.mjs';

test('a complete world starts without credentials or generation requests', async () => {
  const calls = [];
  const game = createGame({fetch: async url => {calls.push(url); return {ok: true, json: async () => ({missing: [], canUseAiImages: false, canUseAiText: false})};}});
  await game.run('startWorld(false)');
  assert.equal(game.run('state.started'), true);
  assert.equal(game.run('state.creatures.length'), 70);
  assert.equal(calls.some(url => url.includes('generate-')), false);
});

test('loading a save reconnects the selected creature and species indexes', () => {
  const game = createGame();
  game.run('seedWorld(fallbackSpecies(1, 1, 1)); state.selected = state.creatures[10]');
  game.listeners.get('saveBtn:click')();
  game.run('state.creatures = []; state.species = []; state.selected = null');
  game.listeners.get('loadBtn:click')();
  assert.equal(game.run('state.creatures.includes(state.selected)'), true);
  assert.equal(game.run('getSpecies(state.selected).id === state.selected.speciesId'), true);
});

test('camera controls remain usable while the ecosystem is paused', () => {
  const game = createGame();
  game.run('seedWorld(fallbackSpecies(1, 1, 0)); state.paused = true; keys.add("d")');
  const before = game.run('state.camera.x');
  game.run('update(1/30)');
  assert.ok(game.run('state.camera.x') > before);
  assert.equal(game.run('state.day'), 0);
});

test('natural resources stay bounded during long games', () => {
  const game = createGame();
  game.run('state.resources = []; for (let i = 0; i < 20000; i++) spawnResource(5, 5, 50)');
  assert.ok(game.run('state.resources.length') <= 2400);
});

test('spatial searches match brute force near edges and after crossing a cell', () => {
  const game = createGame();
  assert.equal(game.run(`(() => {
    const grid = new SpatialGrid(64);
    const items = Array.from({length: 250}, (_,id) => ({id, x: rand(-100, 600), y: rand(-100, 600)}));
    grid.rebuild(items);
    function matches(x,y,r) {
      const actual = [...grid.query(x,y,r)].map(c => c.id).sort((a,b) => a-b).join(',');
      const expected = items.filter(c => (c.x-x)**2 + (c.y-y)**2 <= r*r).map(c => c.id).sort((a,b) => a-b).join(',');
      return actual === expected;
    }
    if (![0,1,63,64,250,1000].every(r => matches(0,0,r) && matches(255,256,r))) return false;
    const item = items[0]; const x = item.x, y = item.y;
    item.x = 550; item.y = 550; grid.move(item,x,y);
    if (!matches(550,550,100)) return false;
    items.pop(); grid.rebuild(items);
    return matches(550,550,1000);
  })()`), true);
});

test('spatial reproduction counts track quadrant crossings', () => {
  const game = createGame();
  assert.equal(game.run(`(() => {
    seedWorld(fallbackSpecies(1,1,1));
    for (let i=0;i<12;i++) update(1/30);
    return state.creatures.every(c => {
      const expected = state.creatures.filter(o => o.speciesId === c.speciesId && quadrantKey(o.x,o.y,o.speciesId) === quadrantKey(c.x,c.y,c.speciesId)).length;
      return sameSpeciesInQuadrant(c) === expected;
    });
  })()`), true);
});

test('hidden tabs do not catch up simulation time or keep requesting frames', () => {
  const game = createGame();
  game.run('seedWorld(fallbackSpecies(1,1,0)); document.hidden = true');
  game.listeners.get('document:visibilitychange')();
  game.run('loop(600000)');
  assert.equal(game.run('state.day'), 0);
  assert.equal(game.run('frameRequest'), 0);
});

test('population cap also applies to manual population boosts', () => {
  const game = createGame();
  game.run('seedWorld(fallbackSpecies(1,1,0)); for (let i=0;i<5000;i++) spawnCreature(state.species[0],0,0,1)');
  assert.equal(game.run('state.creatures.length'), 2400);
  assert.equal(game.run('state.creatures.every(c => c.x >= 8 && c.y >= 8)'), true);
});

test('render quality changes do not change ecosystem time or outcomes', () => {
  const eco = createGame();
  const detail = createGame();
  const setup = 'seedWorld(fallbackSpecies(1,1,1)); state.mutationRate=0;';
  eco.run(setup + 'setQuality("eco"); for(let i=0;i<90;i++) update(1/30)');
  detail.run(setup + 'setQuality("quality"); for(let i=0;i<90;i++) update(1/30)');
  assert.equal(eco.run('state.day'), detail.run('state.day'));
  assert.equal(eco.run('JSON.stringify(state.creatures)'), detail.run('JSON.stringify(state.creatures)'));
});

test('invalid AI trait values cannot put NaN or Infinity into the simulation', () => {
  const game = createGame();
  assert.equal(game.run(`(() => {
    const sp = normalizeSpecies({name: 123, class: "unknown", traits: {size: "bad", speed: Infinity, fertility: null}});
    return sp.class === "herbivore" && typeof sp.name === "string" && Object.values(sp.traits).every(Number.isFinite);
  })()`), true);
});

test('a failed image provider still leaves a playable AI species world', async () => {
  const calls = [];
  const game = createGame({fetch: async url => {
    calls.push(url);
    if (url === '/api/config-status') return {ok: true, json: async () => ({missing: [], canUseAiImages: true, canUseAiText: true})};
    if (url === '/api/generate-species') return {ok: true, json: async () => ({species: [{name: 'Alga', class: 'producer', traits: {}}, {name: 'Pez', class: 'herbivore', traits: {}}]})};
    return {ok: false, status: 401, json: async () => ({error: 'Google: invalid key'})};
  }});
  await game.run('startWorld(true, true)');
  assert.equal(game.run('state.started'), true);
  assert.ok(game.run('state.creatures.length') > 0);
  assert.equal(calls.filter(url => url === '/api/generate-images').length, 1);
  assert.match(game.run('state.lastEvent'), /dibujos locales/);
  assert.equal(game.run('state.species.every(sp=>sp.artworkError.includes("invalid key"))'),true);
  game.run('state.selected=state.creatures[0]; updateSelection()');
  assert.match(game.element('selectionPanel').innerHTML,/Ilustración no disponible: Google: invalid key/);
});

test('keyboard movement works after focusing the pause button', () => {
  const game = createGame();
  game.run('seedWorld(fallbackSpecies(1,1,0)); state.paused = true');
  game.listeners.get('window:keydown')({key: 'd', target: {closest: selector => selector.includes('button') ? {} : null}});
  const before = game.run('state.camera.x');
  game.run('update(1/30)');
  assert.ok(game.run('state.camera.x') > before);
});

test('changing nutrients updates local water and its indicator immediately in pause', () => {
  const game=createGame();
  game.run('seedWorld(fallbackSpecies(1,1,1));state.paused=true');
  const input={dataset:{env:'nutrients'},value:'0',nextElementSibling:{textContent:''}};
  game.listeners.get('envControls:input')({target:{closest:()=>input}});
  assert.equal(game.element('nutrientStock').textContent,'0 / 100');
  assert.equal(game.run('localWater(state.creatures[0]).nutrients'),0);
  input.value='70';
  game.listeners.get('envControls:input')({target:{closest:()=>input}});
  assert.equal(game.element('nutrientStock').textContent,'70 / 100');
});
