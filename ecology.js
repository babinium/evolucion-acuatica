// Game ecology, in simulation seconds. Only 16 water cells are integrated;
// bodies are derived at birth and senses run five times/second, independently of drawing.
const ECOLOGY_VERSION = 2;
const MAX_EVOLVED_SPECIES = 48;
const traitHelp = {
  size: "Más salud, reservas y alimento por mordida; un cuerpo grande cuesta energía, reduce la agilidad y es más fácil de detectar.",
  speed: "Mayor velocidad de nado y escape; los músculos rápidos consumen más energía. Los productores permanecen anclados.",
  attack: "Aumenta el daño de los carnívoros; mantener y usar armas cuesta energía. Las otras dietas no usan ataque.",
  defense: "Reduce el daño y la velocidad a la que te comen; la armadura cuesta energía y dificulta nadar.",
  perception: "Los animales detectan comida y amenazas más lejos; en productores mejora la captación de nutrientes. Tiene costo de mantenimiento.",
  fertility: "Reduce la espera entre crías. En animales el reloj es fijo: al terminar, espera 55% de salud y 75% de energía. Cuesta mantenimiento. Cero impide reproducirse.",
  metabolism: "Acelera actividad, digestión y fotosíntesis; también el gasto, la necesidad de oxígeno y el envejecimiento.",
  foodEfficiency: "Aprovecha una mayor parte del alimento o la luz; un sistema eficiente tiene mayor costo de mantenimiento.",
  toxicity: "Envenena a quien te come y disuade ataques; fabricar toxinas consume energía. No protege de la contaminación del agua."
};
const waterCells = [];
const cleanWaterCells = [];
const foodClaims = new Map();
const ANIMAL_BIRTH_HEALTH = 0.55;
const ANIMAL_BIRTH_ENERGY = 0.75;
const ANIMAL_BIRTH_COST = 0.25;
const CARNIVORE_EMERGENCY_ENERGY = 0.25;

function sanitizeGenes(traits, type) {
  const genes = {};
  for (const key of traitKeys) {
    const value = Number(traits?.[key]);
    genes[key] = clamp(Number.isFinite(value) ? value : 5, traitMin(key, type), traitMax(key, type));
  }
  return genes;
}

function initialGenes(sp) {
  // Standing variation gives selection something to act on before the first birth.
  const genes = {...sp.traits};
  for (const key of traitKeys) {
    const max = traitMax(key, sp.class);
    if (max) genes[key] = clamp(genes[key] + rand(-0.12, 0.12) * max, 0, max);
  }
  return genes;
}

function phenotype(genes, type) {
  const t = genes;
  const fertility = t.fertility / traitMax("fertility", type);
  const activity = 0.6 + t.metabolism * 0.09;
  const maxEnergy = 120 + t.size * 12;
  const tissue = 12 + t.size * 5;
  const birthEnergy = maxEnergy * (type === "producer" ? 0.12 : ANIMAL_BIRTH_ENERGY);
  const upkeep = 0.16 + t.size * 0.035 + t.defense ** 2 * 0.002
    + t.perception ** 2 * 0.002 + t.toxicity ** 2 * 0.003
    + t.foodEfficiency ** 2 * 0.0015 + fertility ** 2 * 0.22
    + (type === "producer" ? 0 : 0.12 + t.speed ** 2 * 0.003 + t.attack ** 2 * 0.0025);
  return {
    size: 4 + t.size * 2.2,
    maxHealth: 42 + t.size * 8 + t.defense * 2,
    maxEnergy,
    // Stored root energy is finite and still pays maintenance, repair and buds.
    rootReserve: type === "producer" ? maxEnergy * 0.5 : 0,
    // Hunting also pays attack and injury-repair costs. Calibrate resting upkeep
    // separately so a finite meal can fund the next hunt and occasional offspring.
    basal: upkeep * (0.55 + t.metabolism * 0.12) * (type === "carnivore" ? 0.75 : 1),
    activity,
    speed: type === "producer" ? 0 : (25 + t.speed * 14) * activity / (1 + t.size * 0.025 + t.defense * 0.022),
    vision: 170 + t.perception * 70,
    assimilation: 0.45 + t.foodEfficiency * 0.042,
    intake: (6 + t.size * 0.55) * activity,
    armor: 1 / (1 + t.defense * 0.14),
    damage: (5 + t.attack * 3.6 + t.size * 0.7) * activity,
    photosynthesis: (2.2 + t.size * 0.32) * activity * (0.5 + t.foodEfficiency * 0.08) * (0.7 + t.perception * 0.05),
    fertility,
    // Animal offspring receive the divine subsidy chosen by the player.
    // Producers continue paying for the child's reserves and edible tissue.
    birthCost: type !== "producer" ? maxEnergy*ANIMAL_BIRTH_COST : birthEnergy + tissue + 6,
    birthEnergy,
    birthWait: type === "carnivore" ? 60 + (1 - fertility) * 140 : 20 + (1 - fertility) * 65,
    maturity: (type === "producer" ? 12 : type === "carnivore" ? 35 : 18) / activity,
    lifespan: (type === "producer" ? 420 : 300) + t.size * 12,
    tissue,
    holdfast: type === "producer" ? tissue * 0.2 : 0
  };
}

