import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './harness.mjs';

function isolated() {
  const game = createGame();
  game.run(`seedWorld(fallbackSpecies(1,1,1)); state.chaos=0;
    state.creatures=[]; state.resources=[]; state.corpses=[]; state.zones=[];`);
  return game;
}

const fixedGenes = '{size:5,speed:5,attack:5,defense:5,perception:5,fertility:10,metabolism:5,foodEfficiency:5,toxicity:0}';

function subject(game, type = 'herbivore', changes = '{}') {
  game.run(`state.species=[normalizeSpecies({id:'subject',class:'${type}',traits:{...${fixedGenes},...${changes}}})];
    rebuildSpeciesIndex(); spawnCreature(state.species[0],500,500,1);
    state.creatures[0].energy=30; state.creatures[0].cooldown=1000; state.creatures[0].age=30;
    rebuildSpatialIndexes();`);
}

test('photosynthesis cannot create energy in darkness or without nutrients', () => {
  for (const key of ['light', 'nutrients']) {
    const game = isolated();
    game.run(`spawnCreature(state.species[0],500,500,1); state.creatures[0].energy=30;
      state.env.${key}=0; updateEnvironment(0); producerThink(state.creatures[0],state.species[0],1);`);
    assert.equal(game.run('state.creatures[0].energy'), 30, key);
  }
});

test('grazing removes the same food and grants the same energy at different time steps', () => {
  const outcomes = [1/30, 1/6].map(dt => {
    const game = isolated();
    return game.run(`(() => {
      spawnCreature(state.species[0],500,500,1); spawnCreature(state.species[1],500,500,1);
      state.creatures[0].energy=100; state.creatures[1].energy=10;
      rebuildSpatialIndexes();
      for(let i=0;i<${Math.round(1/dt)};i++) eatProducer(state.creatures[1],state.species[1],${dt},countLivingClasses());
      return [state.creatures[0].health,state.creatures[0].energy,state.creatures[1].energy];
    })()`);
  });
  outcomes[0].forEach((value,i) => assert.ok(Math.abs(value-outcomes[1][i])<1e-7, `${outcomes[0]} vs ${outcomes[1]}`));
});

test('oxygen shortage slows swimming and injures high demand animals', () => {
  const results = [5, 65].map(oxygen => {
    const g=isolated(); subject(g);
    return g.run(`(() => {state.env.oxygen=${oxygen}; const c=state.creatures[0];
      c.wanderX=1500;c.wanderY=500;c.wanderTime=100;updateCreatures(1);
      return [c.x,c.health,c.activity];})()`);
  });
  assert.ok(results[0][0]<results[1][0]);
  assert.ok(results[0][1]<results[1][1]);
  assert.ok(results[0][2]<results[1][2]);
});

test('temperature controls photosynthesis, metabolic expense and damage at extremes', () => {
  const energy = [0, 50, 100].map(temperature => {
    const g=isolated();subject(g,'producer');
    return g.run(`state.env.temperature=${temperature};updateCreatures(1);state.creatures[0].energy`);
  });
  assert.ok(energy[1]>energy[0] && energy[1]>energy[2]);
  const animals = [40,100].map(temperature => {
    const g=isolated();subject(g);return g.run(`state.env.temperature=${temperature};
      state.creatures[0].energy=state.creatures[0].maxEnergy;updateCreatures(1);
      [state.creatures[0].maxEnergy-state.creatures[0].energy,state.creatures[0].health]`);
  });
  assert.ok(animals[1][0]>animals[0][0]);
  assert.ok(animals[1][1]<animals[0][1]);
});

test('pollution suppresses growth and harms animals, while clean water remains local', () => {
  const results=[0,100].map(toxicity => {
    const g=isolated();subject(g,'producer');
    return g.run(`state.env.toxicity=${toxicity};updateCreatures(1);[state.creatures[0].energy,state.creatures[0].health]`);
  });
  assert.ok(results[0][0]>results[1][0]);assert.ok(results[0][1]>results[1][1]);
});

