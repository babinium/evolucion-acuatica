const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d", { alpha: false });

const traitKeys = [
  "size", "speed", "attack", "defense", "perception", "fertility",
  "metabolism", "foodEfficiency", "toxicity"
];

const MAX_INITIAL_SPECIES_PER_TYPE = 4;
const MAX_MANUAL_SPECIES_PER_WORLD = 4;
const INITIAL_HERBIVORES_PER_SPECIES = 24;
const INITIAL_PREY_PER_CARNIVORE = 6;
const INITIAL_CARNIVORES_PER_SPECIES = Math.max(1, Math.round(INITIAL_HERBIVORES_PER_SPECIES / INITIAL_PREY_PER_CARNIVORE));
const MAX_SIMULATION_SPEED = 10;
const MAX_ECOLOGY_STEP = 1 / 6;

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
  temperature: ["Temperatura", 0, 100, 48, "El frío ralentiza la actividad; el calor aumenta el gasto. Los extremos dañan la salud y reducen la fotosíntesis."],
  light: ["Luz", 0, 100, 68, "Sin luz no hay fotosíntesis ni rebrote. Las plantas y algas necesitan también nutrientes disponibles."],
  oxygen: ["Oxígeno", 0, 100, 62, "Nivel de oxígeno del agua entrante. La respiración lo consume y la fotosíntesis lo repone localmente; la escasez reduce actividad y daña."],
  nutrients: ["Nutrientes", 0, 100, 70, "Aporte de nutrientes al mundo. Plantas y algas compiten por reservas locales finitas; los restos y desechos reciclan una parte."],
  toxicity: ["Contaminación", 0, 100, 12, "Contaminación del agua: reduce el crecimiento y, por encima de 25, daña la salud. Las toxinas del cuerpo no dan inmunidad."],
  currents: ["Corriente", 0, 100, 35, "Desplaza animales y cadáveres, mezcla nutrientes entre zonas y renueva el oxígeno. Los productores están anclados."],
  algaeRate: ["Algas nuevas", 0, 100, 16, "Colonización de nuevas manchas de algas; requiere luz y nutrientes, que se descuentan de la zona. Cero detiene la colonización."]
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
  followSelected: false,
  activeTool: null,
  toolRadius: 210,
  mouse: { x: 0, y: 0, worldX: 0, worldY: 0 },
  camera: { x: 1200, y: 1100, zoom: 0.45 },
  env: {},
  envTarget: {},
  envBaseline: {},
  species: [],
  creatures: [],
  resources: [],
  corpses: [],
  zones: [],
  extinct: 0,
  nextSpeciesId: 1,
  nextCreatureId: 1,
  manualSpeciesCreated: 0,
  evolutionAiEnabled: false,
  evolutionAiBlocked: "",
  lastEvent: "Esperando inicio",
  aiCalls: 0
};

const spriteCache = new Map();
const speciesById = new Map();
const creatureGrid = new SpatialGrid();
const resourceGrid = new SpatialGrid();
const corpseGrid = new SpatialGrid();
const classGrids = { producer: new SpatialGrid(), herbivore: new SpatialGrid(), carnivore: new SpatialGrid() };
const proceduralSprites = new Map();
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
let configState = { canUseAiText: false, canUseAiImages: false };
let configLoaded = false;
let worldStarting = false;
let creatingSpecies = false;

function rebuildSpeciesIndex() {
  speciesById.clear();
  for (const sp of state.species) speciesById.set(sp.id, sp);
}

function rebuildSpatialIndexes() {
  creatureGrid.rebuild(state.creatures);
  resourceGrid.rebuild(state.resources);
  corpseGrid.rebuild(state.corpses);
  for (const grid of Object.values(classGrids)) {
    for (const bucket of grid.cells.values()) bucket.length = 0;
  }
  if (state.habitats) for (const h of state.habitats) h.cover = 0;
  for (const c of state.creatures) {
    const type = getSpecies(c)?.class;
    if (type === "producer" && c.health > 0 && state.habitats) state.habitats[cellIndex(c)].cover += c.size * 0.035;
    if (classGrids[type]) classGrids[type].insert(c);
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
      ? `${status.providerLabel || 'IA'} configurado para especies e imágenes. Podés comprobar la conexión antes de generar.`
      : "Listo para jugar sin claves. Agregá la clave del proveedor elegido para crear especies e imágenes.";
  } catch {
    statusEl.textContent = "Listo para jugar sin conexión. La IA necesita el servidor local.";
  }
  document.getElementById("startAI").disabled = !configState.canUseAiImages;
  document.getElementById("startAIText").disabled = !configState.canUseAiText;
  document.getElementById("checkAi").disabled = !configState.canUseAiText;
  document.getElementById("apiBadge").textContent = configState.canUseAiText ? "IA configurada" : "Modo local disponible";
  updateManualSpeciesCounter();
  configLoaded = true;
  syncEvolutionControls();
}