function bodyOf(c, sp = getSpecies(c)) {
  if (!c._body) {
    c.genes = sanitizeGenes(c.genes || sp.traits, sp.class);
    Object.defineProperty(c, "_body", {value: phenotype(c.genes, sp.class), writable: true, configurable: true});
  }
  return c._body;
}

function cellIndex(point) {
  return Math.min(3, Math.max(0, Math.floor(point.x * 4 / state.worldSize)))
    + Math.min(3, Math.max(0, Math.floor(point.y * 4 / state.worldSize))) * 4;
}

function initHabitats(saved) {
  foodClaims.clear();
  state.ecologyVersion = ECOLOGY_VERSION;
  state.habitats = Array.from({length: 16}, (_, i) => ({
    stock: clamp(Number.isFinite(saved?.[i]?.stock) ? saved[i].stock : 1, 0, 1),
    oxygen: clamp(Number.isFinite(saved?.[i]?.oxygen) ? saved[i].oxygen : 0, -100, 100)
  }));
  refreshWater();
}

function refreshWater() {
  if (!state.habitats || state.habitats.length !== 16) return initHabitats();
  for (let i = 0; i < 16; i++) {
    const cell = waterCells[i] ||= {};
    const clean = cleanWaterCells[i] ||= {};
    Object.assign(cell, state.env);
    cell.nutrients = state.env.nutrients * state.habitats[i].stock;
    cell.oxygen = clamp(state.env.oxygen + state.habitats[i].oxygen, 0, 100);
    cell.cover = state.habitats[i].cover || 0;
    // A small rotating flow field transports swimmers and detritus without extra particles.
    const angle = i * 1.7 + state.day * 0.08;
    cell.flowX = Math.cos(angle) * state.env.currents * 0.14;
    cell.flowY = Math.sin(angle) * state.env.currents * 0.14;
    cell.temperatureActivity = 0.45 + state.env.temperature * 0.013;
    cell.photoTemperature = Math.max(0.02, 1 - ((state.env.temperature - 50) / 55) ** 2);
    Object.assign(clean, cell, {oxygen: Math.max(60, cell.oxygen), toxicity: Math.min(20, cell.toxicity)});
  }
}

function waterAt(point) {
  const i = cellIndex(point);
  if (!waterCells[i]) refreshWater();
  return state.zones.length && inEffectZone(point, "cleanse") ? cleanWaterCells[i] : waterCells[i];
}

function nutrientFactor(water) { return water.nutrients / (water.nutrients + 25); }

function takeNutrients(point, energy) {
  const habitat = state.habitats[cellIndex(point)];
  const cost = Math.max(0, energy) * 0.0012;
  const used = Math.min(habitat.stock, cost);
  habitat.stock -= used;
  habitat.oxygen = Math.min(100, habitat.oxygen + (cost > 0 ? energy * used / cost : 0) * 0.001);
  return cost > 0 ? used / cost : 1;
}

function recycleNutrients(point, food) {
  const habitat = state.habitats[cellIndex(point)];
  habitat.stock = Math.min(1, habitat.stock + Math.max(0, food) * 0.0009);
  habitat.oxygen = Math.max(-100, habitat.oxygen - Math.max(0, food) * 0.002);
}

function updateEnvironment(dt) {
  for (const [key, def] of Object.entries(envDefs)) {
    const baseline=state.envBaseline[key] ?? state.envTarget[key];
    if (Math.random() < 1 - Math.exp(-dt * 0.015 * state.chaos)) {
      state.envTarget[key] = clamp(state.envTarget[key] + rand(-18, 18) * state.chaos,
        Math.max(def[1],baseline-24*state.chaos),Math.min(def[2],baseline+24*state.chaos));
    }
    state.env[key] += (state.envTarget[key] - state.env[key]) * (1 - Math.exp(-dt * 0.08));
  }
  if (!state.habitats) initHabitats();
  const mix = 1 - Math.exp(-dt * (0.008 + state.env.currents * 0.0007));
  const oxygenMix = 1 - Math.exp(-dt * (0.015 + state.env.currents * 0.0015));
  // Simultaneous diffusion, no dependence on the order in which cells are visited.
  const stocks = state.habitats.map(h => h.stock);
  const oxygens = state.habitats.map(h => h.oxygen);
  for (let i = 0; i < 16; i++) {
    const neighbours = [i % 4 ? i - 1 : i, i % 4 < 3 ? i + 1 : i, i >= 4 ? i - 4 : i, i < 12 ? i + 4 : i];
    const h = state.habitats[i];
    h.stock += (neighbours.reduce((sum, j) => sum + stocks[j], 0) / 4 - stocks[i]) * mix;
    h.stock += (1 - h.stock) * (1 - Math.exp(-dt * (0.004 + state.env.nutrients * 0.0002)));
    h.oxygen += (neighbours.reduce((sum, j) => sum + oxygens[j], 0) / 4 - oxygens[i]) * mix;
    h.oxygen *= 1 - oxygenMix;
  }
  refreshWater();
}