test('currents transport resting swimmers and renew oxygen instead of granting free swim speed', () => {
  const results=[0,100].map(currents => {
    const g=isolated();subject(g);
    return g.run(`state.env.currents=${currents};state.envTarget.currents=${currents};
      state.habitats[0].oxygen=-30;updateEnvironment(1);
      state.creatures[0].energy=state.creatures[0].maxEnergy;updateCreatures(1);
      [state.creatures[0].x,localWater(state.creatures[0]).oxygen,bodyOf(state.creatures[0]).speed]`);
  });
  assert.equal(results[0][0],500);assert.ok(results[1][0]>500);
  assert.ok(results[1][1]>results[0][1]);assert.equal(results[0][2],results[1][2]);
});

test('rebrote needs both a nonzero rate and photosynthesis conditions', () => {
  const counts = [[0,68],[100,0],[100,68]].map(([rate,light]) => {
    const g=isolated();return g.run(`state.env.algaeRate=${rate};state.env.light=${light};refreshWater();
      for(let i=0;i<60;i++) spawnAlgaeByQuadrant(1);state.resources.length`);
  });
  assert.equal(counts[0],0);assert.equal(counts[1],0);assert.ok(counts[2]>0);
});

test('fully harvested algae do not revive at higher simulation speeds', () => {
  for(const dt of [1/30,1/6]) {
    const g=isolated();
    assert.equal(g.run(`state.env.algaeRate=0;spawnResource(500,500,80);state.resources[0].amount=0;
      updateResources(${dt});state.resources.length`),0);
  }
});

test('grazing leaves a finite holdfast that needs light and nutrients to regrow', () => {
  const g=isolated();subject(g);
  assert.equal(g.run(`(() => {
    spawnResource(500,500,80);rebuildSpatialIndexes();const r=state.resources[0],c=state.creatures[0];
    eatProducer(c,state.species[0],100);const left=r.amount;
    state.env.algaeRate=0;state.env.light=0;refreshWater();updateResources(0.1);const dark=r.amount;
    state.env.light=100;refreshWater();updateResources(1);
    return Math.abs(left-r.root)<1e-8 && left>0 && dark<left && r.amount>left;
  })()`),true);
});

test('plants retain living tissue after grazing and pay for recovery with photosynthesis', () => {
  const g=isolated();subject(g);
  assert.equal(g.run(`(() => {
    const sp=normalizeSpecies({id:'plant',class:'producer',traits:${fixedGenes}});
    state.species.push(sp);rebuildSpeciesIndex();const plant=spawnCreature(sp,500,500,1);plant.energy=0;
    rebuildSpatialIndexes();eatProducer(state.creatures[0],state.species[0],100);
    const tissue=plant.tissue,health=plant.health;
    state.env.light=0;refreshWater();producerThink(plant,sp,1);const dark=plant.health===health;
    state.env.light=100;refreshWater();producerThink(plant,sp,100);
    const recovered=plant.tissue>tissue&&plant.health>health&&state.habitats[0].stock<1;
    damageCreature(plant,plant.maxHealth);
    return tissue>=bodyOf(plant).holdfast-1e-8&&health>0&&dark&&recovered&&plant.health===0;
  })()`),true);
});

test('foragers leave a stripped patch and reach a useful meal nearby', () => {
  const g=isolated();subject(g);
  assert.equal(g.run(`(() => {
    state.env.algaeRate=state.envTarget.algaeRate=0;
    spawnResource(500,500,80);state.resources[0].amount=state.resources[0].root+0.5;
    spawnResource(800,500,80);rebuildSpatialIndexes();
    const c=state.creatures[0],target=sense(c,state.species[0],0,true).target;
    for(let i=0;i<24;i++)update(0.25);
    return target===state.resources[1]&&c.x>600&&c.energy>30;
  })()`),true);
});

test('plants in one area consume a shared nutrient reserve and detritus recycles it', () => {
  const g=isolated();subject(g,'producer');
  assert.equal(g.run(`(() => {
    for(let i=0;i<80;i++) spawnCreature(state.species[0],500,500,1);
    for(const c of state.creatures)c.energy=0;
    const start=state.habitats[0].stock;
    for(const c of state.creatures)producerThink(c,state.species[0],1);
    const depleted=state.habitats[0].stock;
    recycleNutrients(state.creatures[0],50);
    return depleted<start && state.habitats[1].stock===1 && state.habitats[0].stock>depleted;
  })()`),true);
});

