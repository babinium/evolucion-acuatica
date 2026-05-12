const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");

const traitKeys = [
  "size", "speed", "attack", "defense", "perception", "fertility",
  "metabolism", "foodEfficiency", "toxicity"
];

const traitLabels = {
  size: "Tamano",
  speed: "Velocidad",
  attack: "Ataque",
  defense: "Defensa",
  perception: "Percepcion",
  fertility: "Fertilidad",
  metabolism: "Metabolismo",
  foodEfficiency: "Eficiencia",
  toxicity: "Toxicidad"
};

const envDefs = {
  temperature: ["Temp.", 0, 100, 48, "Sube el metabolismo de animales y acelera la descomposicion de cadaveres; con alta temperatura gastan energia mas rapido."],
  light: ["Luz", 0, 100, 68, "Aumenta la energia que ganan los productores por fotosintesis y mejora el crecimiento de alga base."],
  oxygen: ["Oxigeno", 0, 100, 62, "Ayuda al crecimiento de alga base; si baja mucho, los individuos empiezan a perder salud."],
  nutrients: ["Nutrientes", 0, 100, 70, "Aumenta la energia de los productores y favorece el crecimiento de alga base."],
  toxicity: ["Toxicidad", 0, 100, 12, "Daña a los individuos cuando es muy alta y reduce el crecimiento/vida del alga base."],
  currents: ["Corriente", 0, 100, 35, "Aumenta levemente la velocidad maxima de movimiento de los animales."],
  algaeRate: ["Algas", 0, 100, 16, "Controla la probabilidad de aparicion de alga base por cuadrante del mapa."]
};

const state = {
  started: false,
  paused: false,
  speed: 1,
  day: 0,
  worldSize: 3600,
  chaos: 0.55,
  mutationRate: 0.09,
  selected: null,
  activeTool: null,
  toolRadius: 210,
  mouse: { x: 0, y: 0, worldX: 0, worldY: 0 },
  camera: { x: 1200, y: 1100, zoom: 0.45 },
  env: {},
  envTarget: {},
  species: [],
  creatures: [],
  resources: [],
  corpses: [],
  zones: [],
  extinct: 0,
  nextSpeciesId: 1,
  nextCreatureId: 1,
  lastEvent: "Esperando inicio",
  aiCalls: 0
};

const spriteCache = new Map();

const toolDefs = {
  nutrientBloom: { radius: 190, tip: "Crea una floracion de nutrientes y comida natural en el area." },
  protect: { radius: 220, tip: "Protege temporalmente a los individuos dentro del area." },
  disaster: { radius: 230, tip: "Daña a los individuos dentro del area para probar resiliencia." },
  favor: { radius: 150, tip: "Crea nuevos individuos de la especie seleccionada cerca del click." }
};

function logError(message) {
  const box = document.getElementById("errorLog");
  if (!box) return;
  box.classList.remove("hidden");
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  box.textContent = box.textContent ? `${box.textContent}\n${line}` : line;
}

function showBusy(title, message) {
  document.getElementById("busyTitle").textContent = title;
  document.getElementById("busyMessage").textContent = message;
  document.getElementById("busySpinner").classList.remove("hidden");
  document.getElementById("busyClose").classList.add("hidden");
  document.getElementById("busyOverlay").classList.remove("hidden", "error");
}

function updateBusy(message) {
  document.getElementById("busyMessage").textContent = message;
}

function showBusyError(title, message) {
  document.getElementById("busyTitle").textContent = title;
  document.getElementById("busyMessage").textContent = message;
  document.getElementById("busySpinner").classList.add("hidden");
  document.getElementById("busyClose").classList.remove("hidden");
  document.getElementById("busyOverlay").classList.remove("hidden");
  document.getElementById("busyOverlay").classList.add("error");
}

function hideBusy() {
  document.getElementById("busyOverlay").classList.add("hidden");
}

async function loadConfigStatus() {
  const statusEl = document.getElementById("setupStatus");
  const helpEl = document.getElementById("configHelp");
  const aiButton = document.getElementById("startAI");
  const aiTextButton = document.getElementById("startAIText");
  try {
    const response = await fetch("/api/config-status");
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || "No se pudo leer la configuracion.");

    aiButton.disabled = !status.canUseAiImages;
    aiTextButton.disabled = !status.canUseAiText;

    if (status.canUseAiImages) {
      statusEl.textContent = "APIs listas: puedes crear mundos con IA e imagenes.";
      helpEl.classList.add("hidden");
      return;
    }
    if (status.canUseAiText) {
      statusEl.textContent = "Gemini esta listo. Falta togetherApiKey para crear imagenes IA.";
      return;
    }
    statusEl.textContent = `Faltan claves en config.local.json: ${status.missing.join(", ")}. Puedes usar Demo sin IA.`;
  } catch (error) {
    aiButton.disabled = true;
    aiTextButton.disabled = true;
    statusEl.textContent = "Abre el juego desde python3 server.py para usar APIs locales. Puedes probar Demo sin IA.";
    logError(error.message);
  }
}

let lastTs = 0;
let dragging = false;
let lastMouse = { x: 0, y: 0 };
const keys = new Set();