function updateResources(dt) {
  spawnAlgaeByQuadrant(dt);
  let write = 0;
  for (const r of state.resources) {
    // Harvested patches disappear before growth. Otherwise a long time step
    // revives an empty patch that a short step would remove.
    if (r.amount <= 0) continue;
    const water = localWater(r);
    const gain = dt * 2 * water.light / 68 * nutrientFactor(water) * water.photoTemperature
      * Math.max(0, 1 - water.toxicity / 100);
    const growth = Math.min(gain, Math.max(0, r.max * 1.6 - r.amount));
    r.amount += growth * takeNutrients(r, growth);
    const decay = Math.min(r.amount, dt * (0.04 + water.toxicity * 0.003));
    r.amount -= decay;
    recycleNutrients(r, decay);
    r.radius = Math.sqrt(Math.max(1, r.amount)) * 2.2;
    if (r.amount > 0) state.resources[write++] = r;
  }
  state.resources.length = write;
}

function spawnAlgaeByQuadrant(dt) {
  const cell = state.worldSize / 4;
  for (let i = 0; i < 16 && state.resources.length < MAX_RESOURCES; i++) {
    const water = waterCells[i];
    const rate = state.env.algaeRate / 100 * 0.16 * water.light / 68 * nutrientFactor(water) * water.photoTemperature
      * Math.max(0, 1 - water.toxicity / 100);
    if (Math.random() >= 1 - Math.exp(-dt * rate)) continue;
    const point = {x: (i % 4 + Math.random()) * cell, y: (Math.floor(i / 4) + Math.random()) * cell};
    const amount = rand(6, 14);
    const available = takeNutrients(point, amount);
    if (available > 0) spawnResource(point.x, point.y, amount * available);
  }
}

function updateCorpses(dt) {
  let write = 0;
  for (const corpse of state.corpses) {
    const water = localWater(corpse);
    const decay = Math.min(corpse.amount, dt * (0.12 + state.env.temperature * 0.006));
    corpse.amount -= decay;
    recycleNutrients(corpse, decay);
    corpse.x = clamp(corpse.x + water.flowX * dt * 0.7, 0, state.worldSize);
    corpse.y = clamp(corpse.y + water.flowY * dt * 0.7, 0, state.worldSize);
    corpse.radius = Math.sqrt(Math.max(1, corpse.amount)) * 1.7;
    if (corpse.amount > 0.1) state.corpses[write++] = corpse;
  }
  state.corpses.length = write;
}

function updateZones(dt) {
  for (const z of state.zones) if (z.ttl !== 9999) z.ttl -= dt;
  state.zones = state.zones.filter(z => z.ttl > 0);
}