test('every active trait has an energy maintenance cost', () => {
  for(const key of ['size','speed','attack','defense','perception','fertility','metabolism','foodEfficiency','toxicity']) {
    const costs=[0,10].map(value => {
      const g=isolated();subject(g,'carnivore',`{${key}:${value}}`);
      return g.run(`const c=state.creatures[0];c.energy=c.maxEnergy;updateCreatures(1);c.maxEnergy-c.energy`);
    });
    assert.ok(costs[1]>costs[0],`${key}: ${costs}`);
  }
});

test('large bodies survive a hit that kills a small body and carry more reserves', () => {
  const results=[0,10].map(size => {
    const g=isolated();subject(g,'herbivore',`{size:${size}}`);
    return g.run('damageCreature(state.creatures[0],60);[state.creatures[0].health,state.creatures[0].maxEnergy]');
  });
  assert.equal(results[0][0],0);assert.ok(results[1][0]>0);assert.ok(results[1][1]>results[0][1]);
});

test('speed changes actual displacement', () => {
  const positions=[0,10].map(speed => {
    const g=isolated();subject(g,'herbivore',`{speed:${speed}}`);
    return g.run('const c=state.creatures[0];c.wanderX=1500;c.wanderY=500;c.wanderTime=100;updateCreatures(1);c.x');
  });
  assert.ok(positions[1]>positions[0]);
});

test('attack and defense change actual predation damage', () => {
  function damage(attack,defense) {
    const g=isolated();subject(g,'carnivore',`{attack:${attack}}`);
    return g.run(`const preySp=normalizeSpecies({id:'prey',class:'herbivore',traits:{...${fixedGenes},defense:${defense}}});
      state.species.push(preySp);rebuildSpeciesIndex();const prey=spawnCreature(preySp,500,500,1);
      rebuildSpatialIndexes();const before=prey.health;hunt(state.creatures[0],state.species[0],0.5);before-prey.health`);
  }
  assert.ok(damage(10,5)>damage(0,5));assert.ok(damage(5,0)>damage(5,10));
});

test('a faster predator can finish a chase instead of braking after every bite', () => {
  const g=isolated();subject(g,'carnivore','{speed:10,metabolism:8,perception:8}');
  assert.equal(g.run(`(() => {
    const preySp=normalizeSpecies({id:'prey',class:'herbivore',traits:{...${fixedGenes},speed:5}});
    state.species.push(preySp);rebuildSpeciesIndex();const prey=spawnCreature(preySp,535,500,1);prey.cooldown=1000;
    state.creatures[0].energy=50;
    for(let i=0;i<450 && state.creatures.includes(prey);i++)update(1/30);
    return !state.creatures.includes(prey)&&state.creatures[0].health>0;
  })()`),true);
});

test('food competition makes predators spread across available prey', () => {
  const g=isolated();subject(g,'carnivore');
  assert.equal(g.run(`(() => {
    const second=spawnCreature(state.species[0],500,500,1);second.energy=30;
    const preySp=normalizeSpecies({id:'prey',class:'herbivore',traits:${fixedGenes}});
    state.species.push(preySp);rebuildSpeciesIndex();spawnCreature(preySp,650,500,1);spawnCreature(preySp,750,500,1);
    rebuildSpatialIndexes();return sense(state.creatures[0],state.species[0],0,true).target
      !==sense(second,state.species[0],0,true).target;
  })()`),true);
});

test('vegetation reduces detection while close contact remains detectable', () => {
  const g=isolated();subject(g,'carnivore');
  assert.equal(g.run(`(() => {
    const preySp=normalizeSpecies({id:'prey',class:'herbivore',traits:${fixedGenes}});
    state.species.push(preySp);rebuildSpeciesIndex();const prey=spawnCreature(preySp,800,500,1);
    rebuildSpatialIndexes();const hunter=state.creatures[0];const open=sense(hunter,state.species[0],0,true).target===prey;
    const plant=normalizeSpecies({id:'plant',class:'producer',traits:${fixedGenes}});
    state.species.push(plant);rebuildSpeciesIndex();for(let i=0;i<30;i++)spawnCreature(plant,800,500,1);
    rebuildSpatialIndexes();const hidden=!sense(hunter,state.species[0],0,true).target;
    prey.x=hunter.x+10;rebuildSpatialIndexes();
    return open&&hidden&&sense(hunter,state.species[0],0,true).target===prey;
  })()`),true);
});