async function requestApi(path, body, timeout = 70000) {
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
  const id = raw.id || uid("sp");
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
    traits.speed = 0;
  }
  if (rawClass === "herbivore") traits.attack = 0;
  return {
    id,
    bookKey: /^darwin-[a-f0-9]{16}$/.test(raw.bookKey) ? raw.bookKey : DarwinCore.keyFor({class:rawClass,name:raw.name || "Especie sin nombre",visualDescription:raw.visualDescription || ""}),
    ...lineageFields(raw,id),
    parentId: raw.parentId || null,
    name: String(raw.name || "Especie sin nombre").slice(0, 70),
    class: rawClass,
    description: String(raw.description || "Especie acuática generada localmente.").slice(0, 2000),
    visualDescription: String(raw.visualDescription || "Silueta acuática simple.").slice(0, 2000),
    diet: String(raw.diet || (rawClass==="producer" ? "Luz y nutrientes mediante fotosíntesis."
      : rawClass==="herbivore" ? "Algas y productores vivos." : "Herbívoros, otros carnívoros y carroña.")).slice(0, 2000),
    habitat: String(raw.habitat || "Aguas medias").slice(0, 2000),
    behavior: String(raw.behavior || "Explora, come y se reproduce.").slice(0, 2000),
    strengths: raw.strengths || [],
    weaknesses: raw.weaknesses || [],
    traits,
    spritePrompt: raw.spritePrompt || `An original aquatic species: ${raw.visualDescription || raw.name}. Opaque filled body, readable dorsal silhouette, head right.`,
    portraitUrl: raw.portraitUrl || "",
    spriteUrl: raw.spriteUrl || "",
    artworkVersion: raw.artworkVersion === 1 ? 1 : 0,
    artworkError: String(raw.artworkError || "").slice(0, 800),
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
        ? { size: rand(2, 7), speed: 0, attack: 0, defense: rand(4, 8), fertility: rand(10, 30), metabolism: rand(1, 5), foodEfficiency: rand(5, 9), toxicity: rand(0, 5) }
        : type === "herbivore"
          ? { size: rand(2, 7), speed: rand(3, 9), attack: 0, defense: rand(2, 8), fertility: rand(5, 20), metabolism: rand(2, 7), foodEfficiency: rand(3, 9), toxicity: rand(0, 4) }
          : { size: rand(3, 9), speed: rand(6, 10), attack: rand(4, 10), defense: rand(1, 7), fertility: rand(5, 20), metabolism: rand(4, 10), foodEfficiency: rand(2, 8), toxicity: rand(0, 3) };
      const traits = {};
      for (const key of traitKeys) {
        const max = traitMax(key, type);
        const min = traitMin(key, type);
        traits[key] = clamp(base[key] ?? (key === "fertility" ? rand(min, max) : rand(type === "carnivore" ? 5 : 2, type === "carnivore" ? 9 : 8)), min, max);
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
  state.envBaseline = {};
  for (const [key, def] of Object.entries(envDefs)) {
    state.env[key] = def[3];
    state.envTarget[key] = def[3];
    state.envBaseline[key] = def[3];
  }
}

function seedWorld(speciesList,{balancedFounders=false}={}) {
  resetEvolutionWork();
  state.species = speciesList.map((sp) => normalizeSpecies({ ...sp, extinct: false, population: 0 }));
  migrateLineages();
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
  favorSpeciesId = null;
  favorOptionsSignature = null;
  syncToolUI();
  simulationAccumulator = 0;
  state.extinct = 0;
  state.lastEvent = "Tu ecosistema está vivo. Seleccioná una especie para conocerla.";
  selectionKey = null;
  speciesListSignature = "";
  state.selected = null;
  selectedDeathMessage="";
  state.followSelected = false;
  state.nextCreatureId = 1;
  state.nextSpeciesId = state.species.length + 1;
  state.manualSpeciesCreated = 0;
  initEnvironment();
  initHabitats();

  for (let i = 0; i < 90; i++) spawnResource(rand(0, state.worldSize), rand(0, state.worldSize), rand(35, 120));
  const groups=Object.fromEntries(['producer','herbivore','carnivore'].map(type=>[type,state.species.filter(sp=>sp.class===type)]));
  const herbivoreSpecies = groups.herbivore.length;
  const carnivoreSpecies = groups.carnivore.length;
  // More identities share the same water instead of multiplying its load.
  const producerBudget=Math.round(42*Math.sqrt(groups.producer.length));
  const grazerBudget=Math.round(INITIAL_HERBIVORES_PER_SPECIES*Math.sqrt(herbivoreSpecies));
  // Diversity shares a finite starting prey supply. Afterwards only ecology sets population sizes.
  const hunterBudget = Math.min(carnivoreSpecies * INITIAL_CARNIVORES_PER_SPECIES,
    Math.max(carnivoreSpecies, Math.floor(grazerBudget / INITIAL_PREY_PER_CARNIVORE)));
  const budgets={producer:producerBudget,herbivore:grazerBudget,carnivore:hunterBudget};
  const grazers=[];
  for(const type of ['producer','herbivore','carnivore'])for(const [index,sp] of groups[type].entries()) {
    const count=Math.floor(budgets[type]/groups[type].length)+(index<budgets[type]%groups[type].length?1:0);
    for(let i=0;i<count;i++) {
      const food=type==='carnivore'&&grazers.length?pick(grazers):pick(state.resources);
      const angle=rand(0,Math.PI*2),distance=type==='carnivore'?rand(350,550):rand(20,80);
      const c=spawnCreature(sp,clamp(food.x+Math.cos(angle)*distance,40,state.worldSize-40),
        clamp(food.y+Math.sin(angle)*distance,40,state.worldSize-40),0,balancedFounders?balancedFounderGenes(sp):initialGenes(sp));
      // Mixed, well-fed founders; animal offspring use the divine birth subsidy.
      c.age=rand(0,bodyOf(c).lifespan*0.2);
      c.energy=c.maxEnergy*rand(0.8,0.95);c.hungry=false;
      // Founders represent different points in their fertility cycle. Their
      // descendants always wait a complete interval before their first brood.
      if(type!=='producer')c.cooldown=rand(bodyOf(c).birthWait*0.25,bodyOf(c).birthWait);
      if(type==='herbivore')grazers.push(c);
    }
  }
  rebuildSpatialIndexes();
  recalcSpecies();
  state.started = true;
  syncEvolutionControls();
  document.getElementById("setup").classList.add("hidden");
  document.getElementById("app").classList.add("playing");
  syncPauseButton();
  syncEnvControls();
  updateHud();
  updateSpeciesList();
  invalidate();
  updateSelection();
  for(const sp of state.species)queueBookSpecies(sp);
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
  state.resources.push({ id: uid("alga"), name: "Alga base", x, y, amount, max: amount, root: amount * 0.08, radius: Math.sqrt(amount) * 2.3 });
}

function spawnCreature(species, x, y, generation, genes = species.traits) {
  if (state.creatures.length >= MAX_CREATURES) return;
  const c = {
    id: state.nextCreatureId++, speciesId: species.id,
    x: clamp(x, 8, state.worldSize - 8), y: clamp(y, 8, state.worldSize - 8),
    vx: 0, vy: 0, genes: sanitizeGenes(genes, species.class),
    age: rand(18, 40), generation: generation || species.generation,
    state: "explorando", targetId: null, cooldown: rand(8, 25), protected: 0,
    hungry: null, parentCreatureId: null,
    wanderX: null, wanderY: null, wanderTime: 0
  };
  const body = bodyOf(c, species);
  Object.assign(c, {size: body.size, maxHealth: body.maxHealth, health: body.maxHealth,
    maxEnergy: body.maxEnergy, energy: body.maxEnergy * rand(0.45, 0.7), tissue: body.tissue});
  state.creatures.push(c);
  return c;
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
    worldStarting=true;
    const startButton=document.getElementById('startLocal'),label=startButton.innerHTML;
    startButton.disabled=true;startButton.textContent='Preparando mundo…';syncBookSelection();
    setupStatus.textContent='Preparando habitantes del libro, sin llamadas a la IA…';
    try {
      const counts={producer:producers,herbivore:herbivores,carnivore:carnivores};
      const species=document.getElementById('setupSpeciesSource').value==='book' ? await bookEntriesForWorld(counts) : [];
      const missing=type=>Math.max(0,counts[type]-species.filter(sp=>sp.class===type).length);
      species.push(...fallbackSpecies(missing('producer'),missing('herbivore'),missing('carnivore')));
      state.evolutionAiEnabled=false;state.evolutionAiBlocked="";
      seedWorld(balanceInitialSpecies(species),{balancedFounders:true});
    } catch(error) {
      const message=`No se pudo preparar el mundo: ${error.message}`;setupStatus.textContent=message;
      if(document.getElementById('darwinBook').open)darwinMessage(message);
      else showBusyError('No se pudo crear el mundo',message);
    }
    finally {worldStarting=false;startButton.disabled=false;startButton.innerHTML=label;syncBookSelection();}
    return;
  }

  worldStarting = true;
  try {
    showBusy("Creando mundo", "Preparando especies con IA...");
    setupStatus.textContent = "Preparando especies con IA...";
    state.aiCalls++;
    const data = await requestApi("/api/generate-species", {
      producers, herbivores, carnivores, world: { chaos: state.chaos, mutationRate: state.mutationRate },
      fresh: document.getElementById("reuseAiSpecies").checked === false
    });
    if (!Array.isArray(data.species) || !data.species.length) throw new Error("La IA no devolvió especies válidas.");
    const species = balanceInitialSpecies(data.species.slice(0, 12));
    let missingImages = 0;

    if (withImages) {
      for (let i = 0; i < species.length; i++) {
        const message = `Generando imagenes IA ${i + 1}/${species.length}...`;
        setupStatus.textContent = message;
        updateBusy(message);
        try { await addSpeciesArtwork(species[i], setupStatus); }
        catch (error) {
          missingImages++;
          species[i].artworkError = error.message;
          logError(`Imágenes de ${species[i].name}: ${error.message}. Se usará un dibujo local.`);
          // Permanent errors affect every following species; avoid more paid requests.
          if ([400, 401, 402, 403, 404, 429, 500, 502, 503, 504].includes(error.status)) {
            for (const remaining of species.slice(i+1)) remaining.artworkError = error.message;
            missingImages += species.length - i - 1; break;
          }
        }
      }
    }
    hideBusy();
    state.evolutionAiEnabled=withImages;state.evolutionAiBlocked="";
    seedWorld(species,{balancedFounders:true});
    if (missingImages) state.lastEvent = `Ilustraciones listas: ${species.length-missingImages}/${species.length}. El resto usa dibujos locales; la ficha muestra el motivo.`;
  } catch (error) {
    const message = `Fallo IA: ${error.message}`;
    setupStatus.textContent = message;
    showBusyError("No se pudo crear el mundo", message);
    logError(message);
  } finally { worldStarting = false; }
}