function updateCreatures(dt) {
  refreshWater();
  const newborns = [];
  for (const c of state.creatures) {
    const sp = getSpecies(c);
    if (!sp || c.health <= 0 || c.energy <= -35) continue;
    const body = bodyOf(c, sp), water = localWater(c);
    const oldX = c.x, oldY = c.y;
    c.age += dt * (0.75 + c.genes.metabolism * 0.07);
    c.cooldown = Math.max(0, c.cooldown - dt);
    c.protected = Math.max(0, c.protected - dt);
    const respiration = body.basal * water.temperatureActivity * dt;
    // Velocity is already in units of 58 world units/second. Dividing by 58
    // again made pursuit almost free. Actual swimming (including either sprint)
    // pays the same squared-speed rule; anchored producers spend nothing here.
    const movement = sp.class === "producer" ? 0 : (c.vx*c.vx+c.vy*c.vy) * dt * (0.05 + c.genes.size * 0.008);
    c.energy -= respiration + movement;
    state.habitats[cellIndex(c)].oxygen = Math.max(-100, state.habitats[cellIndex(c)].oxygen - respiration * 0.0015);
    c.activity = water.temperatureActivity * (0.12 + 0.88 * Math.min(1, water.oxygen / (22 + c.genes.metabolism * 0.9)));
    if (sp.class === "producer") producerThink(c, sp, dt);
    else animalThink(c, sp, dt);
    // Routine recovery spends stored food. Requiring a full stomach here leaves
    // hunters permanently injured after a few meals and blocks every later birth.
    if (sp.class !== "producer" && c.health > 0 && c.energy > c.maxEnergy * 0.25
      && water.oxygen >= 25 && water.toxicity <= 25) {
      const repair = Math.min(c.maxHealth - c.health, dt * body.activity * 0.6);
      c.health += repair; c.energy -= repair * 0.8;
    }
    c.x = clamp(c.x + (c.vx * 58 + (sp.class === "producer" ? 0 : water.flowX)) * dt, 8, state.worldSize - 8);
    c.y = clamp(c.y + (c.vy * 58 + (sp.class === "producer" ? 0 : water.flowY)) * dt, 8, state.worldSize - 8);
    if (c.x === 8 || c.x === state.worldSize - 8) c.vx *= -0.3;
    if (c.y === 8 || c.y === state.worldSize - 8) c.vy *= -0.3;
    if (isProtected(c)) c.health = Math.min(c.maxHealth, c.health + dt * 2);
    else {
      damageCreature(c, dt * Math.max(0, 16 + c.genes.metabolism * 0.6 - water.oxygen) * 0.16);
      damageCreature(c, dt * Math.max(0, water.toxicity - 25) * 0.025);
      damageCreature(c, dt * Math.max(0, 12 - water.temperature, water.temperature - 86) * 0.06);
    }
    if (c.energy < 0) c.health = Math.max(0, c.health - dt * (0.6 + Math.abs(c.energy) * 0.15));
    if (c.age > body.lifespan) c.health = Math.max(0, c.health - dt * 3);
    const plant = sp.class === "producer", animal = !plant;
    const healthy = plant ? c.health > c.maxHealth*0.35 : c.health >= c.maxHealth*ANIMAL_BIRTH_HEALTH;
    const fertile = body.fertility > 0 && healthy && c.age >= body.maturity
      && c.energy >= (plant ? body.birthCost + c.maxEnergy * 0.1 : c.maxEnergy*ANIMAL_BIRTH_ENERGY)
      && c.cooldown <= 0 && state.creatures.length + newborns.length < MAX_CREATURES;
    // A ready animal waits at zero until it can breed. One birth starts a new
    // fertility interval; missed opportunities never accumulate into a burst.
    if (fertile && (animal || (Math.random() < 1 - Math.exp(-dt * 0.09 * body.fertility) && !isCrowdedForReproduction(c, sp)))) {
      const genes = inheritGenes(c, sp);
      const childSpecies = maybeMutateSpecies(sp, c, genes);
      c.energy -= body.birthCost;
      c.cooldown = body.birthWait;
      newborns.push({parent: c, species: childSpecies, genes, energy: Math.min(body.birthCost, body.birthEnergy)});
    }
    creatureGrid.move(c, oldX, oldY);
    classGrids[sp.class].move(c, oldX, oldY);
    if (sp.class !== "producer") animalGrid.move(c, oldX, oldY);
    const oldKey = quadrantKey(oldX, oldY, c.speciesId), newKey = quadrantKey(c.x, c.y, c.speciesId);
    if (oldKey !== newKey) {
      quadrantCounts.set(oldKey, (quadrantCounts.get(oldKey) || 1) - 1);
      quadrantCounts.set(newKey, (quadrantCounts.get(newKey) || 0) + 1);
    }
  }
  for (const item of newborns) {
    const child = spawnCreature(item.species, item.parent.x + rand(-65, 65), item.parent.y + rand(-65, 65), item.parent.generation + 1, item.genes);
    const animal = item.species.class !== "producer";
    child.energy = animal ? child.maxEnergy*ANIMAL_BIRTH_ENERGY
      : Math.max(0, Math.min(child.maxEnergy, item.energy, bodyOf(item.parent).birthCost - child.tissue - 5));
    child.age = 0;
    child.cooldown = animal ? bodyOf(child).birthWait : bodyOf(child).maturity;
    child.parentCreatureId = item.parent.id;
    if(animal)child.hungry=false;
  }
  removeDeadCreatures();
}

function removeDeadCreatures() {
  let write = 0, deaths = 0;
  for (const c of state.creatures) {
    if (c.health > 0 && c.energy > -35) { state.creatures[write++] = c; continue; }
    deaths++;
    releaseFoodClaim(c._brain);
    const sp = getSpecies(c);
    if (!sp) continue;
    const amount = Math.max(0, c.tissue ?? bodyOf(c, sp).tissue) + Math.max(0, c.energy);
    if (sp.class !== "producer" && amount > 0 && state.corpses.length < MAX_CORPSES) {
      const corpse = {id: uid("corpse"), x: c.x, y: c.y, amount, radius: Math.sqrt(amount) * 1.7, toxicity: c.genes.toxicity};
      state.corpses.push(corpse);
    } else recycleNutrients(c, amount);
  }
  state.creatures.length = write;
  return deaths;
}