function rand(min, max) { return min + Math.random() * (max - min); }
function irand(min, max) { return Math.floor(rand(min, max + 1)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function pick(items) { return items[Math.floor(Math.random() * items.length)]; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

function worldToScreen(x, y) {
  return { x: (x - state.camera.x) * state.camera.zoom + innerWidth / 2, y: (y - state.camera.y) * state.camera.zoom + innerHeight / 2 };
}

function screenToWorld(x, y) {
  return { x: (x - innerWidth / 2) / state.camera.zoom + state.camera.x, y: (y - innerHeight / 2) / state.camera.zoom + state.camera.y };
}

function normalizeSpecies(raw) {
  const traits = {};
  const rawClass = raw.class || "herbivore";
  for (const key of traitKeys) {
    const max = traitMax(key, rawClass);
    const min = traitMin(key, rawClass);
    const fallback = key === "fertility" ? (rawClass === "producer" ? 18 : 10) : 5;
    traits[key] = clamp(Number(raw.traits?.[key] ?? fallback), min, max);
  }
  if (rawClass === "producer") {
    traits.attack = 0;
    traits.speed = Math.min(traits.speed, 2);
  }
  if (rawClass === "herbivore") traits.attack = 0;
  return {
    id: raw.id || uid("sp"),
    parentId: raw.parentId || null,
    name: raw.name || "Especie sin nombre",
    class: rawClass,
    description: raw.description || "Especie acuatica generada proceduralmente.",
    visualDescription: raw.visualDescription || "Silueta acuatica simple.",
    diet: raw.diet || "Recursos del ecosistema",
    habitat: raw.habitat || "Aguas medias",
    behavior: raw.behavior || "Explora, come y se reproduce.",
    strengths: raw.strengths || [],
    weaknesses: raw.weaknesses || [],
    traits,
    portraitPrompt: raw.portraitPrompt || `Detailed scientific illustration of ${raw.visualDescription || raw.name}, aquatic creature, white background, centered, no text.`,
    spritePrompt: raw.spritePrompt || `Simple filled top-down game sprite of ${raw.visualDescription || raw.name}, solid chroma blue background, centered, no text, filled colored body, not line art.`,
    portraitUrl: raw.portraitUrl || "",
    spriteUrl: raw.spriteUrl || "",
    color: raw.color || colorFor(raw.class, traits),
    population: 0,
    extinct: false,
    generation: raw.generation || 1
  };
}

function colorFor(type, traits) {
  if (type === "producer") return `hsl(${115 + traits.toxicity * 8}, 62%, ${42 + traits.defense * 2}%)`;
  if (type === "herbivore") return `hsl(${185 + traits.perception * 6}, 68%, ${50 + traits.speed * 2}%)`;
  return `hsl(${350 + traits.attack * 2}, 78%, ${48 + traits.attack * 2}%)`;
}

function fallbackSpecies(producers, herbivores, carnivores) {
  const result = [];
  const blueprints = {
    producer: ["Alga cristal", "Coral aguja", "Manto verde", "Espiral luminica"],
    herbivore: ["Nadador palido", "Concha veloz", "Branquia azul", "Pez espina"],
    carnivore: ["Diente rojo", "Sombra curva", "Mordedor abisal", "Lanza negra"]
  };
  for (const [type, count] of [["producer", producers], ["herbivore", herbivores], ["carnivore", carnivores]]) {
    for (let i = 0; i < count; i++) {
      const base = type === "producer"
        ? { size: rand(2, 7), speed: 0, attack: 0, defense: rand(1, 7), fertility: rand(10, 30), metabolism: rand(1, 5), foodEfficiency: rand(5, 9), toxicity: rand(0, 5) }
        : type === "herbivore"
          ? { size: rand(2, 7), speed: rand(3, 9), attack: 0, defense: rand(2, 8), fertility: rand(5, 20), metabolism: rand(2, 7), foodEfficiency: rand(3, 9), toxicity: rand(0, 4) }
          : { size: rand(3, 9), speed: rand(6, 10), attack: rand(4, 10), defense: rand(1, 7), fertility: rand(5, 20), metabolism: rand(4, 10), foodEfficiency: rand(2, 8), toxicity: rand(0, 3) };
      const traits = {};
      for (const key of traitKeys) {
        const max = traitMax(key, type);
        const min = traitMin(key, type);
        traits[key] = clamp(base[key] ?? (key === "fertility" ? rand(min, max) : rand(2, 8)), min, max);
      }
      result.push(normalizeSpecies({
        name: `${pick(blueprints[type])} ${i + 1}`,
        class: type,
        description: "Especie inicial generada sin IA para probar el ecosistema.",
        visualDescription: type === "producer" ? "colonia acuatica organica" : "criatura acuatica de silueta clara",
        diet: type === "producer" ? "Luz y nutrientes" : type === "herbivore" ? "Productores" : "Herbivoros y carnivoros pequenos",
        habitat: pick(["superficie", "arrecife", "aguas medias", "fondo"]),
        behavior: type === "carnivore" ? "Patrulla y caza presas vulnerables." : "Busca alimento y evita amenazas.",
        traits
      }));
    }
  }
  return result;
}

function initEnvironment() {
  state.env = {};
  state.envTarget = {};
  for (const [key, def] of Object.entries(envDefs)) {
    state.env[key] = def[3];
    state.envTarget[key] = def[3];
  }
}

function seedWorld(speciesList) {
  state.species = speciesList.map((sp) => normalizeSpecies({ ...sp, extinct: false, population: 0 }));
  state.creatures = [];
  state.resources = [];
  state.corpses = [];
  state.zones = [];
  state.day = 0;
  state.extinct = 0;
  state.lastEvent = "Mundo iniciado";
  state.selected = null;
  state.nextCreatureId = 1;
  state.nextSpeciesId = state.species.length + 1;
  initEnvironment();

  for (let i = 0; i < 90; i++) spawnResource(rand(0, state.worldSize), rand(0, state.worldSize), rand(35, 120));
  for (const sp of state.species) {
    const count = sp.class === "producer" ? 42 : sp.class === "herbivore" ? 24 : 10;
    for (let i = 0; i < count; i++) spawnCreature(sp, rand(120, state.worldSize - 120), rand(120, state.worldSize - 120), 0);
  }
  recalcSpecies();
  state.started = true;
  document.getElementById("setup").classList.add("hidden");
  updateSelection();
}

function restartCurrentWorld() {
  if (!state.species.length) {
    location.reload();
    return;
  }
  const speciesTemplates = state.species.map((sp) => ({
    ...sp,
    population: 0,
    extinct: false
  }));
  seedWorld(speciesTemplates);
  state.lastEvent = "Mundo reiniciado con las mismas especies";
}

function spawnResource(x, y, amount) {
  state.resources.push({ id: uid("alga"), name: "Alga base", x, y, amount, max: amount, radius: Math.sqrt(amount) * 2.3 });
}

function spawnCreature(species, x, y, generation) {
  const t = species.traits;
  const size = Math.max(3, 4 + t.size * 2.2);
  state.creatures.push({
    id: state.nextCreatureId++,
    speciesId: species.id,
    x, y,
    vx: rand(-1, 1),
    vy: rand(-1, 1),
    size,
    age: rand(0, 40),
    health: 60 + t.size * 7 + t.defense * 4,
    maxHealth: 60 + t.size * 7 + t.defense * 4,
    energy: rand(45, 90),
    generation: generation || species.generation,
    state: "explorando",
    targetId: null,
    cooldown: rand(20, 120),
    protected: 0,
    wanderX: null,
    wanderY: null,
    wanderTime: 0
  });
}

async function startWorld(useAI, withImages = true) {
  const producers = Number(document.getElementById("setupProducers").value);
  const herbivores = Number(document.getElementById("setupHerbivores").value);
  const carnivores = Number(document.getElementById("setupCarnivores").value);
  state.worldSize = Number(document.getElementById("setupSize").value);
  state.chaos = Number(document.getElementById("setupChaos").value);
  state.mutationRate = Number(document.getElementById("setupMutation").value);
  state.camera.x = state.worldSize / 2;
  state.camera.y = state.worldSize / 2;
  const setupStatus = document.getElementById("setupStatus");

  if (!useAI) {
    seedWorld(fallbackSpecies(producers, herbivores, carnivores));
    return;
  }

  try {
    showBusy("Creando mundo", "Generando especies con Gemini...");
    setupStatus.textContent = "Generando especies con Gemini...";
    state.aiCalls++;
    const response = await fetch("/api/generate-species", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ producers, herbivores, carnivores, world: { chaos: state.chaos, mutationRate: state.mutationRate } })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudieron generar especies.");
    const species = data.species.map(normalizeSpecies);

    if (withImages) {
      for (let i = 0; i < species.length; i++) {
        const message = `Generando imagenes IA ${i + 1}/${species.length}...`;
        setupStatus.textContent = message;
        updateBusy(message);
        await addImagesToSpeciesWithRetry(species[i], setupStatus);
      }
    }
    localStorage.setItem("evo-last-ai-species", JSON.stringify(species));
    hideBusy();
    seedWorld(species);
  } catch (error) {
    const message = `Fallo IA: ${error.message}. Vuelve a intentar crear el mundo.`;
    setupStatus.textContent = message;
    showBusyError("No se pudo crear el mundo", message);
    logError(message);
  }
}

async function addImagesToSpecies(species) {
  state.aiCalls++;
  const response = await fetch("/api/generate-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompts: [
        { mode: "portrait", prompt: `${species.portraitPrompt}. Clean white background, isolated subject, no text, no watermark.` },
        { mode: "sprite", prompt: `${species.spritePrompt}. Simple filled 2D game sprite, top-down readable silhouette, solid colored body with visible interior color, not outline-only, not line art, no hollow center, head/front facing exactly to the right, tail/back to the left, side profile oriented horizontally, solid chroma blue background (#0047ff), avoid blue creature colors, no text, no shadow.` }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudieron generar imagenes.");
  species.portraitUrl = data.images?.[0] || "";
  species.spriteUrl = data.images?.[1] || "";
  if (!species.portraitUrl || !species.spriteUrl) throw new Error("La API no devolvio ambas imagenes.");
}

async function addImagesToSpeciesWithRetry(species, statusEl) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) {
        const retryMessage = `Reintentando imagenes de ${species.name} (${attempt}/3)...`;
        statusEl.textContent = retryMessage;
        updateBusy(retryMessage);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      await addImagesToSpecies(species);
      return;
    } catch (error) {
      lastError = error;
      const message = `Intento ${attempt}/3 fallo para ${species.name}: ${error.message}`;
      statusEl.textContent = message;
      updateBusy(message);
      logError(message);
    }
  }
  throw new Error(`No se pudieron crear las imagenes de ${species.name} despues de 3 intentos. ${lastError?.message || ""}`);
}