async function addSpeciesArtwork(species, statusEl, {background=false} = {}) {
  statusEl.textContent = `Creando ilustración de ${species.name}…`;
  state.aiCalls++;
  const data = await requestApi("/api/generate-images", {
    prompt: `${species.visualDescription || species.spritePrompt || species.name}. Species type: ${species.class}.`
  }, 105000);
  if (!data.image) throw new Error("La IA no devolvió una ilustración.");
  statusEl.textContent = `Recortando y preparando ${species.name}…`;
  if (!background) updateBusy(statusEl.textContent);
  // Assign only after both local assets decode and pass the cutout checks.
  // A bad image never triggers a second paid generation from the client.
  const artwork = await prepareSpeciesArtwork(data.image,species.class);
  Object.assign(species, artwork, { artworkVersion: 1, artworkError: "" });
}

function getSpecies(creature) {
  return speciesById.get(creature.speciesId);
}

function update(dt) {
  if (!state.started) return;
  updateCamera(dt);
  if (state.paused) { updateFollowCamera(); return; }
  const simDt = dt * state.speed;
  // Keep the ecological step as small as at 5x; 10x needs two bounded steps.
  const steps = Math.max(1, Math.ceil(simDt / MAX_ECOLOGY_STEP));
  const stepDt = simDt / steps;
  for (let i=0;i<steps;i++) {
    state.day += stepDt * 0.018;
    updateEnvironment(stepDt);
    updateResources(stepDt);
    updateCorpses(stepDt);
    updateZones(stepDt);
    rebuildSpatialIndexes();
    updateCreatures(stepDt);
    recalcSpecies();
  }
  updateFollowCamera();
}

function livingSelection() {
  const c=state.selected;
  return c && c.health>0 && c.energy>-35 && state.creatures.includes(c) ? c : null;
}

function syncFollowControls() {
  const c=livingSelection(),button=document.getElementById("followSelectedBtn");
  button.disabled=!c;
  button.setAttribute("aria-pressed",String(state.followSelected));
  button.title=c ? `${state.followSelected ? 'Dejar de seguir' : 'Seguir'} al individuo #${c.id} (F)`
    : "Seleccioná un individuo para seguirlo (F)";
  setText("followSelectedLabel",state.followSelected ? "Siguiendo" : "Seguir");
}

function setFollowSelected(enabled) {
  const wasFollowing=state.followSelected;
  state.followSelected=Boolean(enabled && state.started && livingSelection());
  if(state.followSelected) {
    if(state.activeTool)cancelTool();
    updateFollowCamera();
  }
  syncFollowControls();
  if(wasFollowing!==state.followSelected)invalidate();
}

function updateFollowCamera() {
  if(!state.followSelected)return;
  const c=livingSelection();
  if(!c) { setFollowSelected(false); return; }
  if(state.camera.x!==c.x || state.camera.y!==c.y) {
    state.camera.x=c.x;state.camera.y=c.y;invalidate();
  }
}