function isCrowdedForReproduction(c, sp) {
  const radius = sp.class === "producer" ? 125 : 185;
  const limit = sp.class === "producer" ? 8 : 12;
  let count = 0;
  for (const other of classGrids[sp.class].query(c.x, c.y, radius)) {
    if (other.id !== c.id && other.health > 0 && ++count >= limit) return true;
  }
  return false;
}

function sameSpeciesInQuadrant(c) { return quadrantCounts.get(quadrantKey(c.x, c.y, c.speciesId)) || 0; }

function countLivingClasses() {
  const counts = {producer: 0, herbivore: 0, carnivore: 0};
  for (const c of state.creatures) { const sp = getSpecies(c); if (sp && c.health > 0 && c.energy > -35) counts[sp.class]++; }
  return counts;
}

function producerThink(c, sp, dt) {
  const body = bodyOf(c, sp), water = localWater(c);
  c.vx = c.vy = 0;
  c.state = water.light < 1 ? "sin luz" : water.nutrients < 1 ? "sin nutrientes" : "fotosíntesis";
  const gain = Math.min(Math.max(0, c.maxEnergy - c.energy), dt * body.photosynthesis * water.light / 68
    * nutrientFactor(water) * water.photoTemperature * Math.max(0, 1 - water.toxicity / 100));
  c.energy += gain * takeNutrients(c, gain);
  if (c.energy > c.maxEnergy * 0.5 && c.health < c.maxHealth) {
    const repair = Math.min(c.maxHealth - c.health, dt * body.activity * 0.5, Math.max(0, c.energy - c.maxEnergy * 0.5));
    c.health += repair;
    c.tissue = Math.min(body.tissue, c.tissue + repair / c.maxHealth * body.tissue);
    c.energy -= repair;
  }
}

function brainOf(c) {
  if (!c._brain) Object.defineProperty(c, "_brain", {value: {wait: 0, target: null, kind: null, threat: null}, configurable: true});
  return c._brain;
}

function releaseFoodClaim(brain) {
  if (!brain?.target) return;
  const claims = (foodClaims.get(brain.target) || 1) - 1;
  if (claims > 0) foodClaims.set(brain.target, claims);
  else foodClaims.delete(brain.target);
  brain.target = null;
}

function targetAlive(target, kind) {
  return !!target && (kind === "producer" || kind === "prey" ? target.health > 0 && target.energy > -35 && !isProtected(target)
    && (kind !== "producer" || edibleFood(target, kind) > 0.1)
    : target.amount - (kind === "alga" ? target.root || 0 : 0) > 0.1);
}

function edibleFood(target, kind) {
  if (kind === "alga") return Math.max(0, target.amount - (target.root || 0));
  if (kind === "corpse") return target.amount;
  const body = kind === "producer" ? bodyOf(target) : null;
  return Math.max(0, target.energy - (body?.rootReserve || 0))
    + Math.max(0, (target.tissue || 0) - (body?.holdfast || 0));
}

function detectionRange(observer, target, baseRange) {
  // Vegetation creates refuges and ambush opportunities. This uses the same 16
  // cells as water, so there are no ray casts or extra neighbour searches.
  const cover = state.habitats[cellIndex(target)].cover || 0;
  return Math.max(observer.size + target.size + 12, baseRange * (0.6 + target.genes.size * 0.065) / (1 + cover * 0.5));
}

function canHuntCarnivore(c,target) {
  if(c.energy>c.maxEnergy*CARNIVORE_EMERGENCY_ENERGY || c.id===target.id)return false;
  if(target.parentCreatureId===c.id && target.age<bodyOf(target).maturity)return false;
  if(c.parentCreatureId===target.id && c.age<bodyOf(c).maturity)return false;
  return true;
}

