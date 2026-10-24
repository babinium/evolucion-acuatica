import { createGame } from '../tests/harness.mjs';
import {readFileSync} from 'node:fs';
import {freshSpecies} from '../tests/fresh-species.mjs';

// A reproducible longitudinal game-model audit, not a claim of biological accuracy.
const seconds = Number(process.argv.find(a => a.startsWith('--seconds='))?.split('=')[1] || 360);
const seeds = (process.argv.find(a => a.startsWith('--seeds='))?.split('=')[1] || '123456,42,2026').split(',').map(Number);
const fixture=process.argv.find(a=>a.startsWith('--fixture='))?.split('=')[1];
const fresh=Number(process.argv.find(a=>a.startsWith('--fresh='))?.split('=')[1] || 0);
const freshStart=Number(process.argv.find(a=>a.startsWith('--fresh-start='))?.split('=')[1] || 10000);
const counts=(process.argv.find(a=>a.startsWith('--counts='))?.split('=')[1] || '2,2,2').split(',').map(Number);
const worldSize=Number(process.argv.find(a=>a.startsWith('--size='))?.split('=')[1] || 3600);
const chaos=Number(process.argv.find(a=>a.startsWith('--chaos='))?.split('=')[1] || 0);
const fixtures=JSON.parse(readFileSync(new URL('../tests/fixtures/ai-ecosystems.json',import.meta.url),'utf8'));
const scenarios=fresh ? Array.from({length:fresh},(_,i)=>({name:`fresh-${freshStart+i}`,species:freshSpecies(freshStart+i,counts)}))
  : fixture ? fixtures.filter(value=>fixture==='all'||value.name===fixture) : [{name:'local'}];
if (!scenarios.length || !Number.isFinite(seconds) || seconds<=0 || !Number.isFinite(chaos) || chaos<0 || chaos>1) {
  throw new Error('Usá una duración positiva, chaos entre 0 y 1 y un fixture conocido o all.');
}
for (const scenario of scenarios) for (const seed of seeds) {
  const game = createGame({seed});
  game.run(`state.worldSize=${worldSize};seedWorld(balanceInitialSpecies(${scenario.species ? JSON.stringify(scenario.species) : 'fallbackSpecies(1,1,1)'}),{balancedFounders:true});state.chaos=${chaos};state.evolutionAiEnabled=false;`);
  for (let elapsed = 0; elapsed < seconds; elapsed += 60) {
    const result = game.run(`(() => {
      for(let i=0;i<360;i++) update(1/6);
      return {counts:countLivingClasses(), algae:state.resources.length, corpses:state.corpses.length,
        lineages:state.species.length, species:livingIdentities().size,
        newSpecies:state.species.filter(sp=>sp.evolutionSource).length,
        maxGeneration:Math.max(0,...state.creatures.map(c=>c.generation)),
        carnivoreGeneration:Math.max(0,...state.creatures.filter(c=>getSpecies(c).class==='carnivore').map(c=>c.generation)),
        nutrients:+(state.habitats.reduce((s,h)=>s+h.stock,0)/16).toFixed(3),
        energy:Math.round(state.creatures.reduce((s,c)=>s+c.energy,0)/Math.max(1,state.creatures.length)),
        finite:state.creatures.every(c=>[c.x,c.y,c.health,c.energy,...Object.values(c.genes)].every(Number.isFinite))};
    })()`);
    console.log(JSON.stringify({fixture:scenario.name,seed,chaos,worldSize,seconds:elapsed+60,...result}));
  }
}