function updateCamera(dt) {
  const pan = 520 * dt / Math.max(0.5, state.camera.zoom);
  const dx=Number(keys.has("d") || keys.has("arrowright"))-Number(keys.has("a") || keys.has("arrowleft"));
  const dy=Number(keys.has("s") || keys.has("arrowdown"))-Number(keys.has("w") || keys.has("arrowup"));
  if(dx || dy) {
    if(state.followSelected)setFollowSelected(false);
    state.camera.x+=dx*pan;state.camera.y+=dy*pan;invalidate();
  }
  state.camera.x = clamp(state.camera.x, 0, state.worldSize);
  state.camera.y = clamp(state.camera.y, 0, state.worldSize);
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

function clipToWorld() {
  const origin = worldToScreen(0, 0);
  ctx.beginPath();
  ctx.rect(origin.x, origin.y, state.worldSize * state.camera.zoom, state.worldSize * state.camera.zoom);
  ctx.clip();
}

function drawZones() {
  ctx.save(); clipToWorld();
  for (const z of state.zones) {
    if (!inView(z.x, z.y, z.radius * state.camera.zoom + 60)) continue;
    const def = toolDefs[z.type];
    if (!def) continue;
    const s = worldToScreen(z.x, z.y);
    const remaining = clamp(z.ttl / (z.duration || def.duration || 2), 0, 1);
    ctx.globalAlpha = def.duration ? 0.11 : remaining * 0.18;
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(s.x, s.y, z.radius * state.camera.zoom, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = def.duration ? 0.55 : remaining * 0.6;
    ctx.strokeStyle = def.color; ctx.lineWidth = 1;
    ctx.stroke();
    if (def.duration) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = def.color; ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`${def.name} · ${Math.ceil(z.ttl)} s`, s.x - 32, s.y - z.radius * state.camera.zoom - 7);
    }
  }
  ctx.restore();
}