function sense(c, sp, dt, force = false) {
  const brain = brainOf(c);
  brain.wait -= dt;
  const staleEmergency=brain.kind==='prey' && brain.target && getSpecies(brain.target)?.class==='carnivore'
    && !canHuntCarnivore(c,brain.target);
  if (!force && !staleEmergency && brain.wait > 0 && (!brain.target || targetAlive(brain.target, brain.kind))) return brain;
  brain.wait = 0.18 + (c.id % 7) * 0.01;
  releaseFoodClaim(brain); brain.kind = null; brain.threat = null;
  const radius = bodyOf(c, sp).vision;
  if (sp.class === "herbivore" && !isProtected(c)) {
    let danger = Infinity;
    for (const other of classGrids.carnivore.query(c.x, c.y, radius * 0.58)) {
      const d = dist(c, other);
      const pursuing=other.state==='persiguiendo'||other.state==='cazando';
      const closing=(c.x-other.x)*other.vx+(c.y-other.y)*other.vy>0.1;
      const dangerRange=pursuing||closing ? radius*0.58 : c.size+other.size+80;
      if (other.health > 0 && d < danger && d <= Math.min(dangerRange,detectionRange(c,other,radius*0.58))) {
        danger = d; brain.threat = other;
      }
    }
  }
  if (brain.threat) return brain;
  let score = Infinity;
  function consider(target, kind, penalty = 0) {
    if (!targetAlive(target, kind)) return;
    const d = dist(c, target);
    let value = edibleFood(target, kind);
    if ((kind === "alga" || kind === "producer") && value < Math.min(12, bodyOf(c, sp).intake * 2)) return;
    if(kind==='corpse' && value<Math.min(12,bodyOf(c,sp).intake*2) && d>c.size+target.radius+7)return;
    if (kind === "producer") value *= bodyOf(target).armor * Math.max(0.3, 1 - target.genes.toxicity * 0.045);
    // Do not camp on a stripped patch for a fraction of a bite each sensory tick.
    // It must recover a useful meal before a new forager chooses it again.
    const competition = (foodClaims.get(target) || 0) * (kind === "prey" ? 240 : kind === "corpse" ? 45 : 30);
    const s = d + penalty + competition - Math.min(160, value) * 2.4;
    if (s < score) { score = s; brain.target = target; brain.kind = kind; }
  }
  if (sp.class === "herbivore") {
    for (const r of resourceGrid.query(c.x, c.y, radius)) consider(r, "alga");
    for (const other of classGrids.producer.query(c.x, c.y, radius)) {
      consider(other, "producer", other.genes.defense * 6 + other.genes.toxicity * 12);
    }
  } else {
    // Nearby carrion avoids a needless fight. Distant scent is a fallback, so a
    // hunter won't abandon a reachable meal for scraps across the map.
    if(state.corpses.length)for (const corpse of corpseGrid.query(c.x, c.y, radius*0.5)) consider(corpse, "corpse", -70 + (corpse.toxicity || 0) * 8);
    if(!brain.target)for (const other of classGrids.herbivore.query(c.x, c.y, radius)) {
      if (dist(c, other) > detectionRange(c, other, radius)) continue;
      consider(other, "prey", other.genes.defense * 9 + other.genes.toxicity * 15
        + other.energy / other.maxEnergy * 70 + other.health / other.maxHealth * 40
        + Math.max(0, other.genes.size - c.genes.size) * 18 + 40);
    }
    if(!brain.target && state.corpses.length)for(const corpse of corpseGrid.query(c.x,c.y,radius*2)) {
      consider(corpse,'corpse',-70+(corpse.toxicity||0)*8);
    }
    // A living carnivore is a last resort, never a cheaper alternative to a
    // visible grazer or edible carrion. Health alone cannot activate this mode.
    if(!brain.target && c.energy<=c.maxEnergy*CARNIVORE_EMERGENCY_ENERGY) {
      for(const other of classGrids.carnivore.query(c.x,c.y,radius)) {
        if(!canHuntCarnivore(c,other) || dist(c,other)>detectionRange(c,other,radius))continue;
        consider(other,'prey',other.genes.defense*9+other.genes.toxicity*15
          +other.health/other.maxHealth*40+Math.max(0,other.genes.size-c.genes.size)*18);
      }
    }
  }
  if (brain.target) foodClaims.set(brain.target, (foodClaims.get(brain.target) || 0) + 1);
  return brain;
}

function animalThink(c, sp, dt) {
  if (sp.class === "carnivore" && !wantsFood(c)) return rest(c, dt);
  const brain = sense(c, sp, dt);
  if (brain.threat && brain.threat.health > 0 && !isProtected(c)) {
    c.state = "huyendo";
    const sprint = c.energy > c.maxEnergy * 0.25 ? 1.45 : 1;
    steerAway(c, brain.threat, bodyOf(c, sp).speed * (c.activity || 1) * sprint / 58, dt);
  } else if (sp.class === "herbivore") eatProducer(c, sp, dt, null, brain);
  else hunt(c, sp, dt, brain);
}

function eatProducer(c, sp, dt, counts, cachedBrain) {
  if (!wantsFood(c)) return rest(c, dt);
  const brain = cachedBrain || sense(c, sp, 0, true);
  if (!brain.target || !targetAlive(brain.target, brain.kind)) return patrolForFood(c, sp, dt);
  const target = brain.target;
  if (dist(c, target) > c.size + (target.radius || target.size) + 8) {
    c.state = "buscando alimento";
    return steerToward(c, target, bodyOf(c, sp).speed * (c.activity || 1) / 58, dt);
  }
  const body = bodyOf(c, sp);
  const armor = brain.kind === "producer" ? bodyOf(target).armor : 1;
  const toxin = brain.kind === "producer" ? target.genes.toxicity : 0;
  const assimilation = body.assimilation * Math.max(0.3, 1 - toxin * 0.045);
  const capacity = Math.max(0, (c.maxEnergy - c.energy) / assimilation);
  let bite = Math.min(capacity, dt * body.intake * (c.activity || 1) * armor);
  if (brain.kind === "alga") {
    // Grazers leave an inedible holdfast, rather than conjuring a new patch after
    // exhausting it. Darkness/pollution can still consume that last living reserve.
    bite = Math.min(bite, Math.max(0, target.amount - (target.root || 0)));
    target.amount -= bite;
  } else {
    const plantBody = bodyOf(target);
    const energy = Math.min(bite, Math.max(0, target.energy - plantBody.rootReserve));
    target.energy -= energy;
    const tissue = Math.min(bite - energy, Math.max(0, target.tissue - plantBody.holdfast));
    target.tissue -= tissue;
    const healthLoss = tissue / Math.max(1, plantBody.tissue) * target.maxHealth;
    damageCreature(target, healthLoss);
    bite = energy + tissue;
  }
  consumeFood(c, bite, assimilation, toxin, dt);
  c.state = "comiendo";
}

