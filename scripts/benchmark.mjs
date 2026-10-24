import { createGame } from '../tests/harness.mjs';

const compare = process.argv.find(arg => arg.startsWith("--compare="))?.slice(10);
const rounds = Math.max(1, Math.min(5, Math.floor(Number(process.argv.find(arg => arg.startsWith("--rounds="))?.slice(9)) || 1)));
const versions = compare ? [{ref: compare, label: compare}, {label: "optimized"}]
  : (process.argv.includes("--optimized-only") ? [{label:"optimized"}] : [{ref:"origin/main",label:"stable"},{label:"optimized"}]);
for (let round=0;round<rounds;round++) for (const {baseline = false, ref, label} of round%2 ? [...versions].reverse() : versions) {
  // Optional --expose-gc keeps discarded test worlds out of the next sample.
  global.gc?.();
  const game = createGame({baseline, ref});
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
    for (let i = 0; i < 140; i++) {
      const start = performance.now(); update(1 / 30); const elapsed = performance.now() - start;
      if (i >= 50) times.push(elapsed);
    }
    times.sort((a,b) => a-b);
    return {population: state.creatures.length, medianMs: +times[45].toFixed(2), p95Ms: +times[85].toFixed(2)};
  })()`);
  console.log(JSON.stringify({round:round+1, version: label, ...times}));
}