function getSpecies(creature) {
  return state.species.find((s) => s.id === creature.speciesId);
}

function update(dt) {
  if (!state.started || state.paused) return;
  const simDt = dt * state.speed;
  state.day += simDt * 0.018;
  updateCamera(simDt);
  updateEnvironment(simDt);
  updateResources(simDt);
  updateCorpses(simDt);
  updateZones(simDt);
  updateCreatures(simDt);
  recalcSpecies();
}

function updateCamera(dt) {
  const pan = 520 * dt / Math.max(0.5, state.camera.zoom);
  if (keys.has("w") || keys.has("arrowup")) state.camera.y -= pan;
  if (keys.has("s") || keys.has("arrowdown")) state.camera.y += pan;
  if (keys.has("a") || keys.has("arrowleft")) state.camera.x -= pan;
  if (keys.has("d") || keys.has("arrowright")) state.camera.x += pan;
  state.camera.x = clamp(state.camera.x, 0, state.worldSize);
  state.camera.y = clamp(state.camera.y, 0, state.worldSize);
}

function updateEnvironment(dt) {
  for (const key of Object.keys(state.env)) {
    if (Math.random() < dt * 0.015 * state.chaos) {
      const def = envDefs[key];
      state.envTarget[key] = clamp(state.envTarget[key] + rand(-18, 18) * state.chaos, def[1], def[2]);
    }
    state.env[key] += (state.envTarget[key] - state.env[key]) * dt * 0.08;
  }
}

function updateResources(dt) {
  const growth = (state.env.light + state.env.nutrients + state.env.oxygen) / 300;
  spawnAlgaeByQuadrant(dt, growth);
  for (const r of state.resources) {
    r.amount = clamp(r.amount + dt * growth * 2.2 - state.env.toxicity * dt * 0.01, 0, r.max * 1.6);
    r.radius = Math.sqrt(Math.max(1, r.amount)) * 2.2;
  }
  state.resources = state.resources.filter((r) => r.amount > 2);
}

function spawnAlgaeByQuadrant(dt, growth) {
  const quadrantsPerSide = 4;
  const cellSize = state.worldSize / quadrantsPerSide;
  const chance = dt * (state.env.algaeRate / 100);
  for (let qx = 0; qx < quadrantsPerSide; qx++) {
    for (let qy = 0; qy < quadrantsPerSide; qy++) {
      if (Math.random() >= chance) continue;
      const x = rand(qx * cellSize, (qx + 1) * cellSize);
      const y = rand(qy * cellSize, (qy + 1) * cellSize);
      spawnResource(x, y, rand(18, 55) * Math.max(0.35, growth));
    }
  }
}

function updateCorpses(dt) {
  for (const corpse of state.corpses) {
    corpse.amount -= dt * (0.45 + state.env.temperature * 0.01);
    corpse.radius = Math.sqrt(Math.max(1, corpse.amount)) * 1.7;
  }
  state.corpses = state.corpses.filter((corpse) => corpse.amount > 3);
}

function updateZones(dt) {
  for (const z of state.zones) {
    if (z.ttl !== 9999) z.ttl -= dt;
  }
  state.zones = state.zones.filter((z) => z.ttl > 0);
}

function updateCreatures(dt) {
  const newborns = [];
  const deaths = [];
  for (const c of state.creatures) {
    const sp = getSpecies(c);
    if (!sp) continue;
    const t = sp.traits;
    c.age += dt * 0.55;
    c.cooldown = Math.max(0, c.cooldown - dt * 20);
    c.protected = Math.max(0, c.protected - dt);
    const classCost = sp.class === "herbivore" ? 0.68 : sp.class === "carnivore" ? 0.86 : 0.42;
    const metabolism = (0.55 + t.metabolism * 0.13 + t.size * 0.055 + t.speed * 0.025) * classCost * dt;
    c.energy -= metabolism * (0.7 + state.env.temperature / 120);
    c.health += c.protected > 0 ? dt * 2 : 0;
    c.health = clamp(c.health, 0, c.maxHealth);

    if (sp.class === "producer") producerThink(c, sp, dt);
    else animalThink(c, sp, dt);

    c.x = clamp(c.x + c.vx * dt * 58, 8, state.worldSize - 8);
    c.y = clamp(c.y + c.vy * dt * 58, 8, state.worldSize - 8);

    const energyRatio = clamp(c.energy / 120, 0, 1);
    const canReproduce = c.energy > 35
      && c.cooldown <= 0
      && !isCrowdedForReproduction(c, sp);
    const reproductionChance = dt * (0.009 + t.fertility * 0.0028) * energyRatio;
    if (canReproduce && Math.random() < reproductionChance) {
      c.energy *= 0.56;
      c.cooldown = Math.max(28, 96 - t.fertility * 3.2);
      newborns.push({ parent: c, species: maybeMutateSpecies(sp, c) });
    }

    if (c.energy < 0) c.health += c.energy * dt * 0.9;
    if (state.env.oxygen < 18) c.health -= dt * (18 - state.env.oxygen) * 0.18;
    if (state.env.toxicity > 62) c.health -= dt * (state.env.toxicity - 62) * 0.08;
    if (c.age > 260 + t.size * 18) c.health -= dt * 3;
  }

  for (const item of newborns) {
    spawnCreature(item.species, item.parent.x + rand(-35, 35), item.parent.y + rand(-35, 35), item.parent.generation + 1);
  }
  const before = state.creatures.length;
  state.creatures = state.creatures.filter((c) => {
    const alive = c.health > 0 && c.energy > -35;
    if (!alive) deaths.push(c);
    return alive;
  });
  for (const dead of deaths) {
    const sp = getSpecies(dead);
    if (sp && sp.class !== "producer") {
      state.corpses.push({
        id: uid("corpse"),
        x: dead.x,
        y: dead.y,
        amount: 22 + sp.traits.size * 9 + Math.max(0, dead.energy * 0.35),
        radius: dead.size
      });
    }
  }
  if (before !== state.creatures.length && Math.random() < 0.25) state.lastEvent = `${before - state.creatures.length} muertes recientes`;
}