function consumeFood(c, amount, assimilation, toxin, dt) {
  c.energy = Math.min(c.maxEnergy, c.energy + amount * assimilation);
  damageCreature(c, amount * toxin * 0.022);
  recycleNutrients(c, amount * (1 - assimilation) * 0.65);
  c.vx *= Math.exp(-dt * 12); c.vy *= Math.exp(-dt * 12);
}

function hunt(c, sp, dt, cachedBrain) {
  if (!wantsFood(c)) return rest(c, dt);
  const brain = cachedBrain || sense(c, sp, 0, true);
  if (!brain.target || !targetAlive(brain.target, brain.kind)) return patrolForFood(c, sp, dt);
  if(brain.kind==='prey' && getSpecies(brain.target)?.class==='carnivore' && !canHuntCarnivore(c,brain.target)) {
    releaseFoodClaim(brain);brain.wait=0;return patrolForFood(c,sp,dt);
  }
  const target = brain.target, body = bodyOf(c, sp);
  if (dist(c, target) > c.size + (target.radius || target.size) + 7) {
    c.state = brain.kind === "corpse" ? "buscando carroña" : "persiguiendo";
    const sprint=brain.kind==='prey' && c.energy>c.maxEnergy*0.25 ? 1.2 : 1;
    return steerToward(c, target, body.speed * (c.activity || 1) * sprint / 58, dt);
  }
  if (brain.kind === "corpse") return eatCorpseBite(c, sp, target, dt);
  const preyBody = bodyOf(target);
  damageCreature(target, dt * body.damage * preyBody.armor * (c.activity || 1));
  damageCreature(c, dt * (target.genes.defense * 0.1 + target.genes.toxicity * 0.15) * body.armor);
  c.energy -= dt * (0.2 + c.genes.attack * 0.055);
  // Keep swimming during a strike; braking here makes fleeing prey escape after
  // every bite regardless of the predator's speed advantage.
  steerToward(c, target, body.speed * (c.activity || 1) / 58, dt);
  c.state = "cazando";
  // Damage is not nutrition: the victim becomes one finite corpse at the end of the step.
  if (target.health <= 0) { releaseFoodClaim(brain); brain.wait = 0; }
}

function eatCorpseBite(c, sp, corpse, dt) {
  const body = bodyOf(c, sp), toxin = corpse.toxicity || 0;
  const assimilation = body.assimilation * Math.max(0.3, 1 - toxin * 0.045);
  const bite = Math.min(corpse.amount, dt * body.intake * (c.activity || 1), Math.max(0, (c.maxEnergy - c.energy) / assimilation));
  corpse.amount -= bite;
  consumeFood(c, bite, assimilation, toxin, dt);
  c.state = "carroñeando";
}

function patrolForFood(c, sp, dt) {
  c.wanderTime -= dt;
  if (c.wanderTime <= 0 || c.wanderX == null || Math.hypot(c.x - c.wanderX, c.y - c.wanderY) < 55) {
    const angle = rand(0, Math.PI * 2), distance = rand(250, 650);
    c.wanderX = clamp(c.x + Math.cos(angle) * distance, 40, state.worldSize - 40);
    c.wanderY = clamp(c.y + Math.sin(angle) * distance, 40, state.worldSize - 40);
    c.wanderTime = rand(3, 7);
  }
  c.state = "explorando";
  steerToward(c, {x: c.wanderX, y: c.wanderY}, bodyOf(c, sp).speed * (c.activity || 1) / 58 * 0.7, dt);
}

function wantsFood(c) {
  // Separate hunger/satiety thresholds prevent restarting a hunt after spending
  // one frame's energy. Recovered reserves allow time to rest and reproduce.
  if (c.hungry == null || c.energy < c.maxEnergy * 0.55) c.hungry = true;
  if (c.energy >= c.maxEnergy * 0.95) c.hungry = false;
  return c.hungry;
}

function rest(c, dt) {
  releaseFoodClaim(c._brain);
  c.state = "saciado"; c.vx *= Math.exp(-dt * 4); c.vy *= Math.exp(-dt * 4);
}