function drawToolPreview() {
  const def = toolDefs[state.activeTool];
  if (!def || !state.started || !pointerOverWorld) return;
  const point = screenToWorld(state.mouse.x, state.mouse.y);
  const valid = insideWorld(point.x, point.y);
  ctx.save(); clipToWorld();
  const radius = state.toolRadius * state.camera.zoom;
  ctx.fillStyle = valid ? def.color : "#84969e";
  ctx.globalAlpha = 0.12;
  ctx.beginPath(); ctx.arc(state.mouse.x, state.mouse.y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.95; ctx.strokeStyle = valid ? def.color : "#84969e";
  ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(state.mouse.x - 6, state.mouse.y); ctx.lineTo(state.mouse.x + 6, state.mouse.y);
  ctx.moveTo(state.mouse.x, state.mouse.y - 6); ctx.lineTo(state.mouse.x, state.mouse.y + 6); ctx.stroke();
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
    const shielded = isProtected(c);
    ctx.globalAlpha = shielded ? 1 : 0.88;
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
    if (shielded) {
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

function getProceduralSprite(sp, resolution=96) {
  const key=resolution===96 ? sp.id : `${sp.id}:${resolution}`;
  const cached = proceduralSprites.get(key);
  if (cached) return cached;
  const sprite = document.createElement("canvas");
  sprite.width = resolution; sprite.height = resolution;
  const c = sprite.getContext("2d");
  c.scale(resolution/96,resolution/96);
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
  proceduralSprites.set(key, sprite);
  return sprite;
}

function getSprite(species) {
  if (!species.spriteUrl) return null;
  // Descendant species reuse the same image and its prepared canvas.
  const key = species.spriteUrl;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const entry = { ready: false, canvas: null };
  spriteCache.set(key, entry);
  const img = new Image();
  img.onload = () => {
    try {
      if (species.artworkVersion === 1) {
        entry.canvas = document.createElement("canvas");
        entry.canvas.width = 192; entry.canvas.height = 192;
        entry.canvas.getContext("2d").drawImage(img, 0, 0, 192, 192);
      } else entry.canvas = removeSpriteBackground(img);
      entry.ready = true;
    } catch { entry.ready = false; }
    invalidate();
  };
  if(location.protocol!=='file:')img.crossOrigin = "anonymous";
  img.onerror = () => { entry.ready = false; };
  img.src = species.spriteUrl;
  return entry;
}

function cutoutImage(img,singleAnimal=false) {
  const width=img.naturalWidth||img.width, height=img.naturalHeight||img.height;
  if(!width||!height||width>4096||height>4096) throw new Error("La ilustración tiene dimensiones inválidas.");
  const scale=Math.min(1,512/Math.max(width,height));
  const source=document.createElement("canvas");
  source.width=Math.max(8,Math.round(width*scale));source.height=Math.max(8,Math.round(height*scale));
  const context=source.getContext("2d",{willReadFrequently:true});
  context.drawImage(img,0,0,source.width,source.height);
  const image=context.getImageData(0,0,source.width,source.height);
  const result=SpriteTools.cutout(image.data,source.width,source.height,{singleAnimal});
  image.data.set(result.data);context.putImageData(image,0,0);
  return {source,...result};
}

function fittedArtwork(cutout,size) {
  const out = document.createElement("canvas");
  out.width=size;out.height=size;
  const target=SpriteTools.fit(cutout.bounds,size);
  const b=cutout.bounds;
  out.getContext("2d").drawImage(cutout.source,b.x,b.y,b.width,b.height,target.x,target.y,target.width,target.height);
  return out;
}

function removeSpriteBackground(img) {
  return fittedArtwork(cutoutImage(img),192);
}

async function prepareSpeciesArtwork(url,kind) {
  if(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/i.test(url)||url.length>12*1024*1024) {
    throw new Error("La ilustración recibida no tiene un formato válido.");
  }
  const img=await new Promise((resolve,reject)=>{
    const image=new Image();
    const timer=setTimeout(()=>{image.onload=null;image.onerror=null;reject(new Error("No se pudo abrir la ilustración a tiempo."));},15000);
    image.onload=()=>{clearTimeout(timer);resolve(image);};
    image.onerror=()=>{clearTimeout(timer);reject(new Error("El navegador no pudo abrir la ilustración."));};
    image.src=url;
  });
  const cutout=cutoutImage(img,kind==='herbivore'||kind==='carnivore');
  if(cutout.clipped) throw new Error("La ilustración toca el borde y puede estar cortada. Se usará un dibujo local.");
  return {spriteUrl:fittedArtwork(cutout,192).toDataURL("image/png"),
    portraitUrl:fittedArtwork(cutout,384).toDataURL("image/png")};
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
  const identities=livingIdentities();
  setText("speciesStat", identities.size);
  setText("extinctStat", state.species.filter(sp=>sp.variationDepth===0 && !identities.has(sp.id)).length);
  setText("eventStat", state.lastEvent);
  setText("speedLabel", `${state.speed}x`);
  setText("zoomLabel", `${Math.round(state.camera.zoom * 100)}%`);
  setText("mapSizeLabel", `${state.worldSize.toLocaleString("es-AR")} × ${state.worldSize.toLocaleString("es-AR")}`);
  updateToolPreviewStatus();
  setText("performanceStat", `${performancePresets[quality].label} · ${state.paused ? "En pausa" : `${measuredFps || performancePresets[quality].fps} FPS`} · ${performancePresets[quality].fps} máx.`);
}

function loop(ts) {
  frameRequest = 0;
  if (document.hidden) return;
  if(document.getElementById('darwinBook').open) {
    lastTs=ts;simulationAccumulator=0;
    frameRequest=requestAnimationFrame(loop);return;
  }
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
  if (ts - lastHudTs >= 250) { updateHud(); processEvolutionQueue(); lastHudTs = ts; }
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
  const safe=/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(value || "")
    || /^assets\/darwin\/[a-z0-9-]+-(?:sprite|portrait)\.png$/.test(value || "");
  return safe ? escapeHtml(value) : "";
}

let selectionKey = null;
let selectedDeathMessage = "";
function updateSelection() {
  const panel = document.getElementById("selectionPanel");
  const empty = document.getElementById("selectionEmpty");
  const c = state.selected;
  if (!livingSelection()) {
    state.selected = null;
    setFollowSelected(false);
    selectionKey = null;
    panel.classList.add("hidden");
    empty.classList.remove("hidden");
    document.getElementById("selectionDeath").textContent=selectedDeathMessage;
    document.getElementById("selectionDeath").classList.toggle("hidden",!selectedDeathMessage);
    return;
  }
  selectedDeathMessage="";
  document.getElementById("selectionDeath").textContent="";
  document.getElementById("selectionDeath").classList.add("hidden");
  updateFollowCamera();syncFollowControls();
  const sp = getSpecies(c);
  if (!sp) return;
  const identity = speciesById.get(sp.identityId) || sp;
  if (identity.evolutionSource && !identity.portraitUrl) ensureLocalEvolutionArtwork(identity);
  empty.classList.add("hidden");
  panel.classList.remove("hidden");
  const key = `${c.id}:${sp.id}`;
  if (selectionKey !== key) {
    const imageUrl = safeImageUrl(sp.portraitUrl);
    const image = imageUrl ? `<button type="button" class="portrait-button" data-zoom-portrait aria-haspopup="dialog" aria-controls="portraitViewer" aria-label="Ampliar imagen de ${escapeHtml(sp.name)}" title="Ampliar imagen (×3)"><img class="portrait" src="${imageUrl}" alt="Retrato de ${escapeHtml(sp.name)}" loading="lazy"><span class="portrait-zoom" aria-hidden="true">×3</span></button>`
      : sp.artworkError ? `<p class="hint artwork-warning">Ilustración no disponible: ${escapeHtml(sp.artworkError)} Se usa un dibujo local.</p>` : "";
    panel.innerHTML = `
      <button class="text-button selection-back" data-return-species>← Ver todas las especies</button>
      ${image}
      <div class="selection-heading"><span class="selection-avatar" style="color:${escapeHtml(sp.color)}"><svg><use href="#${sp.class === "producer" ? "i-leaf" : "i-fish"}"/></svg></span><div><span class="species-chip">${className(sp.class)} · Individuo #${c.id}</span><h2>${escapeHtml(sp.name)}</h2></div></div>
      <section id="selectionLife" class="life-status" title="Tiempo natural por edad. El hambre, la caza y el ambiente pueden acortarlo.">
        <div class="life-heading"><span>Vida restante</span><b id="selectionLifeValue"></b></div>
        <div id="selectionLifeMeter" class="life-meter" role="meter" aria-label="Vida natural restante" aria-valuemin="0" aria-valuemax="100"><i id="selectionLifeFill"></i></div>
        <p><span id="selectionLifeStage"></span><span>Por edad; el hambre y los daños pueden acortarla.</span></p>
      </section>
      <p class="hint">${escapeHtml(sp.description)}</p>
      <p class="hint lineage-status">${escapeHtml(evolutionSummary(sp))}</p>
      ${sp.class === "producer" ? `<p class="hint">Las raíces pueden guardar hasta ${Math.round(bodyOf(c).rootReserve)} de energía fuera del alcance del pastoreo. Esa reserva se gasta al vivir, recuperarse y formar brotes; no evita el hambre ni la vejez.</p>` : ""}
      ${sp.class !== "producer" ? `<p class="hint">Ayuda divina: cría con 55% de salud y 75% de energía. Paga 25% de su capacidad; la cría recibe 75% de la suya. La fertilidad marca el intervalo.</p>` : ""}
      <div class="detail-grid">${["Estado", "Generación", "Edad", "Energía", "Salud", "Población", "Oxígeno local", "Nutrientes locales", "Cobertura vegetal", "Gasto basal",...(sp.class!=='producer'?["Próxima cría","Intervalo de cría"]:[])].map((label, i) => `<div class="detail"><span>${label}</span><b data-selection="${i}"></b></div>`).join("")}</div>
      <p class="hint"><b>Dieta:</b> ${escapeHtml(sp.diet)}</p>
      <p class="hint"><b>Hábitat:</b> ${escapeHtml(sp.habitat)}</p>
      <p class="hint inherited-hint">Rasgos de este individuo · heredados con variaciones. Pasá el cursor para ver ventajas y costos.</p>
      <div class="trait-list">${traitKeys.map(k => traitBar(k, c.genes[k], sp.class)).join("")}</div>`;
    selectionKey = key;
  }
  const life=lifeOf(c);
  document.getElementById("selectionLifeValue").textContent=`${Math.ceil(life.remaining).toLocaleString('es-AR')} s`;
  document.getElementById("selectionLifeStage").textContent=life.stage;
  document.getElementById("selectionLifeFill").style.width=`${life.fraction*100}%`;
  const meter=document.getElementById("selectionLifeMeter");
  meter.setAttribute('aria-valuenow',String(Math.round(life.fraction*100)));
  meter.setAttribute('aria-valuetext',`${Math.ceil(life.remaining)} segundos de vida natural restante`);
  document.getElementById("selectionLife").dataset.stage=life.stage;
  const water = localWater(c);
  const cover = state.habitats[cellIndex(c)].cover || 0;
  const values = [c.state, c.generation, `${Math.floor(life.elapsed)} / ${Math.ceil(life.total)} s`, `${Math.floor(c.energy)} / ${Math.floor(c.maxEnergy)}`, `${Math.floor(c.health)} / ${Math.floor(c.maxHealth)}`, sp.population, Math.round(water.oxygen), Math.round(water.nutrients), `${Math.round(cover / (cover + 2) * 100)}%`, `${(bodyOf(c).basal * water.temperatureActivity).toFixed(1)} / s`];
  if(sp.class!=='producer') {
    const body=bodyOf(c);
    const next=body.fertility<=0?'Estéril':c.age<body.maturity?'Juvenil':c.cooldown>0?`${Math.ceil(c.cooldown)} s`
      :c.health<c.maxHealth*ANIMAL_BIRTH_HEALTH?'Espera salud':c.energy<c.maxEnergy*ANIMAL_BIRTH_ENERGY?'Espera energía'
      :state.creatures.length>=MAX_CREATURES?'Límite de población'
      :sp.class==='carnivore'&&!preySupportsBrood()?'Espera presas':'Lista';
    values.push(next,body.fertility>0?`${Math.round(body.birthWait)} s`:'—');
  }
  panel.querySelectorAll("[data-selection]").forEach((el, i) => {
    const value = String(values[i]);
    if (el.textContent !== value) el.textContent = value;
  });
}

let speciesListSignature = "";
function updateSpeciesList() {
  const signature = state.species.map(sp => `${sp.id}:${sp.population}:${sp.extinct}`).join("|") + `:${state.selected?.speciesId || ""}`;
  if (state.activeTool === "favor") syncFavorOptions();
  if (signature === speciesListSignature) return;
  speciesListSignature = signature;
  setText("speciesCount", livingIdentities().size);
  const counts = countLivingClasses();
  document.getElementById("trophicSummary").innerHTML = [["producer", "Productores"], ["herbivore", "Herbívoros"], ["carnivore", "Carnívoros"]].map(([type, label]) => `<span class="${type}"><b>${counts[type]}</b>${label}</span>`).join("");
  document.getElementById("speciesList").innerHTML = state.species.map((sp, i) => `<button class="species-row ${sp.extinct ? "extinct" : ""} ${state.selected?.speciesId === sp.id ? "active" : ""}" data-species-index="${i}" ${sp.population ? "" : "disabled"} title="Ver ${escapeHtml(sp.name)}"><span class="species-symbol" style="color:${escapeHtml(sp.color)}"><svg><use href="#${sp.class === "producer" ? "i-leaf" : "i-fish"}"/></svg></span><span><strong>${escapeHtml(sp.name)}</strong><small>${sp.extinct ? "Linaje extinto" : className(sp.class)}${sp.variationDepth ? ` · Variación ${sp.variationDepth}/2` : ""}</small></span><b>${sp.population}</b></button>`).join("");
}

function detail(label, value) {
  return `<div class="detail"><span>${label}</span><b>${value}</b></div>`;
}

function traitBar(key, value, type = "herbivore") {
  const max = traitMax(key, type);
  if (!max) return "";
  return `<div class="trait-bar" tabindex="0" title="${escapeHtml(traitHelp[key])}" aria-label="${traitLabels[key]}: ${value.toFixed(1)}. ${escapeHtml(traitHelp[key])}"><span>${traitLabels[key]}</span><div class="bar"><i style="width:${(value / max) * 100}%"></i></div><b>${value.toFixed(1)}</b></div>`;
}

function traitMax(key, speciesClass = "herbivore") {
  if (key === "speed" && speciesClass === "producer") return 0;
  if (key === "attack" && speciesClass !== "carnivore") return 0;
  if (key !== "fertility") return 10;
  return speciesClass === "producer" ? 30 : 20;
}

function traitMin() { return 0; }

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
    state.envBaseline[key] = Number(input.value);
    refreshWater(); syncNutrientStock(); updateSelection(); invalidate();
    input.nextElementSibling.textContent = Math.round(state.env[key]);
  });
}

