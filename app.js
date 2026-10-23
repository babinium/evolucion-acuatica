const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d", { alpha: false });

const traitKeys = [
  "size", "speed", "attack", "defense", "perception", "fertility",
  "metabolism", "foodEfficiency", "toxicity"
];

const MAX_INITIAL_SPECIES_PER_TYPE = 4;
const MAX_MANUAL_SPECIES_PER_WORLD = 4;
const INITIAL_HERBIVORES_PER_SPECIES = 24;
const INITIAL_CARNIVORES_PER_SPECIES = Math.max(1, Math.round(INITIAL_HERBIVORES_PER_SPECIES / 3));

const traitLabels = {
  size: "Tamaño",
  speed: "Velocidad",
  attack: "Ataque",
  defense: "Defensa",
  perception: "Percepción",
  fertility: "Fertilidad",
  metabolism: "Metabolismo",
  foodEfficiency: "Eficiencia",
  toxicity: "Toxicidad"
};

const envDefs = {
  temperature: ["Temperatura", 0, 100, 48, "Sube el metabolismo de animales y acelera la descomposicion de cadaveres; con alta temperatura gastan energia mas rapido."],
  light: ["Luz", 0, 100, 68, "Aumenta la energia que ganan los productores por fotosintesis y mejora el crecimiento de alga base."],
  oxygen: ["Oxígeno", 0, 100, 62, "Ayuda al crecimiento de alga base; si baja mucho, los individuos empiezan a perder salud."],
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
  manualSpeciesCreated: 0,
  lastEvent: "Esperando inicio",
  aiCalls: 0
};

const spriteCache = new Map();
const speciesById = new Map();
const creatureGrid = new SpatialGrid();
const resourceGrid = new SpatialGrid();
const corpseGrid = new SpatialGrid();
const classGrids = { producer: new SpatialGrid(), herbivore: new SpatialGrid(), carnivore: new SpatialGrid() };
const animalGrid = new SpatialGrid();
const proceduralSprites = new Map();
const quadrantCounts = new Map();
const MAX_RESOURCES = 2400;
const MAX_CREATURES = 2400;
const MAX_CORPSES = 1200;
const performancePresets = {
  eco: { label: "Bajo consumo", fps: 30, dpr: 1, scale: 0.85, grid: false },
  balanced: { label: "Equilibrado", fps: 45, dpr: 1.25, scale: 1, grid: true },
  quality: { label: "Más detalle", fps: 60, dpr: 1.5, scale: 1, grid: true }
};
let quality = "eco";
try { quality = localStorage.getItem("evo-quality") || "eco"; } catch {}
if (!performancePresets[quality]) quality = "eco";
let waterGradient = null;
let frameRequest = 0;
let lastFrameTs = 0;
let lastHudTs = -Infinity;
let lastPanelTs = -Infinity;
let simulationAccumulator = 0;
let renderDirty = true;
let frameCount = 0;
let fpsStarted = 0;
let measuredFps = 0;
let configState = { canUseAiText: false, canUseAiImages: false, hasTogetherApiKey: false };
let worldStarting = false;
let creatingSpecies = false;

function rebuildSpeciesIndex() {
  speciesById.clear();
  for (const sp of state.species) speciesById.set(sp.id, sp);
}

function quadrantKey(x, y, speciesId) {
  const cell = state.worldSize / 4;
  const qx = Math.floor(clamp(x, 0, state.worldSize - 1) / cell);
  const qy = Math.floor(clamp(y, 0, state.worldSize - 1) / cell);
  return `${speciesId}:${qx + qy * 4}`;
}

function rebuildSpatialIndexes() {
  creatureGrid.rebuild(state.creatures);
  resourceGrid.rebuild(state.resources);
  corpseGrid.rebuild(state.corpses);
  for (const grid of [...Object.values(classGrids), animalGrid]) {
    for (const bucket of grid.cells.values()) bucket.length = 0;
  }
  quadrantCounts.clear();
  for (const c of state.creatures) {
    const type = getSpecies(c)?.class;
    if (classGrids[type]) classGrids[type].insert(c);
    if (type && type !== "producer") animalGrid.insert(c);
    const key = quadrantKey(c.x, c.y, c.speciesId);
    quadrantCounts.set(key, (quadrantCounts.get(key) || 0) + 1);
  }
}

function invalidate() { renderDirty = true; }

function setQuality(value) {
  quality = performancePresets[value] ? value : "eco";
  try { localStorage.setItem("evo-quality", quality); } catch {}
  document.documentElement?.setAttribute("data-quality", quality);
  document.getElementById("qualitySelect").value = quality;
  document.getElementById("setupQuality").value = quality;
  resize();
  updateHud();
}

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
  try {
    // On static hosting the local generation server is intentionally unavailable.
    if (location.hostname.endsWith("github.io") || location.protocol === "file:") throw new Error("static");
    const response = await fetch("/api/config-status", { signal: AbortSignal.timeout(5000) });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || "Configuración no disponible");
    configState = status;
    statusEl.textContent = status.canUseAiImages
      ? "Gemini y Together configurados. Su disponibilidad se comprueba al generar."
      : status.canUseAiText
        ? "Gemini configurado. Podés crear especies con dibujos locales."
        : "Listo para jugar sin claves. La IA es opcional.";
  } catch {
    statusEl.textContent = "Listo para jugar sin conexión. La IA necesita el servidor local.";
  }
  document.getElementById("startAI").disabled = !configState.canUseAiImages;
  document.getElementById("startAIText").disabled = !configState.canUseAiText;
  document.getElementById("apiBadge").textContent = configState.canUseAiText ? "IA configurada" : "Modo local disponible";
  updateManualSpeciesCounter();
}