function isCrowdedForReproduction(creature, species) {
  if ((species.class === "herbivore" || species.class === "carnivore")
    && sameSpeciesInQuadrant(creature) > 20) {
    return true;
  }
  const radius = species.class === "producer"
    ? 115 + species.traits.size * 8
    : species.class === "herbivore"
      ? 170 + species.traits.size * 10
      : 230 + species.traits.size * 12;
  const limit = species.class === "producer"
    ? 7
    : species.class === "herbivore"
      ? 14
      : 9;
  let nearby = 0;
  for (const other of state.creatures) {
    if (other.id === creature.id || other.speciesId !== creature.speciesId) continue;
    if (Math.hypot(creature.x - other.x, creature.y - other.y) < radius) {
      nearby++;
      if (nearby >= limit) return true;
    }
  }
  return false;
}

function sameSpeciesInQuadrant(creature) {
  const quadrantsPerSide = 4;
  const cellSize = state.worldSize / quadrantsPerSide;
  const qx = Math.floor(clamp(creature.x, 0, state.worldSize - 1) / cellSize);
  const qy = Math.floor(clamp(creature.y, 0, state.worldSize - 1) / cellSize);
  let count = 0;
  for (const other of state.creatures) {
    if (other.speciesId !== creature.speciesId) continue;
    const ox = Math.floor(clamp(other.x, 0, state.worldSize - 1) / cellSize);
    const oy = Math.floor(clamp(other.y, 0, state.worldSize - 1) / cellSize);
    if (ox === qx && oy === qy) count++;
  }
  return count;
}

function producerThink(c, sp, dt) {
  c.state = "fotosintesis";
  c.vx *= 0.88;
  c.vy *= 0.88;
  c.energy += dt * (state.env.light * 0.035 + state.env.nutrients * 0.025) * (sp.traits.foodEfficiency / 7);
  c.energy = clamp(c.energy, 0, 120);
}

function animalThink(c, sp, dt) {
  const t = sp.traits;
  let nearestThreat = null;
  let threatD = 99999;
  if (sp.class === "herbivore") {
    for (const other of state.creatures) {
      const osp = getSpecies(other);
      if (!osp || osp.class !== "carnivore") continue;
      const d = dist(c, other);
      if (d < threatD && d < 130 + t.perception * 18) { nearestThreat = other; threatD = d; }
    }
  }
  if (nearestThreat && Math.random() > t.defense / 13) {
    c.state = "huyendo";
    steerAway(c, nearestThreat, t.speed);
    return;
  }

  if (sp.class === "herbivore") eatProducer(c, sp, dt);
  if (sp.class === "carnivore") hunt(c, sp, dt);

  if (Math.random() < dt * 0.55) {
    c.vx += rand(-1, 1) * (0.35 + t.speed * 0.055);
    c.vy += rand(-1, 1) * (0.35 + t.speed * 0.055);
  }
  const max = 0.35 + t.speed * 0.18 + state.env.currents * 0.002;
  const len = Math.hypot(c.vx, c.vy) || 1;
  if (len > max) { c.vx = (c.vx / len) * max; c.vy = (c.vy / len) * max; }
}

function eatProducer(c, sp, dt) {
  let best = null;
  let bestD = 99999;
  let bestType = null;
  const hungry = c.energy < 82;
  const searchRadius = foodVisionRadius(c, sp, 520, 135);
  for (const other of state.creatures) {
    const otherSp = getSpecies(other);
    if (!otherSp || otherSp.class !== "producer") continue;
    const d = Math.hypot(c.x - other.x, c.y - other.y);
    const foodValue = other.energy + other.health * 0.35;
    const score = d - foodValue * 0.08 + otherSp.traits.defense * 8 + otherSp.traits.toxicity * 12;
    if (d < searchRadius && score < bestD) {
      best = other;
      bestD = score;
      bestType = "producer";
    }
  }
  for (const alga of state.resources) {
    const d = Math.hypot(c.x - alga.x, c.y - alga.y);
    const score = d - alga.amount * 0.18;
    if (d < searchRadius && score < bestD) {
      best = alga;
      bestD = score;
      bestType = "alga";
    }
  }
  if (!best) {
    c.state = "explorando por comida";
    c.wanderTime -= dt;
    const needsNewTarget = c.wanderTime <= 0
      || c.wanderX === null
      || Math.hypot(c.x - c.wanderX, c.y - c.wanderY) < 80;
    if (needsNewTarget) {
      const angle = rand(0, Math.PI * 2);
      const distance = rand(420, 900) + sp.traits.perception * 35;
      c.wanderX = clamp(c.x + Math.cos(angle) * distance, 40, state.worldSize - 40);
      c.wanderY = clamp(c.y + Math.sin(angle) * distance, 40, state.worldSize - 40);
      c.wanderTime = rand(3.5, 7.5);
    }
    steerToward(c, { x: c.wanderX, y: c.wanderY }, sp.traits.speed + 1.5);
    return;
  }
  c.wanderTime = 0;
  const distanceToFood = Math.hypot(c.x - best.x, c.y - best.y);
  if (bestType === "alga") {
    if (distanceToFood < c.size + best.radius + 12) {
      const amount = Math.min(best.amount, dt * (4.2 + sp.traits.foodEfficiency * 1.15));
      best.amount -= amount;
      c.energy = clamp(c.energy + amount * 0.68, 0, 130);
      c.health = clamp(c.health + dt * 0.7, 0, c.maxHealth);
      c.state = "comiendo alga base";
      c.vx *= 0.72;
      c.vy *= 0.72;
    } else {
      c.state = "buscando alga base";
      steerToward(c, best, sp.traits.speed + 2);
    }
    return;
  }
  const producerSp = getSpecies(best);
  if (distanceToFood < c.size + best.size + 12) {
    const bite = dt * (4.6 + sp.traits.foodEfficiency * 1.25);
    const defenseCost = producerSp.traits.defense * 0.16 + producerSp.traits.toxicity * 0.28;
    best.energy -= bite * 0.32;
    best.health -= Math.max(0.6, bite - defenseCost);
    c.energy = clamp(c.energy + Math.max(0.4, bite * (0.76 - producerSp.traits.toxicity * 0.025)), 0, 130);
    if (producerSp.traits.toxicity > 0) c.health -= dt * producerSp.traits.toxicity * 0.18;
    c.health = clamp(c.health + dt * 1.2, 0, c.maxHealth);
    c.state = "comiendo";
    c.vx *= 0.72;
    c.vy *= 0.72;
  } else {
    c.state = "buscando plantas";
    steerToward(c, best, sp.traits.speed + 2);
  }
}