function syncNutrientStock() {
  const stock = state.habitats?.reduce((sum, h) => sum + h.stock, 0) / 16 || 0;
  setText("nutrientStock", `${Math.round(stock * (state.env.nutrients || 0))} / 100`);
}

function syncEnvControls() {
  syncNutrientStock();
  let maxGeneration = 1;
  for (const c of state.creatures) maxGeneration = Math.max(maxGeneration, c.generation);
  setText("generationStat", maxGeneration);
  for (const input of document.querySelectorAll("input[data-env]")) {
    const key = input.dataset.env;
    if (document.activeElement === input) continue;
    input.value = Math.round(state.env[key] ?? input.value);
    input.nextElementSibling.textContent = Math.round(state.env[key] ?? input.value);
  }
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  if (event.button === 1) event.preventDefault();
  dragging = true;
  dragDistance = 0;
  lastMouse = { x: event.clientX, y: event.clientY };
});

window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointercancel", () => { dragging = false; dragDistance = Infinity; });
canvas.addEventListener("pointerenter", event => { pointerOverWorld = true; updateMouseWorld(event); updateToolPreviewStatus(); invalidate(); });
canvas.addEventListener("pointerleave", () => { pointerOverWorld = false; updateToolPreviewStatus(); invalidate(); });
canvas.addEventListener("contextmenu", event => { if (state.activeTool) { event.preventDefault(); cancelTool(); } });
window.addEventListener("pointermove", (event) => {
  if (pointerOverWorld || dragging) updateMouseWorld(event);
  if (!dragging) return;
  const dx = event.clientX - lastMouse.x;
  const dy = event.clientY - lastMouse.y;
  dragDistance += Math.abs(dx) + Math.abs(dy);
  if(dragDistance>5) {
    if(state.followSelected)setFollowSelected(false);
    state.camera.x -= dx / state.camera.zoom;
    state.camera.y -= dy / state.camera.zoom;
  }
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
  if (dragDistance > 5 || event.button > 0) return;
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
    revealSelection();
  }
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  updateMouseWorld(event);
  if (state.activeTool && !event.shiftKey) {
    const direction = event.deltaY > 0 ? -1 : 1;
    setToolRadius(state.toolRadius + direction * 20);
    return;
  }
  if(state.followSelected) {
    zoomCamera(event.deltaY>0 ? 0.88 : 1.14);
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
  const portraitViewer = document.getElementById("portraitViewer");
  if (portraitViewer.open) {
    if (event.key === "Escape") { event.preventDefault(); portraitViewer.close(); }
    return;
  }
  if(document.getElementById('darwinBook').open)return;
  if (event.key === "Escape") {
    if(state.followSelected)setFollowSelected(false);
    cancelTool();
    const modal = document.getElementById("modal");
    if (!modal.classList.contains("hidden")) {
      modal.classList.add("hidden"); document.getElementById("newSpeciesBtn").focus();
    }
    document.getElementById("worldMenu").open = false;
    document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", "false"));
    invalidate(); return;
  }
  if (event.target?.closest("input, textarea, select") || event.ctrlKey || event.metaKey || event.altKey) return;
  if(event.key.toLowerCase()==="f" && state.started) {
    if(!event.repeat) { event.preventDefault();setFollowSelected(!state.followSelected); }
    return;
  }
  const power = Object.entries(toolDefs).find(([, def]) => def.shortcut === event.key);
  if (power && !event.repeat) { event.preventDefault(); selectTool(power[0]); return; }
  if (state.activeTool && ["[", "]"].includes(event.key)) {
    event.preventDefault(); setToolRadius(state.toolRadius + (event.key === "]" ? 10 : -10)); return;
  }
  if (event.key === " " && state.started && !event.target?.closest("button, summary")) { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
  keys.add(event.key.toLowerCase());
});
window.addEventListener("blur", () => { keys.clear(); dragging = false; });
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));