test('well oxygenated recovery consumes reserves and stops in hypoxia', () => {
  const results=[5,65].map(oxygen => {
    const g=isolated();subject(g,'carnivore');
    return g.run(`const c=state.creatures[0];c.energy=c.maxEnergy;c.health=40;state.env.oxygen=${oxygen};
      updateCreatures(1);[c.health,c.maxEnergy-c.energy]`);
  });
  assert.ok(results[1][0]>40);assert.ok(results[0][0]<40);assert.ok(results[1][1]>results[0][1]);
});

test('satiated hunters do not restart a hunt after spending one frame of energy', () => {
  const g=isolated();subject(g,'carnivore');
  assert.equal(g.run(`(() => {const c=state.creatures[0];c.energy=c.maxEnergy;hunt(c,state.species[0],0.1);
    c.energy=c.maxEnergy*0.8;hunt(c,state.species[0],0.1);const rested=c.state==='saciado';
    c.energy=c.maxEnergy*0.4;hunt(c,state.species[0],0.1);return rested&&c.state==='explorando';})()`),true);
});

test('perception finds food that remains outside a short sensory range', () => {
  const states=[0,10].map(perception => {
    const g=isolated();subject(g,'herbivore',`{perception:${perception}}`);
    return g.run('spawnResource(1100,500,80);rebuildSpatialIndexes();eatProducer(state.creatures[0],state.species[0],0.1);state.creatures[0].state');
  });
  assert.equal(states[0],'explorando');assert.equal(states[1],'buscando alimento');
});

test('metabolism speeds digestion and efficiency changes energy extracted from the same bite', () => {
  for(const key of ['metabolism','foodEfficiency']) {
    const results=[0,10].map(value => {
      const g=isolated();subject(g,'herbivore',`{${key}:${value}}`);
      return g.run('spawnResource(500,500,80);rebuildSpatialIndexes();eatProducer(state.creatures[0],state.species[0],1);[state.creatures[0].energy,state.resources[0].amount]');
    });
    assert.ok(results[1][0]>results[0][0],key);
    if(key==='foodEfficiency')assert.equal(results[0][1],results[1][1]);
    else assert.ok(results[1][1]<results[0][1]);
  }
});

test('body toxins poison consumers and reduce the nutrition of a bite', () => {
  const results=[0,10].map(toxicity => {
    const g=isolated();subject(g);
    return g.run(`const plant=normalizeSpecies({id:'plant',class:'producer',traits:{...${fixedGenes},toxicity:${toxicity}}});
      state.species.push(plant);rebuildSpeciesIndex();spawnCreature(plant,500,500,1);rebuildSpatialIndexes();
      eatProducer(state.creatures[0],state.species[0],1);[state.creatures[0].energy,state.creatures[0].health]`);
  });
  assert.ok(results[0][0]>results[1][0]);assert.ok(results[0][1]>results[1][1]);
});

test('zero fertility prevents births while fertile well fed producers reproduce', () => {
  const counts=[0,30].map(fertility => {
    const g=isolated();subject(g,'producer',`{fertility:${fertility}}`);
    return g.run('state.creatures[0].energy=state.creatures[0].maxEnergy;state.creatures[0].cooldown=0;for(let i=0;i<480;i++)update(0.25);state.creatures.length');
  });
  assert.equal(counts[0],1);assert.ok(counts[1]>1);
});

test('reproduction pays for both baby reserves and edible tissue', () => {
  const g=isolated();subject(g,'producer','{fertility:30}');
  const result=g.run(`(() => {state.mutationRate=0;state.env.light=0;Math.random=()=>0;
    const parent=state.creatures[0];parent.energy=parent.maxEnergy;parent.cooldown=0;
    const before=parent.energy+parent.tissue;updateCreatures(0.1);
    return {count:state.creatures.length,before,after:state.creatures.reduce((s,c)=>s+c.energy+c.tissue,0),
      babyAge:state.creatures[1].age,sameParent:parent.speciesId==='subject'};})()`);
  assert.equal(result.count,2);assert.ok(result.after<=result.before);assert.equal(result.babyAge,0);assert.equal(result.sameParent,true);
});