function hunt(c, sp, dt) {
  if (c.energy > 78) {
    c.state = "descansando";
    c.vx *= 0.94;
    c.vy *= 0.94;
    return;
  }

  if (eatCorpse(c, sp, dt)) return;

  let prey = null;
  let bestScore = -99999;
  const huntRadius = foodVisionRadius(c, sp, 170, 22);
  for (const other of state.creatures) {
    if (other.id === c.id) continue;
    const osp = getSpecies(other);
    if (!osp || osp.class === "producer") continue;
    if (other.speciesId === c.speciesId) continue;
    const d = dist(c, other);
    if (d > huntRadius) continue;
    const weakness = (other.maxHealth - other.health) * 0.18 + (100 - other.energy) * 0.08;
    const sizeRisk = Math.max(0, osp.traits.size - sp.traits.size) * 6;
    const score = (osp.class === "herbivore" ? 28 : 8)
      + weakness
      + other.energy * 0.32
      - d * 0.18
      - osp.traits.defense * 4.2
      - osp.traits.toxicity * 6
      - sizeRisk;
    if (score > bestScore) { bestScore = score; prey = other; }
  }
  if (!prey) { c.state = "patrullando"; return; }
  if (dist(c, prey) < c.size + prey.size + 4) {
    const preySp = getSpecies(prey);
    const attack = sp.traits.attack + sp.traits.speed * 0.5 + sp.traits.size * 0.25 + rand(-3, 3);
    const defense = preySp.traits.defense + preySp.traits.speed * 0.35 + preySp.traits.toxicity * 0.25 + rand(-3, 3);
    if (attack > defense) {
      prey.health -= dt * (20 + sp.traits.attack * 5.5);
      c.energy = clamp(c.energy + dt * (5 + sp.traits.foodEfficiency * 0.8), 0, 130);
      c.state = "cazando";
      if (prey.health <= 0) {
        const meal = 26 + preySp.traits.size * 8 + Math.max(0, prey.energy * 0.45);
        c.energy = clamp(c.energy + meal, 0, 140);
        state.lastEvent = `${sp.name} cazo a ${preySp.name}`;
      }
    } else {
      c.health -= dt * (preySp.traits.defense * 0.38 + preySp.traits.toxicity * 0.62);
      c.energy -= dt * 2.2;
      prey.energy -= dt * 2;
      c.state = "fallo caza";
    }
  } else {
    c.state = "persiguiendo";
    steerToward(c, prey, sp.traits.speed);
  }
}

function eatCorpse(c, sp, dt) {
  let best = null;
  let bestD = 99999;
  const corpseRadius = foodVisionRadius(c, sp, 210, 18);
  for (const corpse of state.corpses) {
    const d = Math.hypot(c.x - corpse.x, c.y - corpse.y);
    if (d < bestD && d < corpseRadius) {
      best = corpse;
      bestD = d;
    }
  }
  if (!best) return false;
  if (bestD < c.size + best.radius + 8) {
    const bite = Math.min(best.amount, dt * (5 + sp.traits.foodEfficiency * 1.2));
    best.amount -= bite;
    c.energy = clamp(c.energy + bite * 0.8, 0, 130);
    c.state = "carroneando";
  } else {
    steerToward(c, best, sp.traits.speed);
    c.state = "buscando carrona";
  }
  return true;
}

function foodVisionRadius(creature, species, base, perPerception) {
  const normal = base + species.traits.perception * perPerception;
  if (creature.energy >= 0) return normal;
  const desperation = Math.min(3.2, 1 + Math.abs(creature.energy) * 0.065);
  return normal * desperation;
}

function steerToward(c, target, speed) {
  const dx = target.x - c.x;
  const dy = target.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  c.vx += (dx / len) * (0.08 + speed * 0.018);
  c.vy += (dy / len) * (0.08 + speed * 0.018);
}

function steerAway(c, target, speed) {
  const dx = c.x - target.x;
  const dy = c.y - target.y;
  const len = Math.hypot(dx, dy) || 1;
  c.vx += (dx / len) * (0.16 + speed * 0.025);
  c.vy += (dy / len) * (0.16 + speed * 0.025);
}

function maybeMutateSpecies(sp, parent) {
  if (Math.random() > state.mutationRate * 0.015) return sp;
  const traits = { ...sp.traits };
  let drift = 0;
  for (const key of traitKeys) {
    const delta = rand(-1.6, 1.6) * state.mutationRate * 5;
    const max = traitMax(key, sp.class);
    const min = traitMin(key, sp.class);
    traits[key] = clamp(traits[key] + delta, key === "attack" && sp.class !== "carnivore" ? 0 : min, max);
    drift += Math.abs(delta);
  }
  if (sp.class !== "carnivore") traits.attack = 0;
  if (drift < 4.6 || state.species.length > 36) return sp;
  const child = normalizeSpecies({
    ...sp,
    id: uid("sp"),
    parentId: sp.id,
    name: `${sp.name} var. ${state.nextSpeciesId++}`,
    description: `Rama evolucionada de ${sp.name}, surgida por mutaciones y presion ambiental.`,
    traits,
    generation: sp.generation + 1,
    portraitUrl: sp.portraitUrl,
    spriteUrl: sp.spriteUrl,
    color: colorFor(sp.class, traits)
  });
  state.species.push(child);
  state.lastEvent = `Nueva especie: ${child.name}`;
  parent.speciesId = child.id;
  state.selected = parent;
  setTimeout(updateSelection, 0);
  return child;
}

function recalcSpecies() {
  const counts = new Map();
  for (const c of state.creatures) counts.set(c.speciesId, (counts.get(c.speciesId) || 0) + 1);
  for (const sp of state.species) {
    const old = sp.population || 0;
    sp.population = counts.get(sp.id) || 0;
    if (old > 0 && sp.population === 0 && !sp.extinct) {
      sp.extinct = true;
      state.extinct++;
      state.lastEvent = `Extincion: ${sp.name}`;
    }
  }
}