document.getElementById("startLocal").addEventListener("click", () => startWorld(false));
document.getElementById("startAI").addEventListener("click", () => startWorld(true, true));
document.getElementById("startAIText").addEventListener("click", () => startWorld(true, false));
document.getElementById("checkAi").addEventListener("click", async () => {
  const button=document.getElementById("checkAi"),status=document.getElementById("aiStatus");
  button.disabled=true;status.textContent="Comprobando la clave y los modelos, sin generar contenido…";
  try { const result=await requestApi("/api/check-ai",{},50000);status.textContent=result.message; }
  catch(error) {status.textContent=error.message;}
  finally {button.disabled=!configState.canUseAiText;}
});
function syncPauseButton() {
  document.getElementById("pauseBtn").textContent = state.paused ? "Reanudar" : "Pausar";
  document.getElementById("pauseBtn").setAttribute("aria-pressed", String(state.paused));
  document.getElementById("liveLabel").textContent = state.paused ? "EN PAUSA" : "EN VIVO";
}
function togglePause() { state.paused = !state.paused; syncPauseButton(); invalidate(); }
function setSimulationSpeed(value) {
  state.speed = clamp(Math.round(Number(value) || 1), 1, MAX_SIMULATION_SPEED);
  setText("speedLabel", `${state.speed}x`);
}
document.getElementById("pauseBtn").addEventListener("click", togglePause);
document.getElementById("speedDown").addEventListener("click", () => setSimulationSpeed(state.speed - 1));
document.getElementById("speedUp").addEventListener("click", () => setSimulationSpeed(state.speed + 1));
document.querySelector(".tool-grid").addEventListener("click", event => {
  const button = event.target.closest("button[data-tool]");
  if (button) selectTool(button.dataset.tool);
});
document.getElementById("toolRadius").addEventListener("input", event => setToolRadius(event.target.value));
document.querySelectorAll("[data-radius]").forEach(button => button.addEventListener("click", () => setToolRadius(button.dataset.radius)));
document.getElementById("toolRepeat").addEventListener("change", event => { toolRepeat = event.target.checked; });
document.getElementById("favorSpecies").addEventListener("change", event => { favorSpeciesId = event.target.value; invalidate(); });
document.getElementById("favorSpecies").addEventListener("blur", syncFavorOptions);
document.getElementById("evolutionAi").addEventListener("change",event=>{
  state.evolutionAiEnabled=event.target.checked;
  if (state.evolutionAiEnabled) state.evolutionAiBlocked="";
  syncEvolutionControls();processEvolutionQueue();
});
document.getElementById("cancelTool").addEventListener("click", () => cancelTool());
document.getElementById("dockCancelTool").addEventListener("click", () => cancelTool());