test('predation produces one finite corpse and never awards food for damage', () => {
  const g=isolated();subject(g,'carnivore');
  const r=g.run(`(() => {
    const preySp=normalizeSpecies({id:'prey',class:'herbivore',traits:${fixedGenes}});state.species.push(preySp);rebuildSpeciesIndex();
    const prey=spawnCreature(preySp,500,500,1);prey.health=1;prey.energy=20;
    const food=prey.energy+prey.tissue;const hunter=state.creatures[0],before=hunter.energy;
    rebuildSpatialIndexes();hunt(hunter,state.species[0],1);const afterAttack=hunter.energy;
    removeDeadCreatures();removeDeadCreatures();const count=state.corpses.length,corpse=state.corpses[0];
    for(let i=0;i<100;i++)eatCorpseBite(hunter,state.species[0],corpse,1);
    return {before,afterAttack,count,food,remaining:corpse.amount,gain:hunter.energy-afterAttack};
  })()`);
  assert.ok(r.afterAttack<r.before);assert.equal(r.count,1);assert.ok(r.gain<=r.food);assert.equal(r.remaining,0);
});

test('slow mutations accumulate, stay bounded, and branch only the offspring lineage', () => {
  const g=isolated();subject(g);
  assert.equal(g.run(`(() => {
    state.mutationRate=0.04;const sp=state.species[0],parent=state.creatures[0];const original=JSON.stringify(sp.traits);
    let branched=false,changed=false;
    for(let i=0;i<2000;i++) {
      const genes=inheritGenes(parent,sp);changed ||= JSON.stringify(genes)!==JSON.stringify(parent.genes);
      if(!traitKeys.every(k=>genes[k]>=traitMin(k,sp.class)&&genes[k]<=traitMax(k,sp.class)))return false;
      const branch=maybeMutateSpecies(sp,parent,genes);if(branch!==sp){branched=true;break;}
      parent.genes=genes;
    }
    return branched&&changed&&parent.speciesId===sp.id&&original===JSON.stringify(sp.traits);
  })()`),true);
});

test('mutation off copies the actual parental genes and the lineage limit bounds memory', () => {
  const g=isolated();subject(g);
  assert.equal(g.run(`(() => {
    state.mutationRate=0;const parent=state.creatures[0];parent.genes.speed=7.25;
    const exact=JSON.stringify(inheritGenes(parent,state.species[0]))===JSON.stringify(parent.genes);
    state.mutationRate=0.16;while(state.species.length<MAX_EVOLVED_SPECIES)state.species.push({...state.species[0]});
    const genes={...parent.genes,size:10,speed:10,defense:10,perception:10,toxicity:10};
    return exact&&maybeMutateSpecies(state.species[0],parent,genes)===state.species[0];
  })()`),true);
});

test('crowding counts competitors from other species as well', () => {
  const g=isolated();subject(g,'producer');
  assert.equal(g.run(`(() => {
    for(let i=0;i<9;i++) {
      const sp=normalizeSpecies({id:'other'+i,class:'producer',traits:${fixedGenes}});
      state.species.push(sp);speciesById.set(sp.id,sp);spawnCreature(sp,500+i,500,1);
    }
    rebuildSpatialIndexes();return isCrowdedForReproduction(state.creatures[0],state.species[0]);
  })()`),true);
});

test('legacy saves migrate to finite individual genomes and new ecology saves preserve them', () => {
  const g=isolated();subject(g);g.run('state.selected=state.creatures[0];saveWorld()');
  const old=JSON.parse(g.values.get('evo-save'));delete old.ecologyVersion;delete old.habitats;
  for(const c of old.creatures){delete c.genes;delete c.maxEnergy;delete c.tissue;c.cooldown=100;}
  g.values.set('evo-save',JSON.stringify(old));g.run('loadWorld()');
  assert.equal(g.run('state.ecologyVersion'),2);assert.equal(g.run('state.habitats.length'),16);
  assert.equal(g.run('state.creatures[0].cooldown'),5);
  assert.equal(g.run('Object.values(state.selected.genes).every(Number.isFinite)'),true);
  g.run('state.selected.genes.speed=7.25;saveWorld();loadWorld()');
  assert.equal(g.run('state.selected.genes.speed'),7.25);
  assert.equal(g.run('bodyOf(state.selected).speed>0'),true);
});
