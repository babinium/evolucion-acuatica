import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

function individual({type='carnivore',metabolism=4,fertility=10}={}) {
  const game=createGame();
  game.run(`seedWorld(fallbackSpecies(1,1,1));state.chaos=0;state.mutationRate=0;
    state.creatures=[];state.resources=[];state.corpses=[];state.zones=[];
    state.species=[normalizeSpecies({id:'subject',name:'Habitante',class:'${type}',traits:{size:5,speed:5,
      attack:5,defense:4,perception:5,fertility:${fertility},metabolism:${metabolism},foodEfficiency:7,toxicity:0}})];
    rebuildSpeciesIndex();window.subject=spawnCreature(state.species[0],500,500,1);
    window.subject.age=0;window.subject.cooldown=9999;window.subject.energy=window.subject.maxEnergy;
    window.subject.health=window.subject.maxHealth;window.subject.hungry=false;
    animalThink=()=>{};producerThink=()=>{};rebuildSpatialIndexes();
    // These age/clock checks assume a sufficient prey supply.
    preySupportsBrood=()=>true;`);
  return game;
}

test('every diet has at least five adult breeding intervals despite its metabolic clock',()=>{
  const game=createGame();
  for(const type of ['producer','herbivore','carnivore'])for(const fertility of [0,5,10,20])for(const metabolism of [0,5,10]) {
    const body=game.run(`phenotype(sanitizeGenes({size:5,fertility:${fertility},metabolism:${metabolism}},'${type}'),'${type}')`);
    const rate=0.75+metabolism*0.07;
    assert.ok((body.lifespan-body.maturity)/rate+1e-8>=body.birthWait*5,`${type} F=${fertility}, M=${metabolism}`);
    assert.ok(body.lifespan>=(type==='producer'?420:300)+60,'do not shorten the previous natural span');
  }
});

test('a fed carnivore can have five actual broods before dying of age',()=>{
  const game=individual();
  const result=game.run(`(()=>{
    const p=window.subject,body=bodyOf(p),spawn=spawnCreature;let broods=0;
    p.cooldown=body.birthWait;
    spawnCreature=(...args)=>{if(args[3]===p.generation+1)broods++;return spawn(...args);};
    const seconds=Math.ceil(body.lifespan/(0.75+p.genes.metabolism*0.07));
    for(let i=0;i<=seconds && state.creatures.includes(p);i++) {
      // Isolate age and fertility from food shortages and injuries.
      p.energy=p.maxEnergy;p.health=p.maxHealth;updateCreatures(1);
    }
    return {broods,dead:!state.creatures.includes(p),cause:p.deathCause};
  })()`);
  assert.ok(result.broods>=5);assert.ok(result.dead);assert.equal(result.cause,'vejez');
});

for(const metabolism of [0,10])test(`remaining life counts simulation seconds at metabolism ${metabolism}`,()=>{
  const game=individual({metabolism});
  const result=game.run(`(()=>{
    const c=window.subject;c.age=10*(0.75+c.genes.metabolism*0.07);
    const before=lifeOf(c);updateCreatures(2);const after=lifeOf(c);
    return {before,after};
  })()`);
  assert.ok(Math.abs(result.before.elapsed-10)<1e-8);
  assert.ok(Math.abs(result.after.elapsed-12)<1e-8);
  assert.ok(Math.abs(result.before.remaining-result.after.remaining-2)<1e-8);
});

test('natural age is a finite deadline even in a refuge, with one corpse and no late brood',()=>{
  const game=individual();
  const result=game.run(`(()=>{
    const c=window.subject,body=bodyOf(c),rate=0.75+c.genes.metabolism*0.07;
    c.age=body.lifespan-rate*0.5;c.cooldown=0.5;c.protected=9999;
    updateCreatures(0.25);const alive=state.creatures.includes(c),remaining=lifeOf(c).remaining;
    updateCreatures(0.3);removeDeadCreatures();
    return {alive,remaining,dead:!state.creatures.includes(c),cause:c.deathCause,corpses:state.corpses.length,
      children:state.creatures.filter(other=>other.parentCreatureId===c.id).length};
  })()`);
  assert.ok(result.alive && result.remaining>0);assert.ok(result.dead);
  assert.equal(result.cause,'vejez');assert.equal(result.corpses,1);assert.equal(result.children,0);
});