function steerToward(c, target, speed, dt) {
  const dx = target.x - c.x, dy = target.y - c.y;
  const length = Math.hypot(dx, dy) || 1;
  const turn = 1 - Math.exp(-dt * 4);
  c.vx += (dx / length * speed - c.vx) * turn;
  c.vy += (dy / length * speed - c.vy) * turn;
}

function steerAway(c, target, speed, dt) {
  steerToward(c, {x: c.x * 2 - target.x, y: c.y * 2 - target.y}, speed, dt);
}

function inheritGenes(parent, sp) {
  const genes = {...(parent.genes || sp.traits)};
  if (state.mutationRate <= 0) return genes;
  for (const key of traitKeys) {
    if (traitMax(key, sp.class) === 0 || Math.random() > 0.65) continue;
    const scale = traitMax(key, sp.class) / 10;
    genes[key] = clamp(genes[key] + rand(-1, 1) * state.mutationRate * 8 * scale, traitMin(key, sp.class), traitMax(key, sp.class));
  }
  return genes;
}

function geneticDistance(a, b, type) {
  let sum = 0, count = 0;
  for (const key of traitKeys) {
    const max = traitMax(key, type);
    if (!max) continue;
    sum += ((a[key] - b[key]) / max) ** 2; count++;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function maybeMutateSpecies(sp, parent, genes = inheritGenes(parent, sp)) {
  if (state.mutationRate <= 0 || geneticDistance(genes, sp.traits, sp.class) < 0.12) return sp;
  const existing=state.species.find(child=>child.parentId===sp.id && !child.extinct && geneticDistance(genes,child.traits,sp.class)<0.06);
  if (existing) return existing;
  if (state.species.length >= MAX_EVOLVED_SPECIES && !retireExtinctVariation()) return sp;
  const depth=((Number(sp.variationDepth)||0)+1)%3, serial=state.nextSpeciesId++;
  const identity=depth===0 ? localEvolutionIdentity(sp,genes,serial) : null;
  const child = normalizeSpecies({...sp, id: uid("sp"), parentId: sp.id,
    variationDepth:depth,identityId:sp.identityId,lineageName:identity?.name || sp.lineageName,
    variationOrdinal:1+state.species.reduce((max,other)=>other.identityId===sp.identityId && other.variationDepth===depth
      ? Math.max(max,other.variationOrdinal) : max,0),
    name:identity?.name || sp.name,description:identity?.description || sp.description,
    visualDescription:identity?.visualDescription || sp.visualDescription,
    spritePrompt:identity?.visualDescription || sp.spritePrompt,
    portraitUrl:identity ? "" : sp.portraitUrl,spriteUrl:identity ? "" : sp.spriteUrl,
    artworkVersion:identity ? 0 : sp.artworkVersion,artworkError:"",evolutionError:"",
    evolutionSource:identity ? {identityId:sp.identityId,name:sp.lineageName,description:sp.description,
      visualDescription:sp.visualDescription,traits:{...sp.traits}} : null,
    evolutionTextStatus:identity ? (state.evolutionAiEnabled ? "pending" : "local") : "none",
    evolutionImageStatus:identity ? (state.evolutionAiEnabled ? "pending" : "local") : "none",
    traits: genes, generation: parent.generation + 1, color: colorFor(sp.class, genes)});
  if (depth) child.name=variationName(child);
  state.species.push(child); speciesById.set(child.id, child);
  state.lastEvent = `${depth ? "Nueva variación" : "Nueva especie"}: ${child.name}`;
  return child;
}

function migrateEcology(legacy = false) {
  initHabitats(legacy ? null : state.habitats);
  for (const r of state.resources) r.root = Number.isFinite(r.root) ? clamp(r.root, 0, r.max) : r.max * 0.08;
  for (const sp of state.species) sp.traits = sanitizeGenes(sp.traits, sp.class);
  for (const c of state.creatures) {
    const body = bodyOf(c);
    const healthRatio = clamp(c.health / c.maxHealth, 0, 1);
    c.size = body.size; c.maxHealth = body.maxHealth; c.health = body.maxHealth * healthRatio;
    c.maxEnergy = body.maxEnergy; c.energy = Math.min(c.maxEnergy, c.energy);
    c.tissue = clamp(Number.isFinite(c.tissue) ? c.tissue : body.tissue, 0, body.tissue);
    if (legacy) c.cooldown /= 20;
  }
}

function recalcSpecies() {
  const counts = new Map();
  for (const c of state.creatures) counts.set(c.speciesId, (counts.get(c.speciesId) || 0) + 1);
  for (const sp of state.species) {
    const old = sp.population || 0;
    sp.population = counts.get(sp.id) || 0;
    if (old > 0 && sp.population === 0 && !sp.extinct) {
      sp.extinct = true; state.extinct++; state.lastEvent = `Extinción: ${sp.name}`;
    }
  }
}
