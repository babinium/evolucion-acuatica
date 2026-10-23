import { createGame } from '../tests/harness.mjs';

// A reproducible longitudinal game-model audit, not a claim of biological accuracy.
const seconds = Number(process.argv.find(a => a.startsWith('--seconds='))?.split('=')[1] || 360);
const seeds = (process.argv.find(a => a.startsWith('--seeds='))?.split('=')[1] || '123456,42,2026').split(',').map(Number);
for (const seed of seeds) {
  const game = createGame({seed});
  game.run('seedWorld(fallbackSpecies(1,1,1)); state.chaos=0;');
  for (let elapsed = 0; elapsed < seconds; elapsed += 60) {
    const result = game.run(`(() => {
      for(let i=0;i<360;i++) update(1/6);
      return {counts:countLivingClasses(), algae:state.resources.length, corpses:state.corpses.length,
        species:state.species.length, maxGeneration:Math.max(0,...state.creatures.map(c=>c.generation)),
        nutrients:+(state.habitats.reduce((s,h)=>s+h.stock,0)/16).toFixed(3),
        energy:Math.round(state.creatures.reduce((s,c)=>s+c.energy,0)/Math.max(1,state.creatures.length)),
        finite:state.creatures.every(c=>[c.x,c.y,c.health,c.energy,...Object.values(c.genes)].every(Number.isFinite))};
    })()`);
    console.log(JSON.stringify({seed, seconds:elapsed+60, ...result}));
  }
}
