import { createGame } from '../tests/harness.mjs';

for (const baseline of (process.argv.includes("--optimized-only") ? [false] : [true, false])) {
  const game = createGame({baseline});
  game.run(`
    state.worldSize = 5200;
    seedWorld(fallbackSpecies(4, 4, 4));
    for (let i = state.creatures.length; i < 1200; i++) {
      const sp = state.species[i % state.species.length];
      spawnCreature(sp, rand(10, state.worldSize - 10), rand(10, state.worldSize - 10), 1);
    }
    for (let i = 0; i < 600; i++) spawnResource(rand(0, state.worldSize), rand(0, state.worldSize), 80);
    state.mutationRate = 0;
    for (const c of state.creatures) c.cooldown = 0;
  `);
  const times = game.run(`(() => {
    const times = [];
    for (let i = 0; i < 40; i++) {
      const start = performance.now(); update(1 / 30); const elapsed = performance.now() - start;
      if (i >= 10) times.push(elapsed);
    }
    times.sort((a,b) => a-b);
    return {population: state.creatures.length, medianMs: +times[15].toFixed(2), p95Ms: +times[28].toFixed(2)};
  })()`);
  console.log(JSON.stringify({version: baseline ? 'original' : 'optimized', ...times}));
}