function saveWorld() {
  if (!state.started) return;
  for(const sp of state.species)queueBookSpecies(sp);
  flushDarwinBook();
  const snapshot = packArtwork({ ...state, selected: null, selectedId: state.selected?.id || null, activeTool: null });
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
    unpackArtwork(saved);
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
    const legacy = saved.ecologyVersion !== ECOLOGY_VERSION;
    resetEvolutionWork();
    selectedDeathMessage="";
    Object.assign(state, saved, { started: true, activeTool: null, followSelected: false,
      envBaseline: {...(saved.envBaseline || saved.envTarget)},
      evolutionAiEnabled: typeof saved.evolutionAiEnabled==="boolean" ? saved.evolutionAiEnabled
        : saved.species.some(sp=>sp.artworkVersion===1 && sp.portraitUrl),
      evolutionAiBlocked: saved.evolutionAiBlocked || "" });
    migrateLineages();
    setSimulationSpeed(state.speed);
    state.creatures = state.creatures.slice(0, MAX_CREATURES);
    state.resources = state.resources.slice(0, MAX_RESOURCES);
    state.corpses = (state.corpses || []).slice(0, MAX_CORPSES);
    state.zones = (state.zones || []).filter(z => toolDefs[z.type]
      && [z.x, z.y, z.radius, z.ttl].every(Number.isFinite) && z.radius > 0 && z.ttl > 0).slice(-MAX_ACTIVE_ZONES - MAX_TOOL_MARKERS);
    favorSpeciesId = null; favorOptionsSignature = null; syncToolUI();
    state.selected = state.creatures.find(c => c.id === selectedId) || null;
    state.nextCreatureId = Math.max(state.nextCreatureId || 1, ...state.creatures.map(c => c.id + 1));
    spriteCache.clear(); proceduralSprites.clear(); selectionKey = null; speciesListSignature = "";
    rebuildSpeciesIndex(); migrateEcology(legacy); rebuildSpatialIndexes(); recalcSpecies();
    setFollowSelected(saved.followSelected===true);
    simulationAccumulator = 0;
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("app").classList.add("playing");
    state.lastEvent = "Partida cargada";
    for(const sp of state.species)queueBookSpecies(sp);
    syncPauseButton(); syncEnvControls(); syncEvolutionControls(); updateSelection(); updateSpeciesList(); updateHud(); invalidate();
    if(state.followSelected)revealSelection();
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
document.getElementById("newWorldBtn").addEventListener("click", async () => {await flushDarwinBook();location.reload();});

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
  imageButton.disabled = atLimit || !configState.canUseAiImages || creatingSpecies;
  noImageButton.disabled = atLimit || creatingSpecies;
  counter.classList.toggle("limit", atLimit);
}

function buildManualTraits() {
  const box = document.getElementById("manualTraits");
  box.innerHTML = "";
  const speciesClass = document.getElementById("manualClass")?.value || "herbivore";
  const defaults = { size: 5, speed: speciesClass === "producer" ? 0 : speciesClass === "carnivore" ? 8 : 6, attack: speciesClass === "carnivore" ? 5 : 0, defense: 4, perception: 6, fertility: speciesClass === "producer" ? 18 : 10, metabolism: 6, foodEfficiency: 5, toxicity: 1 };
  for (const key of traitKeys) {
    if (traitMax(key, speciesClass) === 0) continue;
    const label = document.createElement("label");
    label.textContent = traitLabels[key];
    label.title = traitHelp[key];
    const max = traitMax(key, speciesClass);
    const min = traitMin(key, speciesClass);
    label.innerHTML += `<input type="number" min="${min}" max="${max}" value="${defaults[key]}" data-trait="${key}" ${max === 0 ? "disabled" : ""}>`;
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
    spritePrompt: `An original aquatic species: ${desc||name}. Opaque colored body, sturdy fins, dorsal top-down view, head right, readable silhouette.`
  });
  const status = document.getElementById("manualStatus");
  creatingSpecies = true;
  updateManualSpeciesCounter();
  try {
    if (withImages) {
      showBusy("Creando especie", "Generando imagenes IA...");
      status.textContent = "Generando imagenes IA...";
      await addSpeciesArtwork(sp, status);
    }
    state.species.push(sp);
    speciesById.set(sp.id, sp);
    queueBookSpecies(sp);
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
document.getElementById("followSelectedBtn").addEventListener("click", () => setFollowSelected(!state.followSelected));
document.getElementById("centerCamera").addEventListener("click", () => {
  setFollowSelected(false);
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

function revealSelection() {
  togglePanel("ecosystemPanel", "toggleSpecies", true);
  if (innerWidth < 901) togglePanel("environmentPanel", "toggleEnvironment", false);
  const panel=document.getElementById("ecosystemPanel"),selection=document.getElementById("selectionPanel");
  panel.scrollTop=(panel.scrollTop||0)+selection.getBoundingClientRect().top-panel.getBoundingClientRect().top-12;
}

let portraitReturnFocus = null;
function openPortrait(button) {
  const source = button.querySelector(".portrait");
  if (!source?.complete || !source.naturalWidth) return;
  const viewer = document.getElementById("portraitViewer");
  const image = document.getElementById("portraitViewerImage");
  const bounds = source.getBoundingClientRect();
  // Enlarge the contained illustration, rather than the empty space beside it.
  const width = Math.min(bounds.width, bounds.height * source.naturalWidth / source.naturalHeight);
  const height = width * source.naturalHeight / source.naturalWidth;
  const scale = Math.min(3, (innerWidth - 32) / width, (innerHeight - 96) / height);
  image.src = source.currentSrc || source.src;
  image.alt = source.alt;
  image.style.width = `${width * scale}px`;
  image.style.height = `${height * scale}px`;
  portraitReturnFocus = button;
  keys.clear(); dragging = false;
  viewer.showModal();
}

const portraitViewer = document.getElementById("portraitViewer");
portraitViewer.addEventListener("click", () => portraitViewer.close());
portraitViewer.addEventListener("cancel", event => { event.preventDefault(); portraitViewer.close(); });
portraitViewer.addEventListener("close", () => {
  document.getElementById("portraitViewerImage").removeAttribute("src");
  if (portraitReturnFocus?.isConnected) portraitReturnFocus.focus({preventScroll:true});
  portraitReturnFocus = null;
});
document.getElementById("selectionPanel").addEventListener("click",event=>{
  const portrait = event.target.closest("[data-zoom-portrait]");
  if (portrait) { openPortrait(portrait); return; }
  if(event.target.closest("[data-return-species]")) document.getElementById("ecosystemPanel").scrollTop=0;
});
document.getElementById("toggleEnvironment").addEventListener("click", () => {
  togglePanel("environmentPanel", "toggleEnvironment");
  if (innerWidth < 901) togglePanel("ecosystemPanel", "toggleSpecies", false);
});
document.getElementById("toggleSpecies").addEventListener("click", () => {
  togglePanel("ecosystemPanel", "toggleSpecies");
  if (innerWidth < 901) togglePanel("environmentPanel", "toggleEnvironment", false);
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
  revealSelection();
});
document.querySelectorAll(".menu-items button").forEach(button => button.addEventListener("click", () => { document.getElementById("worldMenu").open = false; }));

buildEnvControls();
buildManualTraits();
updateManualSpeciesCounter();
initEnvironment();
syncToolUI();
setQuality(quality);
initDarwinBook();
loadConfigStatus();
frameRequest = requestAnimationFrame(loop);