for(const [cause,setup] of [
  ['hambre','window.subject.energy=-34;window.subject.health=0.01'],
  ['falta de oxígeno','state.env.oxygen=0;window.subject.health=0.01'],
  ['contaminación','state.env.toxicity=100;window.subject.health=0.01'],
  ['temperatura extrema','state.env.temperature=100;window.subject.health=0.01']
])test(`${cause} can kill long before the age limit and is identified`,()=>{
  const game=individual();
  game.run(`state.selected=window.subject;${setup};updateCreatures(1)`);
  assert.equal(game.run('window.subject.deathCause'),cause);
  assert.equal(game.run('state.creatures.includes(window.subject)'),false);
  assert.match(game.element('selectionDeath').textContent,new RegExp(cause));
});

test('observed combat deaths keep their cause instead of being labeled old age',()=>{
  const game=individual();
  game.run(`state.selected=window.subject;damageCreature(window.subject,window.subject.maxHealth,'caza');removeDeadCreatures()`);
  assert.equal(game.run('window.subject.deathCause'),'caza');
  assert.match(game.element('selectionDeath').textContent,/caza/);
});

test('save/load keeps physical age, reserves and brood countdown without refreshing life',()=>{
  const game=individual();
  const result=game.run(`(()=>{
    const c=window.subject;c.age=123.45*(0.75+c.genes.metabolism*0.07);
    c.energy=c.maxEnergy*0.62;c.health=c.maxHealth*0.73;c.cooldown=37;state.selected=c;
    const age=c.age,before=lifeOf(c).remaining;saveWorld();loadWorld();
    const loaded=lifeOf(state.selected).remaining;saveWorld();loadWorld();
    return {age,preserved:state.selected.age,before,loaded,again:lifeOf(state.selected).remaining,
      energy:state.selected.energy/state.selected.maxEnergy,health:state.selected.health/state.selected.maxHealth,
      cooldown:state.selected.cooldown};
  })()`);
  assert.equal(result.age,result.preserved);assert.equal(result.before,result.loaded);assert.equal(result.loaded,result.again);
  assert.equal(result.energy,0.62);assert.ok(Math.abs(result.health-0.73)<1e-8);assert.equal(result.cooldown,37);
});

test('the selected life meter warns near old age and updates after selecting another individual',()=>{
  const game=individual();
  game.run('state.selected=window.subject;window.subject.age=bodyOf(window.subject).lifespan*0.9;updateSelection()');
  assert.equal(game.element('selectionLifeStage').textContent,'Vejez próxima');
  assert.ok(Math.abs(parseFloat(game.element('selectionLifeFill').style.width)-10)<1e-8);
  const previous=game.element('selectionLifeValue').textContent;
  game.run(`const young=spawnCreature(state.species[0],800,800,1,{...state.species[0].traits,fertility:20});
    young.age=0;state.selected=young;updateSelection()`);
  assert.equal(game.element('selectionLifeStage').textContent,'Juvenil');
  assert.equal(parseFloat(game.element('selectionLifeFill').style.width),100);
  assert.notEqual(game.element('selectionLifeValue').textContent,previous);
});

test('observed age deaths stop following, show a notice and clear it for a new selection',()=>{
  const game=individual();
  game.run(`state.selected=window.subject;setFollowSelected(true);window.subject.age=bodyOf(window.subject).lifespan;updateCreatures(0)`);
  assert.equal(game.run('state.followSelected'),false);
  assert.equal(game.element('selectionDeath').classList.contains('hidden'),false);
  assert.match(game.element('selectionDeath').textContent,/vejez/);
  game.run('state.selected=spawnCreature(state.species[0],800,800,1);updateSelection()');
  assert.equal(game.element('selectionDeath').classList.contains('hidden'),true);
  game.run('seedWorld(fallbackSpecies(1,1,1))');
  assert.equal(game.element('selectionDeath').classList.contains('hidden'),true);
});