function render() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  drawWater();
  if (state.started) {
    drawResources();
    drawCorpses();
    drawZones();
    drawCreatures();
    drawToolPreview();
    drawWorldBounds();
  }
  updateHud();
  requestAnimationFrame(loop);
}

function drawWater() {
  const g = ctx.createLinearGradient(0, 0, innerWidth, innerHeight);
  g.addColorStop(0, "#082027");
  g.addColorStop(0.45, "#0a3438");
  g.addColorStop(1, "#031115");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!state.started) return;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#9edbd3";
  ctx.lineWidth = 1;
  const step = 180 * state.camera.zoom;
  const ox = ((-state.camera.x * state.camera.zoom + innerWidth / 2) % step + step) % step;
  const oy = ((-state.camera.y * state.camera.zoom + innerHeight / 2) % step + step) % step;
  for (let x = ox; x < innerWidth; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, innerHeight); ctx.stroke(); }
  for (let y = oy; y < innerHeight; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(innerWidth, y); ctx.stroke(); }
  ctx.restore();
}

function inView(x, y, pad = 80) {
  const s = worldToScreen(x, y);
  return s.x > -pad && s.x < innerWidth + pad && s.y > -pad && s.y < innerHeight + pad;
}

function drawResources() {
  for (const r of state.resources) {
    if (!inView(r.x, r.y, r.radius * state.camera.zoom + 40)) continue;
    const s = worldToScreen(r.x, r.y);
    ctx.fillStyle = "rgba(92, 214, 119, 0.34)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(2, r.radius * state.camera.zoom), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCorpses() {
  for (const corpse of state.corpses) {
    if (!inView(corpse.x, corpse.y, corpse.radius * state.camera.zoom + 40)) continue;
    const s = worldToScreen(corpse.x, corpse.y);
    ctx.fillStyle = "rgba(190, 168, 135, 0.42)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(2, corpse.radius * state.camera.zoom), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 231, 190, 0.25)";
    ctx.stroke();
  }
}

function drawZones() {
  for (const z of state.zones) {
    if (!inView(z.x, z.y, z.radius * state.camera.zoom + 60)) continue;
    const s = worldToScreen(z.x, z.y);
    ctx.fillStyle = z.type === "disaster" ? "rgba(255, 95, 80, 0.16)" : z.type === "protect" ? "rgba(103, 167, 255, 0.14)" : "rgba(244, 196, 92, 0.13)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, z.radius * state.camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawToolPreview() {
  if (!state.activeTool || !state.started) return;
  const s = worldToScreen(state.mouse.worldX, state.mouse.worldY);
  const radius = state.toolRadius * state.camera.zoom;
  ctx.save();
  ctx.fillStyle = "rgba(255, 65, 65, 0.12)";
  ctx.strokeStyle = "rgba(255, 80, 70, 0.9)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255, 235, 230, 0.95)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(`${Math.round(state.toolRadius)} px`, s.x + radius + 8, s.y - 8);
  ctx.restore();
}

function drawCreatures() {
  for (const c of state.creatures) {
    if (!inView(c.x, c.y, 60)) continue;
    const sp = getSpecies(c);
    if (!sp) continue;
    const s = worldToScreen(c.x, c.y);
    const r = Math.max(2.4, c.size * state.camera.zoom);
    ctx.save();
    ctx.translate(s.x, s.y);
    const angle = Math.hypot(c.vx, c.vy) > 0.02 ? Math.atan2(c.vy, c.vx) : 0;
    ctx.rotate(angle);
    ctx.globalAlpha = c.protected > 0 ? 1 : 0.88;
    const sprite = getSprite(sp);
    if (sprite?.ready) {
      const drawSize = r * (sp.class === "producer" ? 3.1 : 4.2);
      ctx.drawImage(sprite.canvas, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
    } else if (sp.class === "producer") {
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(230,255,230,0.45)";
      ctx.stroke();
    } else if (sp.class === "herbivore") {
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.35, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.moveTo(-r * 1.25, 0);
      ctx.lineTo(-r * 1.85, -r * 0.5);
      ctx.lineTo(-r * 1.85, r * 0.5);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = sp.color;
      ctx.beginPath();
      ctx.moveTo(r * 1.7, 0);
      ctx.lineTo(-r, -r * 0.85);
      ctx.lineTo(-r * 0.55, 0);
      ctx.lineTo(-r, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.beginPath();
      ctx.arc(r * 0.7, -r * 0.2, Math.max(1, r * 0.13), 0, Math.PI * 2);
      ctx.fill();
    }
    if (state.selected?.id === c.id) {
      ctx.strokeStyle = "#f4c45c";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function getSprite(species) {
  if (!species.spriteUrl) return null;
  if (spriteCache.has(species.id)) return spriteCache.get(species.id);
  const entry = { ready: false, canvas: document.createElement("canvas") };
  spriteCache.set(species.id, entry);
  const img = new Image();
  img.onload = () => {
    entry.canvas = removeSpriteBackground(img);
    entry.ready = true;
  };
  img.onerror = () => spriteCache.delete(species.id);
  img.src = species.spriteUrl;
  return entry;
}

function removeSpriteBackground(img) {
  const size = 192;
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const c = out.getContext("2d");
  c.drawImage(img, 0, 0, size, size);
  const image = c.getImageData(0, 0, size, size);
  const data = image.data;
  const bg = estimateBackgroundColor(data, size);
  removeConnectedBackground(data, size, bg);
  c.putImageData(image, 0, 0);
  return out;
}

function removeConnectedBackground(data, size, bg) {
  const seen = new Uint8Array(size * size);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const p = y * size + x;
    if (seen[p]) return;
    const i = p * 4;
    const dBg = Math.hypot(data[i] - bg.r, data[i + 1] - bg.g, data[i + 2] - bg.b);
    const dBlue = Math.hypot(data[i] - 0, data[i + 1] - 71, data[i + 2] - 255);
    const dMagenta = Math.hypot(data[i] - 255, data[i + 1] - 0, data[i + 2] - 255);
    if (dBg < 96 || dBlue < 120 || dMagenta < 110) {
      seen[p] = 1;
      queue.push([x, y]);
    }
  };
  for (let x = 0; x < size; x++) {
    push(x, 0);
    push(x, size - 1);
  }
  for (let y = 0; y < size; y++) {
    push(0, y);
    push(size - 1, y);
  }
  while (queue.length) {
    const [x, y] = queue.pop();
    const i = (y * size + x) * 4;
    data[i + 3] = 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

function estimateBackgroundColor(data, size) {
  const samples = [];
  const points = [
    [3, 3], [size - 4, 3], [3, size - 4], [size - 4, size - 4],
    [Math.floor(size / 2), 3], [Math.floor(size / 2), size - 4],
    [3, Math.floor(size / 2)], [size - 4, Math.floor(size / 2)]
  ];
  for (const [x, y] of points) {
    const i = (y * size + x) * 4;
    samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  samples.sort((a, b) => colorClusterScore(b, samples) - colorClusterScore(a, samples));
  return samples[0] || { r: 255, g: 0, b: 255 };
}

function colorClusterScore(color, samples) {
  let score = 0;
  for (const other of samples) {
    if (Math.hypot(color.r - other.r, color.g - other.g, color.b - other.b) < 48) score++;
  }
  return score;
}

function drawWorldBounds() {
  const a = worldToScreen(0, 0);
  const b = worldToScreen(state.worldSize, state.worldSize);
  ctx.strokeStyle = "rgba(238, 248, 244, 0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
}

function updateHud() {
  document.getElementById("dayStat").textContent = Math.floor(state.day);
  document.getElementById("popStat").textContent = state.creatures.length;
  document.getElementById("speciesStat").textContent = state.species.filter((s) => !s.extinct).length;
  document.getElementById("extinctStat").textContent = state.extinct;
  document.getElementById("eventStat").textContent = state.lastEvent;
  document.getElementById("speedLabel").textContent = `${state.speed.toFixed(1)}x`;
}

function loop(ts) {
  const dt = Math.min(0.08, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  update(dt);
  render();
}

function updateSelection() {
  const panel = document.getElementById("selectionPanel");
  const empty = document.getElementById("selectionEmpty");
  const c = state.selected;
  if (!c || !state.creatures.includes(c)) {
    panel.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  const sp = getSpecies(c);
  empty.classList.add("hidden");
  panel.classList.remove("hidden");
  const image = sp.portraitUrl ? `<img class="portrait" src="${sp.portraitUrl}" alt="${sp.name}">` : `<div class="portrait"></div>`;
  panel.innerHTML = `
    ${image}
    <span class="species-chip">${className(sp.class)}</span>
    <h2>${sp.name}</h2>
    <p class="hint">${sp.description}</p>
    <div class="detail-grid">
      ${detail("Estado", c.state)}
      ${detail("Generacion", c.generation)}
      ${detail("Edad", Math.floor(c.age))}
      ${detail("Energia", Math.floor(c.energy))}
      ${detail("Salud", `${Math.floor(c.health)}/${Math.floor(c.maxHealth)}`)}
      ${detail("Poblacion", sp.population)}
    </div>
    <p class="hint"><b>Dieta:</b> ${sp.diet}</p>
    <p class="hint"><b>Habitat:</b> ${sp.habitat}</p>
    <div class="trait-list">${traitKeys.map((k) => traitBar(k, sp.traits[k])).join("")}</div>
  `;
}

function detail(label, value) {
  return `<div class="detail"><span>${label}</span><b>${value}</b></div>`;
}

function traitBar(key, value) {
  const max = key === "fertility" ? 30 : 10;
  return `<div class="trait-bar"><span>${traitLabels[key]}</span><div class="bar"><i style="width:${(value / max) * 100}%"></i></div><b>${Math.round(value)}</b></div>`;
}

function traitMax(key, speciesClass = "herbivore") {
  if (key !== "fertility") return 10;
  return speciesClass === "producer" ? 30 : 20;
}

function traitMin(key, speciesClass = "herbivore") {
  if (key === "speed" && speciesClass === "carnivore") return 6;
  if (key !== "fertility") return 0;
  return speciesClass === "producer" ? 10 : 5;
}

function className(type) {
  return type === "producer" ? "Productor" : type === "herbivore" ? "Herbivoro" : "Carnivoro";
}

function buildEnvControls() {
  const box = document.getElementById("envControls");
  box.innerHTML = "";
  for (const [key, def] of Object.entries(envDefs)) {
    const row = document.createElement("div");
    row.className = "env-row";
    row.title = def[4];
    row.innerHTML = `<span title="${def[4]}">${def[0]}</span><input title="${def[4]}" type="range" min="${def[1]}" max="${def[2]}" value="${def[3]}" data-env="${key}"><output>${def[3]}</output>`;
    box.appendChild(row);
  }
  box.addEventListener("input", (event) => {
    const input = event.target.closest("input[data-env]");
    if (!input) return;
    const key = input.dataset.env;
    state.env[key] = Number(input.value);
    state.envTarget[key] = Number(input.value);
    input.nextElementSibling.textContent = Math.round(state.env[key]);
  });
}

function syncEnvControls() {
  for (const input of document.querySelectorAll("input[data-env]")) {
    const key = input.dataset.env;
    if (document.activeElement === input) continue;
    input.value = Math.round(state.env[key] ?? input.value);
    input.nextElementSibling.textContent = Math.round(state.env[key] ?? input.value);
  }
}
setInterval(syncEnvControls, 700);
setInterval(updateSelection, 1000);

canvas.addEventListener("mousedown", (event) => {
  dragging = true;
  lastMouse = { x: event.clientX, y: event.clientY };
});

window.addEventListener("mouseup", () => { dragging = false; });
window.addEventListener("mousemove", (event) => {
  updateMouseWorld(event);
  if (!dragging) return;
  const dx = event.clientX - lastMouse.x;
  const dy = event.clientY - lastMouse.y;
  state.camera.x -= dx / state.camera.zoom;
  state.camera.y -= dy / state.camera.zoom;
  lastMouse = { x: event.clientX, y: event.clientY };
});

function updateMouseWorld(event) {
  state.mouse.x = event.clientX;
  state.mouse.y = event.clientY;
  const p = screenToWorld(event.clientX, event.clientY);
  state.mouse.worldX = p.x;
  state.mouse.worldY = p.y;
}

canvas.addEventListener("click", (event) => {
  if (!state.started) return;
  const p = screenToWorld(event.clientX, event.clientY);
  if (state.activeTool) {
    applyTool(p.x, p.y);
    return;
  }
  let best = null;
  let bestD = 99999;
  for (const c of state.creatures) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestD && d < c.size + 18 / state.camera.zoom) { best = c; bestD = d; }
  }
  if (best) {
    state.selected = best;
    updateSelection();
  }
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  updateMouseWorld(event);
  if (state.activeTool) {
    const direction = event.deltaY > 0 ? -1 : 1;
    state.toolRadius = clamp(state.toolRadius + direction * 25, 40, 650);
    document.getElementById("toolHint").textContent = `Radio: ${Math.round(state.toolRadius)}. Rueda para ajustar, click para aplicar.`;
    return;
  }
  const before = screenToWorld(event.clientX, event.clientY);
  state.camera.zoom = clamp(state.camera.zoom * (event.deltaY > 0 ? 0.88 : 1.14), 0.16, 2.2);
  const after = screenToWorld(event.clientX, event.clientY);
  state.camera.x += before.x - after.x;
  state.camera.y += before.y - after.y;
}, { passive: false });

window.addEventListener("keydown", (event) => keys.add(event.key.toLowerCase()));
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

function applyTool(x, y) {
  const tool = state.activeTool;
  const radius = state.toolRadius;
  if (tool === "nutrientBloom") {
    const count = Math.max(6, Math.round(radius / 10));
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const d = Math.sqrt(Math.random()) * radius;
      spawnResource(x + Math.cos(angle) * d, y + Math.sin(angle) * d, rand(45, 120));
    }
    state.lastEvent = "Floracion de nutrientes creada";
  }
  if (tool === "protect") {
    for (const c of state.creatures) if (Math.hypot(c.x - x, c.y - y) < radius) c.protected = 80;
    state.zones.push({ type: "protect", x, y, radius, ttl: 80 });
    state.lastEvent = "Zona protegida temporalmente";
  }
  if (tool === "disaster") {
    for (const c of state.creatures) if (Math.hypot(c.x - x, c.y - y) < radius) c.health -= rand(20, 70);
    state.zones.push({ type: "disaster", x, y, radius, ttl: 30 });
    state.lastEvent = "Catastrofe localizada";
  }
  if (tool === "favor") {
    const c = state.selected;
    if (c) {
      const sp = getSpecies(c);
      const count = Math.max(3, Math.round(radius / 22));
      for (let i = 0; i < count; i++) {
        const angle = rand(0, Math.PI * 2);
        const d = Math.sqrt(Math.random()) * radius;
        spawnCreature(sp, x + Math.cos(angle) * d, y + Math.sin(angle) * d, c.generation);
      }
      state.lastEvent = `Reproduccion favorecida: ${sp.name}`;
    }
  }
  state.activeTool = null;
  document.getElementById("toolHint").textContent = "Herramienta aplicada.";
}

document.getElementById("startAI").addEventListener("click", () => startWorld(true, true));
document.getElementById("startAIText").addEventListener("click", () => startWorld(true, false));
document.getElementById("startDemo").addEventListener("click", () => startWorld(false));
document.getElementById("pauseBtn").addEventListener("click", () => {
  state.paused = !state.paused;
  document.getElementById("pauseBtn").textContent = state.paused ? "Seguir" : "Pausa";
});
document.getElementById("speedDown").addEventListener("click", () => state.speed = clamp(state.speed - 0.25, 0.25, 5));
document.getElementById("speedUp").addEventListener("click", () => state.speed = clamp(state.speed + 0.25, 0.25, 5));
document.querySelector(".tool-grid").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-tool]");
  if (!btn) return;
  state.activeTool = btn.dataset.tool;
  state.toolRadius = toolDefs[state.activeTool]?.radius || 210;
  document.getElementById("toolHint").textContent = `${toolDefs[state.activeTool]?.tip || "Intervencion seleccionada"} Rueda para ajustar radio, click en el mapa para aplicar.`;
});
document.getElementById("saveBtn").addEventListener("click", () => {
  localStorage.setItem("evo-save", JSON.stringify(state));
  state.lastEvent = "Partida guardada en este navegador";
});
document.getElementById("loadBtn").addEventListener("click", () => {
  const saved = localStorage.getItem("evo-save");
  if (!saved) return;
  Object.assign(state, JSON.parse(saved));
  document.getElementById("setup").classList.add("hidden");
  updateSelection();
});
document.getElementById("resetBtn").addEventListener("click", restartCurrentWorld);
document.getElementById("newWorldBtn").addEventListener("click", () => location.reload());

function buildManualTraits() {
  const box = document.getElementById("manualTraits");
  box.innerHTML = "";
  const speciesClass = document.getElementById("manualClass")?.value || "herbivore";
  const defaults = { size: 5, speed: speciesClass === "carnivore" ? 8 : 6, attack: 5, defense: 4, perception: 6, fertility: speciesClass === "producer" ? 18 : 10, metabolism: 6, foodEfficiency: 5, toxicity: 1 };
  for (const key of traitKeys) {
    const label = document.createElement("label");
    label.textContent = traitLabels[key];
    const max = traitMax(key, speciesClass);
    const min = traitMin(key, speciesClass);
    label.innerHTML += `<input type="number" min="${min}" max="${max}" value="${defaults[key]}" data-trait="${key}">`;
    box.appendChild(label);
  }
}

async function createManual(withImages) {
  const traits = {};
  const type = document.getElementById("manualClass").value;
  for (const input of document.querySelectorAll("[data-trait]")) {
    traits[input.dataset.trait] = clamp(Number(input.value), traitMin(input.dataset.trait, type), traitMax(input.dataset.trait, type));
  }
  if (type !== "carnivore") traits.attack = 0;
  const name = document.getElementById("manualName").value.trim() || "Especie manual";
  const desc = document.getElementById("manualDesc").value.trim();
  const sp = normalizeSpecies({
    name,
    class: type,
    description: desc,
    visualDescription: desc,
    diet: type === "producer" ? "Luz y nutrientes" : type === "herbivore" ? "Productores" : "Herbivoros y carnivoros",
    habitat: "Zona elegida por el jugador",
    behavior: "Introducida manualmente por el jugador.",
    traits,
    portraitPrompt: `Detailed scientific illustration of an original aquatic species: ${desc}, clean white background, centered, no text`,
    spritePrompt: `Simple filled top-down game sprite of an aquatic species: ${desc}, filled colored body, not outline-only, head/front facing exactly to the right, tail/back to the left, solid chroma blue background (#0047ff), avoid blue creature colors, centered, no text`
  });
  const status = document.getElementById("manualStatus");
  try {
    if (withImages) {
      showBusy("Creando especie", "Generando imagenes IA...");
      status.textContent = "Generando imagenes IA...";
      await addImagesToSpecies(sp);
    }
    state.species.push(sp);
    const p = screenToWorld(innerWidth / 2, innerHeight / 2);
    for (let i = 0; i < 18; i++) spawnCreature(sp, p.x + rand(-160, 160), p.y + rand(-160, 160), 1);
    state.lastEvent = `Especie creada: ${sp.name}`;
    document.getElementById("modal").classList.add("hidden");
    status.textContent = "";
    hideBusy();
  } catch (error) {
    const message = `No se pudo crear la especie: ${error.message}`;
    status.textContent = message;
    showBusyError("No se pudo crear la especie", message);
    logError(message);
  }
}

document.getElementById("newSpeciesBtn").addEventListener("click", () => document.getElementById("modal").classList.remove("hidden"));
document.getElementById("closeModal").addEventListener("click", () => document.getElementById("modal").classList.add("hidden"));
document.getElementById("busyClose").addEventListener("click", hideBusy);
document.getElementById("manualClass").addEventListener("change", buildManualTraits);
document.getElementById("manualImages").addEventListener("click", () => createManual(true));
document.getElementById("manualNoImages").addEventListener("click", () => createManual(false));

buildEnvControls();
buildManualTraits();
initEnvironment();
loadConfigStatus();
requestAnimationFrame(loop);