async function requestApi(path, body, timeout = 200000) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    throw new Error(error.name === "TimeoutError" || error.name === "AbortError"
      ? "La IA tardó demasiado. Podés iniciar un mundo local."
      : "No se pudo conectar con el servidor local.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `La API respondió HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function remember(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

let lastTs = 0;
let dragging = false;
let dragDistance = 0;
let lastMouse = { x: 0, y: 0 };
const keys = new Set();

function rand(min, max) { return min + Math.random() * (max - min); }
function irand(min, max) { return Math.floor(rand(min, max + 1)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clampIntegerInput(id, min, max) {
  const input = document.getElementById(id);
  const value = clamp(Math.round(Number(input.value) || min), min, max);
  input.value = value;
  return value;
}
function pick(items) { return items[Math.floor(Math.random() * items.length)]; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }

function resize() {
  const preset = performancePresets[quality];
  const dpr = Math.min(window.devicePixelRatio || 1, preset.dpr) * preset.scale;
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  waterGradient = ctx.createLinearGradient(0, 0, innerWidth, innerHeight);
  waterGradient.addColorStop(0, "#103d48");
  waterGradient.addColorStop(0.5, "#0b2936");
  waterGradient.addColorStop(1, "#061923");
  invalidate();
}
window.addEventListener("resize", resize);
resize();

function worldToScreen(x, y) {
  return { x: (x - state.camera.x) * state.camera.zoom + innerWidth / 2, y: (y - state.camera.y) * state.camera.zoom + innerHeight / 2 };
}

function screenToWorld(x, y) {
  return { x: (x - innerWidth / 2) / state.camera.zoom + state.camera.x, y: (y - innerHeight / 2) / state.camera.zoom + state.camera.y };
}

function normalizeSpecies(raw = {}) {
  raw = raw && typeof raw === "object" ? raw : {};
  const traits = {};
  const rawClass = ["producer", "herbivore", "carnivore"].includes(raw.class) ? raw.class : "herbivore";
  for (const key of traitKeys) {
    const max = traitMax(key, rawClass);
    const min = traitMin(key, rawClass);
    const fallback = key === "fertility" ? (rawClass === "producer" ? 18 : 10) : 5;
    const value = Number(raw.traits?.[key] ?? fallback);
    traits[key] = clamp(Number.isFinite(value) ? value : fallback, min, max);
  }
  if (rawClass === "producer") {
    traits.attack = 0;
    traits.speed = Math.min(traits.speed, 2);
  }
  if (rawClass === "herbivore") traits.attack = 0;
  return {
    id: raw.id || uid("sp"),
    parentId: raw.parentId || null,
    name: String(raw.name || "Especie sin nombre").slice(0, 70),
    class: rawClass,
    description: String(raw.description || "Especie acuática generada localmente.").slice(0, 2000),
    visualDescription: String(raw.visualDescription || "Silueta acuática simple.").slice(0, 2000),
    diet: String(raw.diet || "Recursos del ecosistema").slice(0, 2000),
    habitat: String(raw.habitat || "Aguas medias").slice(0, 2000),
    behavior: String(raw.behavior || "Explora, come y se reproduce.").slice(0, 2000),
    strengths: raw.strengths || [],
    weaknesses: raw.weaknesses || [],
    traits,
    portraitPrompt: raw.portraitPrompt || `Detailed scientific illustration of ${raw.visualDescription || raw.name}, aquatic creature, white background, centered, no text.`,
    spritePrompt: raw.spritePrompt || `Simple filled top-down game sprite of ${raw.visualDescription || raw.name}, solid chroma blue background, centered, no text, filled colored body, not line art.`,
    portraitUrl: raw.portraitUrl || "",
    spriteUrl: raw.spriteUrl || "",
    color: raw.color || colorFor(rawClass, traits),
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
        description: "Especie local adaptada a las condiciones iniciales del ecosistema.",
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
  rebuildSpeciesIndex();
  spriteCache.clear();
  proceduralSprites.clear();
  state.creatures = [];
  state.resources = [];
  state.corpses = [];
  state.zones = [];
  state.day = 0;
  state.paused = false;
  state.activeTool = null;
  simulationAccumulator = 0;
  state.extinct = 0;
  state.lastEvent = "Tu ecosistema está vivo. Seleccioná una especie para conocerla.";
  selectionKey = null;
  speciesListSignature = "";
  state.selected = null;
  state.nextCreatureId = 1;
  state.nextSpeciesId = state.species.length + 1;
  state.manualSpeciesCreated = 0;
  initEnvironment();

  for (let i = 0; i < 90; i++) spawnResource(rand(0, state.worldSize), rand(0, state.worldSize), rand(35, 120));
  for (const sp of state.species) {
    const count = sp.class === "producer"
      ? 42
      : sp.class === "herbivore"
        ? INITIAL_HERBIVORES_PER_SPECIES
        : INITIAL_CARNIVORES_PER_SPECIES;
    for (let i = 0; i < count; i++) spawnCreature(sp, rand(120, state.worldSize - 120), rand(120, state.worldSize - 120), 0);
  }
  rebuildSpatialIndexes();
  recalcSpecies();
  state.started = true;
  document.getElementById("setup").classList.add("hidden");
  document.getElementById("app").classList.add("playing");
  syncPauseButton();
  syncEnvControls();
  updateHud();
  updateSpeciesList();
  invalidate();
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
  if (state.resources.length >= MAX_RESOURCES) return;
  x = clamp(x, 0, state.worldSize);
  y = clamp(y, 0, state.worldSize);
  state.resources.push({ id: uid("alga"), name: "Alga base", x, y, amount, max: amount, radius: Math.sqrt(amount) * 2.3 });
}

function spawnCreature(species, x, y, generation) {
  if (state.creatures.length >= MAX_CREATURES) return;
  x = clamp(x, 8, state.worldSize - 8);
  y = clamp(y, 8, state.worldSize - 8);
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
  if (worldStarting) return;
  setQuality(document.getElementById("setupQuality").value);
  const producers = clampIntegerInput("setupProducers", 1, MAX_INITIAL_SPECIES_PER_TYPE);
  const herbivores = clampIntegerInput("setupHerbivores", 1, MAX_INITIAL_SPECIES_PER_TYPE);
  const carnivores = clampIntegerInput("setupCarnivores", 0, MAX_INITIAL_SPECIES_PER_TYPE);
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

  worldStarting = true;
  try {
    showBusy("Creando mundo", "Generando especies con Gemini...");
    setupStatus.textContent = "Generando especies con Gemini...";
    state.aiCalls++;
    const data = await requestApi("/api/generate-species", {
      producers, herbivores, carnivores, world: { chaos: state.chaos, mutationRate: state.mutationRate }
    });
    if (!Array.isArray(data.species) || !data.species.length) throw new Error("La IA no devolvió especies válidas.");
    const species = data.species.slice(0, 12).map(normalizeSpecies);
    let missingImages = 0;

    if (withImages) {
      for (let i = 0; i < species.length; i++) {
        const message = `Generando imagenes IA ${i + 1}/${species.length}...`;
        setupStatus.textContent = message;
        updateBusy(message);
        try { await addImagesToSpeciesWithRetry(species[i], setupStatus); }
        catch (error) {
          missingImages++;
          logError(`Imágenes de ${species[i].name}: ${error.message}. Se usará un dibujo local.`);
          // Permanent errors affect every following species; avoid more paid requests.
          if (![429, 500, 502, 503, 504].includes(error.status)) { missingImages += species.length - i - 1; break; }
        }
      }
    }
    hideBusy();
    seedWorld(species);
    if (missingImages) state.lastEvent = "Mundo listo. Algunas especies usan dibujos locales porque falló la IA de imágenes.";
  } catch (error) {
    const message = `Fallo IA: ${error.message}. Vuelve a intentar crear el mundo.`;
    setupStatus.textContent = message;
    showBusyError("No se pudo crear el mundo", message);
    logError(message);
  } finally { worldStarting = false; }
}

async function addImagesToSpecies(species) {
  state.aiCalls++;
  const data = await requestApi("/api/generate-images", {
    prompts: [
      { mode: "portrait", prompt: `${species.portraitPrompt}. Clean white background, isolated subject, no text, no watermark.` },
      { mode: "sprite", prompt: `${species.spritePrompt}. Filled 2D game sprite, head facing right, tail left, solid chroma blue background (#0047ff), avoid blue creature colors, no text.` }
    ]
  }, 400000);
  species.portraitUrl = data.images?.[0] || "";
  species.spriteUrl = data.images?.[1] || "";
  if (!species.portraitUrl || !species.spriteUrl) throw new Error("La API no devolvio ambas imagenes.");
}

async function addImagesToSpeciesWithRetry(species, statusEl) {
  statusEl.textContent = `Creando imágenes de ${species.name}…`;
  // The server owns retries so a failed portrait never regenerates the paid pair.
  await addImagesToSpecies(species);
}

function getSpecies(creature) {
  return speciesById.get(creature.speciesId);
}

function update(dt) {
  if (!state.started) return;
  updateCamera(dt);
  if (state.paused) return;
  const simDt = dt * state.speed;
  state.day += simDt * 0.018;
  updateEnvironment(simDt);
  updateResources(simDt);
  updateCorpses(simDt);
  updateZones(simDt);
  rebuildSpatialIndexes();
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
  if (keys.size) invalidate();
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
  const livingClassCounts = countLivingClasses();
  const maxCorpseRadius = state.corpses.reduce((max, corpse) => Math.max(max, corpse.radius), 0);
  corpseGrid.maxRadius = maxCorpseRadius;
  for (const c of state.creatures) {
    const sp = getSpecies(c);
    if (!sp) continue;
    const oldX = c.x, oldY = c.y, oldSpeciesId = c.speciesId;
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
    else animalThink(c, sp, dt, livingClassCounts);

    c.x = clamp(c.x + c.vx * dt * 58, 8, state.worldSize - 8);
    c.y = clamp(c.y + c.vy * dt * 58, 8, state.worldSize - 8);

    const energyRatio = clamp(c.energy / 120, 0, 1);
    const canReproduce = state.creatures.length + newborns.length < MAX_CREATURES
      && c.health > 0 && c.energy > 35
      && c.cooldown <= 0
      && !isCrowdedForReproduction(c, sp);
    const populationBalance = reproductionPopulationBalance(sp, livingClassCounts);
    const reproductionChance = dt * (0.009 + t.fertility * 0.0028) * energyRatio * populationBalance;
    if (canReproduce && Math.random() < reproductionChance) {
      c.energy *= 0.56;
      c.cooldown = Math.max(28, 96 - t.fertility * 3.2);
      newborns.push({ parent: c, species: maybeMutateSpecies(sp, c) });
    }

    if (c.energy < 0) c.health += c.energy * dt * 0.9;
    if (state.env.oxygen < 18) c.health -= dt * (18 - state.env.oxygen) * 0.18;
    if (state.env.toxicity > 62) c.health -= dt * (state.env.toxicity - 62) * 0.08;
    if (c.age > 260 + t.size * 18) c.health -= dt * 3;
    creatureGrid.move(c, oldX, oldY);
    classGrids[sp.class]?.move(c, oldX, oldY);
    if (sp.class !== "producer") animalGrid.move(c, oldX, oldY);
    const oldKey = quadrantKey(oldX, oldY, oldSpeciesId);
    const newKey = quadrantKey(c.x, c.y, c.speciesId);
    if (oldKey !== newKey) {
      quadrantCounts.set(oldKey, (quadrantCounts.get(oldKey) || 1) - 1);
      quadrantCounts.set(newKey, (quadrantCounts.get(newKey) || 0) + 1);
    }
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
    if (sp && sp.class !== "producer" && state.corpses.length < MAX_CORPSES) {
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
  for (const other of creatureGrid.query(creature.x, creature.y, radius)) {
    if (other.id === creature.id || other.speciesId !== creature.speciesId) continue;
    if (Math.hypot(creature.x - other.x, creature.y - other.y) < radius) {
      nearby++;
      if (nearby >= limit) return true;
    }
  }
  return false;
}

function sameSpeciesInQuadrant(creature) {
  return quadrantCounts.get(quadrantKey(creature.x, creature.y, creature.speciesId)) || 0;
}

function countLivingClasses() {
  const counts = { producer: 0, herbivore: 0, carnivore: 0 };
  for (const creature of state.creatures) {
    const sp = getSpecies(creature);
    if (!sp) continue;
    if (sp.class === "producer") counts.producer++;
    if (sp.class === "herbivore") counts.herbivore++;
    if (sp.class === "carnivore") counts.carnivore++;
  }
  return counts;
}

function reproductionPopulationBalance(species, classCounts) {
  if (species.class === "carnivore") return carnivoreReproductionBalance(classCounts);
  return 1;
}

function carnivoreReproductionBalance(classCounts) {
  const herbivores = classCounts.herbivore;
  const carnivores = classCounts.carnivore;
  if (herbivores <= 0) return 0;
  return clamp(1 - carnivores / (herbivores / 3), 0, 1);
}

function producerThink(c, sp, dt) {
  c.state = "fotosintesis";
  c.vx *= 0.88;
  c.vy *= 0.88;
  c.energy += dt * (state.env.light * 0.035 + state.env.nutrients * 0.025) * (sp.traits.foodEfficiency / 7);
  c.energy = clamp(c.energy, 0, 120);
}

function animalThink(c, sp, dt, livingClassCounts) {
  const t = sp.traits;
  let nearestThreat = null;
  let threatD = 99999;
  if (sp.class === "herbivore") {
    for (const other of classGrids.carnivore.query(c.x, c.y, 130 + t.perception * 18)) {
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

  if (sp.class === "herbivore") eatProducer(c, sp, dt, livingClassCounts);
  if (sp.class === "carnivore") hunt(c, sp, dt);

  if (sp.class !== "carnivore" || c.state !== "persiguiendo") {
    c.vx *= 0.992;
    c.vy *= 0.992;
  }
  if (Math.random() < dt * 0.55) {
    c.vx += rand(-1, 1) * (0.35 + t.speed * 0.055);
    c.vy += rand(-1, 1) * (0.35 + t.speed * 0.055);
  }
  const max = moveSpeedLimit(sp, c.state);
  const len = Math.hypot(c.vx, c.vy) || 1;
  if (len > max) { c.vx = (c.vx / len) * max; c.vy = (c.vy / len) * max; }
}

function eatProducer(c, sp, dt, classCounts) {
  let best = null;
  let bestD = 99999;
  let bestType = null;
  const searchRadius = foodVisionRadius(c, sp, 520, 135);
  const preferAlgae = classCounts.herbivore > classCounts.producer;
  const producerBias = preferAlgae ? 220 : -120;
  const algaeBias = preferAlgae ? -150 : 160;
  for (const other of classGrids.producer.query(c.x, c.y, searchRadius)) {
    if (other.health <= 0 || other.energy <= -35) continue;
    const otherSp = getSpecies(other);
    if (!otherSp || otherSp.class !== "producer") continue;
    const d = Math.hypot(c.x - other.x, c.y - other.y);
    const foodValue = other.energy + other.health * 0.35;
    const score = d - foodValue * 0.08 + otherSp.traits.defense * 8 + otherSp.traits.toxicity * 12 + producerBias;
    if (d < searchRadius && score < bestD) {
      best = other;
      bestD = score;
      bestType = "producer";
    }
  }
  for (const alga of resourceGrid.query(c.x, c.y, searchRadius)) {
    if (alga.amount <= 0) continue;
    const d = Math.hypot(c.x - alga.x, c.y - alga.y);
    const score = d - alga.amount * 0.18 + algaeBias;
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

  const hunger = clamp((92 - c.energy) / 92, 0, 1);
  if (eatNearbyCorpse(c, sp, dt)) return;

  let prey = null;
  let backupPrey = null;
  let bestScore = -99999;
  let bestBackupScore = -99999;
  const huntRadius = foodVisionRadius(c, sp, 360 + hunger * 340, 58 + hunger * 28);
  for (const other of animalGrid.query(c.x, c.y, huntRadius)) {
    if (other.health <= 0 || other.energy <= -35) continue;
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
      - d * (0.1 + hunger * 0.08)
      - osp.traits.defense * 4.2
      - osp.traits.toxicity * 6
      - sizeRisk;
    if (osp.class === "herbivore") {
      if (score > bestScore) { bestScore = score; prey = other; }
    } else if (score > bestBackupScore) {
      bestBackupScore = score;
      backupPrey = other;
    }
  }
  prey = prey || backupPrey;
  if (!prey && eatCorpse(c, sp, dt, hunger)) return;
  if (!prey) {
    patrolForFood(c, sp, dt, hunger);
    return;
  }
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
    const preySp = getSpecies(prey);
    const speedAdvantage = Math.max(0, sp.traits.speed - (preySp?.traits.speed || 0));
    steerToward(c, prey, sp.traits.speed + 3 + hunger * 2.4 + speedAdvantage * 1.2);
  }
}

function eatNearbyCorpse(c, sp, dt) {
  let best = null;
  let bestD = 99999;
  for (const corpse of corpseGrid.query(c.x, c.y, c.size + (corpseGrid.maxRadius || 180) + 18)) {
    if (corpse.amount <= 0) continue;
    const d = Math.hypot(c.x - corpse.x, c.y - corpse.y);
    if (d < bestD && d < c.size + corpse.radius + 18) {
      best = corpse;
      bestD = d;
    }
  }
  if (!best) return false;
  eatCorpseBite(c, sp, best, dt);
  return true;
}

function eatCorpse(c, sp, dt, hunger = 0) {
  let best = null;
  let bestScore = 99999;
  const corpseRadius = foodVisionRadius(c, sp, 520 + hunger * 520, 72 + hunger * 38);
  for (const corpse of corpseGrid.query(c.x, c.y, corpseRadius)) {
    if (corpse.amount <= 0) continue;
    const d = Math.hypot(c.x - corpse.x, c.y - corpse.y);
    const score = d - corpse.amount * (0.45 + hunger * 0.35);
    if (score < bestScore && d < corpseRadius) {
      best = corpse;
      bestScore = score;
    }
  }
  if (!best) return false;
  const bestD = Math.hypot(c.x - best.x, c.y - best.y);
  if (bestD < c.size + best.radius + 8) {
    eatCorpseBite(c, sp, best, dt);
  } else {
    steerToward(c, best, sp.traits.speed + 2 + hunger * 2.5);
    c.state = "buscando carrona";
  }
  return true;
}

function eatCorpseBite(c, sp, corpse, dt) {
  const bite = Math.min(corpse.amount, dt * (8 + sp.traits.foodEfficiency * 1.55));
  corpse.amount -= bite;
  c.energy = clamp(c.energy + bite * 1.05, 0, 130);
  c.health = clamp(c.health + dt * 0.65, 0, c.maxHealth);
  c.state = "carroneando";
  c.vx *= 0.7;
  c.vy *= 0.7;
}

function patrolForFood(c, sp, dt, hunger) {
  c.state = hunger > 0.55 ? "rastreando comida" : "patrullando";
  c.wanderTime -= dt * (1 + hunger);
  const needsNewTarget = c.wanderTime <= 0
    || c.wanderX === null
    || Math.hypot(c.x - c.wanderX, c.y - c.wanderY) < 90;
  if (needsNewTarget) {
    const target = nearestFoodScent(c, sp);
    if (target) {
      c.wanderX = target.x;
      c.wanderY = target.y;
      c.wanderTime = rand(2.5, 5.5);
    } else {
      const angle = rand(0, Math.PI * 2);
      const distance = rand(620, 1300) + sp.traits.perception * 55 + hunger * 520;
      c.wanderX = clamp(c.x + Math.cos(angle) * distance, 40, state.worldSize - 40);
      c.wanderY = clamp(c.y + Math.sin(angle) * distance, 40, state.worldSize - 40);
      c.wanderTime = rand(3.5, 7.0);
    }
  }
  steerToward(c, { x: c.wanderX, y: c.wanderY }, sp.traits.speed + 1.8 + hunger * 2.2);
}

function nearestFoodScent(c, sp) {
  let best = null;
  let bestScore = 99999;
  const scentRadius = 900 + sp.traits.perception * 95;
  for (const corpse of corpseGrid.query(c.x, c.y, scentRadius)) {
    const d = Math.hypot(c.x - corpse.x, c.y - corpse.y);
    const score = d - corpse.amount * 0.7;
    if (d < scentRadius && score < bestScore) {
      best = corpse;
      bestScore = score;
    }
  }
  for (const other of animalGrid.query(c.x, c.y, scentRadius)) {
    if (other.id === c.id || other.speciesId === c.speciesId) continue;
    const osp = getSpecies(other);
    if (!osp || osp.class === "producer") continue;
    const d = dist(c, other);
    const score = d - (osp.class === "herbivore" ? 160 : 40) - Math.max(0, 90 - other.energy);
    if (d < scentRadius && score < bestScore) {
      best = other;
      bestScore = score;
    }
  }
  return best;
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
  c.vx += (dx / len) * (0.07 + speed * 0.032);
  c.vy += (dy / len) * (0.07 + speed * 0.032);
}

function steerAway(c, target, speed) {
  const dx = c.x - target.x;
  const dy = c.y - target.y;
  const len = Math.hypot(dx, dy) || 1;
  c.vx += (dx / len) * (0.11 + speed * 0.022);
  c.vy += (dy / len) * (0.11 + speed * 0.022);
}

function moveSpeedLimit(species, actionState) {
  const t = species.traits;
  const classBonus = species.class === "carnivore" ? 0.18 : species.class === "herbivore" ? 0.02 : -0.08;
  const chaseBonus = species.class === "carnivore" && actionState === "persiguiendo" ? 0.34 : 0;
  return 0.24 + t.speed * 0.245 + classBonus + chaseBonus + state.env.currents * 0.002;
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
  speciesById.set(child.id, child);
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
  drawWater();
  if (state.started) {
    drawResources();
    drawCorpses();
    drawZones();
    drawCreatures();
    drawToolPreview();
    drawWorldBounds();
  }
  renderDirty = false;
}

function drawWater() {
  ctx.fillStyle = waterGradient;
  ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (!state.started || !performancePresets[quality].grid) return;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#9edbd3";
  ctx.lineWidth = 1;
  const step = Math.max(54, 240 * state.camera.zoom);
  const ox = ((-state.camera.x * state.camera.zoom + innerWidth / 2) % step + step) % step;
  const oy = ((-state.camera.y * state.camera.zoom + innerHeight / 2) % step + step) % step;
  ctx.beginPath();
  for (let x = ox; x < innerWidth; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, innerHeight); }
  for (let y = oy; y < innerHeight; y += step) { ctx.moveTo(0, y); ctx.lineTo(innerWidth, y); }
  ctx.stroke();
  ctx.restore();
}

function inView(x, y, pad = 80) {
  const sx = (x - state.camera.x) * state.camera.zoom + innerWidth / 2;
  const sy = (y - state.camera.y) * state.camera.zoom + innerHeight / 2;
  return sx > -pad && sx < innerWidth + pad && sy > -pad && sy < innerHeight + pad;
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
    } else {
      const shape = getProceduralSprite(sp);
      const w = r * (sp.class === "producer" ? 3.2 : 4.8);
      const h = r * (sp.class === "producer" ? 3.2 : 2.8);
      ctx.drawImage(shape, -w / 2, -h / 2, w, h);
    }
    if (c.protected > 0) {
      ctx.strokeStyle = "#95cde2";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, r * 2.1, 0, Math.PI * 2); ctx.stroke();
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

function getProceduralSprite(sp) {
  const cached = proceduralSprites.get(sp.id);
  if (cached) return cached;
  const sprite = document.createElement("canvas");
  sprite.width = 96; sprite.height = 96;
  const c = sprite.getContext("2d");
  c.translate(48, 48);
  c.fillStyle = sp.color;
  if (sp.class === "producer") {
    for (let i = 0; i < 6; i++) {
      c.save(); c.rotate(i * Math.PI / 3);
      c.globalAlpha = 0.65;
      c.beginPath(); c.ellipse(0, -17, 9, 21, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#c5eed199"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, -3); c.lineTo(0, -31); c.stroke(); c.restore();
    }
    c.fillStyle = "#d1df9e";
    c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fill();
  } else {
    // Fins and tail are drawn once per species, then reused for every animal.
    c.globalAlpha = 0.72;
    c.beginPath(); c.moveTo(-21, 0); c.lineTo(-43, -21); c.quadraticCurveTo(-36, 0, -43, 21); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-8, -10); c.lineTo(6, -31); c.lineTo(17, -11); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(-7, 11); c.lineTo(8, 27); c.lineTo(16, 10); c.closePath(); c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.moveTo(36, 0); c.bezierCurveTo(17, -28, -14, -22, -28, 0);
    c.bezierCurveTo(-12, 21, 17, 24, 36, 0); c.fill();
    c.strokeStyle = "#e5f5e470"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-20, -1); c.quadraticCurveTo(7, -16, 29, -2); c.stroke();
    c.strokeStyle = "#112c3b77";
    c.beginPath(); c.moveTo(18, -12); c.quadraticCurveTo(9, 0, 18, 12); c.stroke();
    c.fillStyle = "#eaf0dc"; c.beginPath(); c.arc(24, -4, 4.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#132735"; c.beginPath(); c.arc(25, -4, 2.3, 0, Math.PI * 2); c.fill();
    if (sp.class === "carnivore") {
      c.fillStyle = "#fff1cd"; c.beginPath(); c.moveTo(34, 1); c.lineTo(26, 4); c.lineTo(27, 0); c.fill();
    }
  }
  proceduralSprites.set(sp.id, sprite);
  return sprite;
}

function getSprite(species) {
  if (!species.spriteUrl) return null;
  if (spriteCache.has(species.id)) return spriteCache.get(species.id);
  const entry = { ready: false, canvas: null };
  spriteCache.set(species.id, entry);
  const img = new Image();
  img.onload = () => {
    try {
      entry.canvas = removeSpriteBackground(img);
      entry.ready = true;
    } catch { entry.ready = false; }
    invalidate();
  };
  img.crossOrigin = "anonymous";
  img.onerror = () => { entry.ready = false; };
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

const hudElements = new Map();
function setText(id, value) {
  let el = hudElements.get(id);
  if (!el) { el = document.getElementById(id); hudElements.set(id, el); }
  const text = String(value);
  if (el.textContent !== text) el.textContent = text;
}

function updateHud() {
  setText("dayStat", Math.floor(state.day));
  setText("popStat", state.creatures.length);
  setText("speciesStat", state.species.filter(s => !s.extinct).length);
  setText("extinctStat", state.extinct);
  setText("eventStat", state.lastEvent);
  setText("speedLabel", `${state.speed.toFixed(1)}x`);
  setText("zoomLabel", `${Math.round(state.camera.zoom * 100)}%`);
  setText("mapSizeLabel", `${state.worldSize.toLocaleString("es-AR")} × ${state.worldSize.toLocaleString("es-AR")}`);
  setText("performanceStat", `${performancePresets[quality].label} · ${state.paused ? "En pausa" : `${measuredFps || performancePresets[quality].fps} FPS`} · ${performancePresets[quality].fps} máx.`);
}

function loop(ts) {
  frameRequest = 0;
  if (document.hidden) return;
  const interval = 1000 / performancePresets[quality].fps;
  if (lastFrameTs && ts - lastFrameTs < interval - 0.5) {
    frameRequest = requestAnimationFrame(loop);
    return;
  }
  const dt = lastTs ? Math.min(0.2, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  lastFrameTs = ts;
  const running = state.started && !state.paused && !worldStarting && !creatingSpecies;
  if (running) {
    simulationAccumulator += dt;
    // Fixed 30 Hz simulation keeps the ecology independent of visual quality.
    // Bound catch-up work so a slow machine can still respond to input.
    let steps = 0;
    while (simulationAccumulator >= 1 / 30 && steps < 3) {
      update(1 / 30);
      simulationAccumulator -= 1 / 30;
      steps++;
    }
    if (steps === 3) simulationAccumulator = 0;
  } else {
    simulationAccumulator = 0;
    if (state.started && keys.size) { updateCamera(dt); invalidate(); }
  }
  if (running || renderDirty) {
    render();
    frameCount++;
  }
  if (ts - fpsStarted >= 1000) {
    measuredFps = Math.round(frameCount * 1000 / Math.max(1, ts - fpsStarted));
    frameCount = 0;
    fpsStarted = ts;
  }
  if (ts - lastHudTs >= 250) { updateHud(); lastHudTs = ts; }
  if (ts - lastPanelTs >= 700) {
    if (state.started) { syncEnvControls(); updateSelection(); updateSpeciesList(); }
    lastPanelTs = ts;
  }
  frameRequest = requestAnimationFrame(loop);
}

// Never simulate elapsed time from an inactive tab.
document.addEventListener("visibilitychange", () => {
  keys.clear();
  if (document.hidden) { cancelAnimationFrame(frameRequest); frameRequest = 0; }
  else {
    lastTs = 0; lastFrameTs = 0; simulationAccumulator = 0; invalidate();
    if (!frameRequest) frameRequest = requestAnimationFrame(loop);
  }
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function safeImageUrl(value) {
  return /^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(value || "") ? escapeHtml(value) : "";
}

let selectionKey = null;
function updateSelection() {
  const panel = document.getElementById("selectionPanel");
  const empty = document.getElementById("selectionEmpty");
  const c = state.selected;
  if (!c || !state.creatures.includes(c)) {
    state.selected = null;
    selectionKey = null;
    panel.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  const sp = getSpecies(c);
  if (!sp) return;
  empty.classList.add("hidden");
  panel.classList.remove("hidden");
  const key = `${c.id}:${sp.id}`;
  if (selectionKey !== key) {
    const imageUrl = safeImageUrl(sp.portraitUrl);
    const image = imageUrl ? `<img class="portrait" src="${imageUrl}" alt="Retrato de ${escapeHtml(sp.name)}" loading="lazy">` : "";
    panel.innerHTML = `
      ${image}
      <div class="selection-heading"><span class="selection-avatar" style="color:${escapeHtml(sp.color)}"><svg><use href="#${sp.class === "producer" ? "i-leaf" : "i-fish"}"/></svg></span><div><span class="species-chip">${className(sp.class)} · Individuo #${c.id}</span><h2>${escapeHtml(sp.name)}</h2></div></div>
      <p class="hint">${escapeHtml(sp.description)}</p>
      <div class="detail-grid">${["Estado", "Generación", "Edad", "Energía", "Salud", "Población"].map((label, i) => `<div class="detail"><span>${label}</span><b data-selection="${i}"></b></div>`).join("")}</div>
      <p class="hint"><b>Dieta:</b> ${escapeHtml(sp.diet)}</p>
      <p class="hint"><b>Hábitat:</b> ${escapeHtml(sp.habitat)}</p>
      <div class="trait-list">${traitKeys.map(k => traitBar(k, sp.traits[k])).join("")}</div>`;
    selectionKey = key;
  }
  const values = [c.state, c.generation, Math.floor(c.age), Math.floor(c.energy), `${Math.floor(c.health)} / ${Math.floor(c.maxHealth)}`, sp.population];
  panel.querySelectorAll("[data-selection]").forEach((el, i) => {
    const value = String(values[i]);
    if (el.textContent !== value) el.textContent = value;
  });
}

let speciesListSignature = "";
function updateSpeciesList() {
  const signature = state.species.map(sp => `${sp.id}:${sp.population}:${sp.extinct}`).join("|") + `:${state.selected?.speciesId || ""}`;
  if (signature === speciesListSignature) return;
  speciesListSignature = signature;
  setText("speciesCount", state.species.filter(sp => !sp.extinct).length);
  const counts = countLivingClasses();
  document.getElementById("trophicSummary").innerHTML = [["producer", "Productores"], ["herbivore", "Herbívoros"], ["carnivore", "Carnívoros"]].map(([type, label]) => `<span class="${type}"><b>${counts[type]}</b>${label}</span>`).join("");
  document.getElementById("speciesList").innerHTML = state.species.map((sp, i) => `<button class="species-row ${sp.extinct ? "extinct" : ""} ${state.selected?.speciesId === sp.id ? "active" : ""}" data-species-index="${i}" ${sp.population ? "" : "disabled"} title="Ver ${escapeHtml(sp.name)}"><span class="species-symbol" style="color:${escapeHtml(sp.color)}"><svg><use href="#${sp.class === "producer" ? "i-leaf" : "i-fish"}"/></svg></span><span><strong>${escapeHtml(sp.name)}</strong><small>${sp.extinct ? "Extinta" : className(sp.class)}</small></span><b>${sp.population}</b></button>`).join("");
}

function detail(label, value) {
  return `<div class="detail"><span>${label}</span><b>${value}</b></div>`;
}

function traitBar(key, value) {
  const max = key === "fertility" ? 30 : 10;
  return `<div class="trait-bar"><span>${traitLabels[key]}</span><div class="bar"><i style="width:${(value / max) * 100}%"></i></div><b>${Math.round(value)}</b></div>`;
}

function traitMax(key, speciesClass = "herbivore") {
  if (key === "speed" && speciesClass === "producer") return 2;
  if (key !== "fertility") return 10;
  return speciesClass === "producer" ? 30 : 20;
}

function traitMin(key, speciesClass = "herbivore") {
  if (key === "speed" && speciesClass === "carnivore") return 6;
  if (key !== "fertility") return 0;
  return speciesClass === "producer" ? 10 : 5;
}

function className(type) {
  return type === "producer" ? "Productor" : type === "herbivore" ? "Herbívoro" : "Carnívoro";
}

function buildEnvControls() {
  const box = document.getElementById("envControls");
  box.innerHTML = "";
  for (const [key, def] of Object.entries(envDefs)) {
    const row = document.createElement("div");
    row.className = "env-row";
    row.title = def[4];
    row.innerHTML = `<label for="env-${key}" title="${def[4]}">${def[0]}</label><input id="env-${key}" aria-label="${def[0]}" title="${def[4]}" type="range" min="${def[1]}" max="${def[2]}" value="${def[3]}" data-env="${key}"><output>${def[3]}</output>`;
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

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  dragging = true;
  dragDistance = 0;
  lastMouse = { x: event.clientX, y: event.clientY };
});

window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointercancel", () => { dragging = false; });
window.addEventListener("pointermove", (event) => {
  updateMouseWorld(event);
  if (!dragging) return;
  const dx = event.clientX - lastMouse.x;
  const dy = event.clientY - lastMouse.y;
  dragDistance += Math.abs(dx) + Math.abs(dy);
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
  if (dragging || state.activeTool) invalidate();
}

canvas.addEventListener("click", (event) => {
  if (dragDistance > 5) return;
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
    selectionKey = null;
    updateSelection(); updateSpeciesList(); invalidate();
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
  invalidate();
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    state.activeTool = null;
    const modal = document.getElementById("modal");
    if (!modal.classList.contains("hidden")) {
      modal.classList.add("hidden"); document.getElementById("newSpeciesBtn").focus();
    }
    document.getElementById("worldMenu").open = false;
    document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", "false"));
    invalidate(); return;
  }
  if (event.target?.closest("input, textarea, select") || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === " " && state.started && !event.target?.closest("button, summary")) { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
  keys.add(event.key.toLowerCase());
});
window.addEventListener("blur", () => { keys.clear(); dragging = false; });
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
    if (!c || !state.creatures.includes(c)) {
      state.lastEvent = "Elegí primero una especie o un individuo para favorecerlo.";
      updateHud(); return;
    }
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
  document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", "false"));
  invalidate();
  rebuildSpatialIndexes(); recalcSpecies(); updateSpeciesList(); updateSelection(); updateHud();
  document.getElementById("toolHint").textContent = "Intervención aplicada. Elegí otra para continuar.";
}

document.getElementById("startLocal").addEventListener("click", () => startWorld(false));
document.getElementById("startAI").addEventListener("click", () => startWorld(true, true));
document.getElementById("startAIText").addEventListener("click", () => startWorld(true, false));
function syncPauseButton() {
  document.getElementById("pauseBtn").textContent = state.paused ? "Reanudar" : "Pausar";
  document.getElementById("pauseBtn").setAttribute("aria-pressed", String(state.paused));
  document.getElementById("liveLabel").textContent = state.paused ? "EN PAUSA" : "EN VIVO";
}
function togglePause() { state.paused = !state.paused; syncPauseButton(); invalidate(); }
document.getElementById("pauseBtn").addEventListener("click", togglePause);
document.getElementById("speedDown").addEventListener("click", () => state.speed = clamp(state.speed - 0.25, 0.25, 5));
document.getElementById("speedUp").addEventListener("click", () => state.speed = clamp(state.speed + 0.25, 0.25, 5));
document.querySelector(".tool-grid").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-tool]");
  if (!btn) return;
  state.activeTool = state.activeTool === btn.dataset.tool ? null : btn.dataset.tool;
  document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === state.activeTool)));
  invalidate();
  state.toolRadius = toolDefs[state.activeTool]?.radius || 210;
  document.getElementById("toolHint").textContent = `${toolDefs[state.activeTool]?.tip || "Intervencion seleccionada"} Rueda para ajustar radio, click en el mapa para aplicar.`;
});
function saveWorld() {
  if (!state.started) return;
  const snapshot = { ...state, selected: null, selectedId: state.selected?.id || null, activeTool: null };
  state.lastEvent = remember("evo-save", JSON.stringify(snapshot))
    ? "Partida guardada en este navegador" : "No se pudo guardar: no queda espacio en el navegador.";
  updateHud();
}

function loadWorld() {
  try {
    const raw = localStorage.getItem("evo-save");
    if (!raw) {
      state.lastEvent = "Todavía no hay una partida guardada.";
      document.getElementById("setupStatus").textContent = state.lastEvent;
      updateHud(); return;
    }
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.species) || !Array.isArray(saved.creatures)
      || !Array.isArray(saved.resources) || !saved.camera || !Number.isFinite(saved.worldSize)) {
      throw new Error("La partida no tiene un formato válido.");
    }
    const ids = new Set(saved.species.map(sp => sp?.id));
    if (saved.worldSize <= 0 || !saved.env || !saved.envTarget
      || ![saved.camera.x, saved.camera.y, saved.camera.zoom].every(Number.isFinite)
      || saved.camera.zoom <= 0
      || !saved.species.every(sp => sp && sp.traits && ["producer", "herbivore", "carnivore"].includes(sp.class))
      || !saved.creatures.every(c => c && ids.has(c.speciesId)
        && [c.id, c.x, c.y, c.vx, c.vy, c.health, c.maxHealth, c.energy, c.age, c.size, c.cooldown].every(Number.isFinite))
      || !saved.resources.every(r => r && [r.x, r.y, r.amount, r.max, r.radius].every(Number.isFinite))) {
      throw new Error("La partida contiene datos incompletos o inválidos.");
    }
    const selectedId = saved.selectedId ?? saved.selected?.id;
    Object.assign(state, saved, { started: true, activeTool: null });
    state.creatures = state.creatures.slice(0, MAX_CREATURES);
    state.resources = state.resources.slice(0, MAX_RESOURCES);
    state.corpses = (state.corpses || []).slice(0, MAX_CORPSES);
    state.zones = state.zones || [];
    state.selected = state.creatures.find(c => c.id === selectedId) || null;
    state.nextCreatureId = Math.max(state.nextCreatureId || 1, ...state.creatures.map(c => c.id + 1));
    spriteCache.clear(); proceduralSprites.clear(); selectionKey = null; speciesListSignature = "";
    rebuildSpeciesIndex(); rebuildSpatialIndexes(); recalcSpecies();
    simulationAccumulator = 0;
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("app").classList.add("playing");
    state.lastEvent = "Partida cargada";
    syncPauseButton(); syncEnvControls(); updateSelection(); updateSpeciesList(); updateHud(); invalidate();
  } catch (error) {
    document.getElementById("setupStatus").textContent = `No se pudo cargar: ${error.message}`;
    state.lastEvent = "No se pudo cargar la partida guardada.";
    updateHud();
  }
}
document.getElementById("saveBtn").addEventListener("click", saveWorld);
document.getElementById("loadBtn").addEventListener("click", loadWorld);
document.getElementById("setupLoad").addEventListener("click", loadWorld);
document.getElementById("resetBtn").addEventListener("click", restartCurrentWorld);
document.getElementById("newWorldBtn").addEventListener("click", () => location.reload());

for (const input of [document.getElementById("setupProducers"), document.getElementById("setupHerbivores"), document.getElementById("setupCarnivores")]) {
  input.addEventListener("blur", () => {
    const min = Number(input.min);
    const max = Number(input.max);
    input.value = clamp(Math.round(Number(input.value) || min), min, max);
  });
}

function updateManualSpeciesCounter() {
  const count = clamp(state.manualSpeciesCreated || 0, 0, MAX_MANUAL_SPECIES_PER_WORLD);
  const counter = document.getElementById("manualSpeciesCounter");
  const imageButton = document.getElementById("manualImages");
  const noImageButton = document.getElementById("manualNoImages");
  counter.textContent = `${count}/${MAX_MANUAL_SPECIES_PER_WORLD}`;
  const atLimit = count >= MAX_MANUAL_SPECIES_PER_WORLD;
  imageButton.disabled = atLimit || !configState.hasTogetherApiKey || creatingSpecies;
  noImageButton.disabled = atLimit || creatingSpecies;
  counter.classList.toggle("limit", atLimit);
}

function buildManualTraits() {
  const box = document.getElementById("manualTraits");
  box.innerHTML = "";
  const speciesClass = document.getElementById("manualClass")?.value || "herbivore";
  const defaults = { size: 5, speed: speciesClass === "producer" ? 0 : speciesClass === "carnivore" ? 8 : 6, attack: speciesClass === "carnivore" ? 5 : 0, defense: 4, perception: 6, fertility: speciesClass === "producer" ? 18 : 10, metabolism: 6, foodEfficiency: 5, toxicity: 1 };
  for (const key of traitKeys) {
    const label = document.createElement("label");
    label.textContent = traitLabels[key];
    const max = traitMax(key, speciesClass);
    const min = traitMin(key, speciesClass);
    label.innerHTML += `<input type="number" min="${min}" max="${max}" value="${defaults[key]}" data-trait="${key}" ${key === "attack" && speciesClass !== "carnivore" ? "disabled" : ""}>`;
    box.appendChild(label);
  }
}

async function createManual(withImages) {
  if (creatingSpecies) return;
  if (state.creatures.length >= MAX_CREATURES) {
    document.getElementById("manualStatus").textContent = "El ecosistema alcanzó su límite de población. Esperá a que haya espacio.";
    return;
  }
  if ((state.manualSpeciesCreated || 0) >= MAX_MANUAL_SPECIES_PER_WORLD) {
    document.getElementById("manualStatus").textContent = `Limite alcanzado: ${MAX_MANUAL_SPECIES_PER_WORLD}/${MAX_MANUAL_SPECIES_PER_WORLD} especies creadas en este mundo.`;
    updateManualSpeciesCounter();
    return;
  }
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
  creatingSpecies = true;
  updateManualSpeciesCounter();
  try {
    if (withImages) {
      showBusy("Creando especie", "Generando imagenes IA...");
      status.textContent = "Generando imagenes IA...";
      await addImagesToSpeciesWithRetry(sp, status);
    }
    state.species.push(sp);
    speciesById.set(sp.id, sp);
    state.manualSpeciesCreated = (state.manualSpeciesCreated || 0) + 1;
    updateManualSpeciesCounter();
    const p = screenToWorld(innerWidth / 2, innerHeight / 2);
    for (let i = 0; i < 18; i++) spawnCreature(sp, p.x + rand(-160, 160), p.y + rand(-160, 160), 1);
    rebuildSpatialIndexes(); recalcSpecies(); updateSpeciesList(); invalidate();
    state.lastEvent = `Especie creada: ${sp.name}`;
    document.getElementById("modal").classList.add("hidden");
    status.textContent = "";
    hideBusy();
  } catch (error) {
    const message = `No se pudo crear la especie: ${error.message}`;
    status.textContent = message;
    showBusyError("No se pudo crear la especie", message);
    logError(message);
  } finally { creatingSpecies = false; updateManualSpeciesCounter(); }
}

document.getElementById("newSpeciesBtn").addEventListener("click", () => {
  updateManualSpeciesCounter();
  document.getElementById("modal").classList.remove("hidden");
  document.getElementById("manualName").focus();
});
document.getElementById("closeModal").addEventListener("click", () => document.getElementById("modal").classList.add("hidden"));
document.getElementById("busyClose").addEventListener("click", hideBusy);
document.getElementById("manualClass").addEventListener("change", buildManualTraits);
document.getElementById("manualImages").addEventListener("click", () => createManual(true));
document.getElementById("manualNoImages").addEventListener("click", () => createManual(false));

function zoomCamera(multiplier) {
  state.camera.zoom = clamp(state.camera.zoom * multiplier, 0.16, 2.2);
  updateHud(); invalidate();
}
document.getElementById("qualitySelect").addEventListener("change", event => setQuality(event.target.value));
document.getElementById("zoomIn").addEventListener("click", () => zoomCamera(1.2));
document.getElementById("zoomOut").addEventListener("click", () => zoomCamera(1 / 1.2));
document.getElementById("centerCamera").addEventListener("click", () => {
  state.camera.x = state.worldSize / 2;
  state.camera.y = state.worldSize / 2;
  state.camera.zoom = clamp(Math.min(innerWidth, innerHeight) * 0.8 / state.worldSize, 0.16, 0.6);
  updateHud(); invalidate();
});
function togglePanel(panelId, buttonId, force) {
  const panel = document.getElementById(panelId);
  const collapsed = force === undefined ? !panel.classList.contains("collapsed") : !force;
  panel.classList.toggle("collapsed", collapsed);
  document.getElementById(buttonId).setAttribute("aria-expanded", String(!collapsed));
}
document.getElementById("toggleEnvironment").addEventListener("click", () => {
  togglePanel("environmentPanel", "toggleEnvironment");
  if (innerWidth < 621) togglePanel("ecosystemPanel", "toggleSpecies", false);
});
document.getElementById("toggleSpecies").addEventListener("click", () => {
  togglePanel("ecosystemPanel", "toggleSpecies");
  if (innerWidth < 621) togglePanel("environmentPanel", "toggleEnvironment", false);
});
if (innerWidth < 901) togglePanel("ecosystemPanel", "toggleSpecies", false);
if (innerWidth < 621) togglePanel("environmentPanel", "toggleEnvironment", false);
document.getElementById("speciesList").addEventListener("click", event => {
  const button = event.target.closest("[data-species-index]");
  if (!button) return;
  const sp = state.species[Number(button.dataset.speciesIndex)];
  const creature = state.creatures.find(c => c.speciesId === sp?.id);
  if (!creature) return;
  state.selected = creature;
  state.camera.x = creature.x;
  state.camera.y = creature.y;
  selectionKey = null;
  updateSelection(); updateSpeciesList(); invalidate();
});
document.querySelectorAll(".menu-items button").forEach(button => button.addEventListener("click", () => { document.getElementById("worldMenu").open = false; }));

buildEnvControls();
buildManualTraits();
updateManualSpeciesCounter();
initEnvironment();
setQuality(quality);
loadConfigStatus();
frameRequest = requestAnimationFrame(loop);
