const toolDefs = {
  nutrientBloom: { name: "Floración", radius: 190, color: "#8ad9a6", icon: "i-leaf", shortcut: "1", tip: "Crea algas para los herbívoros. El tamaño del área determina cuántas aparecen." },
  protect: { name: "Proteger", radius: 220, color: "#91c4ed", icon: "i-shield", shortcut: "2", duration: 80, tip: "Refugio por 80 s de simulación: bloquea ataques, catástrofes y daño ambiental, y regenera salud. El hambre y la edad continúan." },
  disaster: { name: "Catástrofe", radius: 230, color: "#f09e88", icon: "i-bolt", shortcut: "3", tip: "Quita 60 de salud a cada habitante del área. Los individuos protegidos resisten el daño." },
  favor: { name: "Favorecer", radius: 150, color: "#d6b5ed", icon: "i-plus", shortcut: "4", tip: "Introduce nuevos individuos de la especie que elijas. No necesita mantener un individuo seleccionado." },
  feed: { name: "Alimentar", radius: 190, color: "#e8cb8b", icon: "i-food", shortcut: "5", tip: "Da hasta 45 de energía a los animales del área. Sirve para herbívoros y carnívoros; no afecta a las plantas." },
  cleanse: { name: "Limpiar agua", radius: 240, color: "#8ddcdb", icon: "i-drop", shortcut: "6", duration: 60, tip: "Agua limpia por 60 s de simulación: oxígeno mínimo 60 y toxicidad máxima 20 dentro del área." }
};
const toolRadii = Object.fromEntries(Object.entries(toolDefs).map(([id, def]) => [id, def.radius]));
const MAX_ACTIVE_ZONES = 12;
const MAX_TOOL_MARKERS = 12;
let toolRepeat = true;
let favorSpeciesId = null;
let favorOptionsSignature = null;
let pointerOverWorld = false;

function powerCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pointInArea(point, x, y, radius) {
  return (point.x - x) ** 2 + (point.y - y) ** 2 <= radius * radius;
}

function insideWorld(x, y) {
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= state.worldSize && y <= state.worldSize;
}

function inEffectZone(point, type) {
  if (!state.zones.length) return false;
  return state.zones.some(z => z.type === type && z.ttl > 0 && pointInArea(point, z.x, z.y, z.radius));
}

function isProtected(creature) {
  return creature.protected > 0 || (state.zones.length > 0 && inEffectZone(creature, "protect"));
}

function damageCreature(creature, amount) {
  if (creature.health <= 0 || isProtected(creature)) return 0;
  const damage = Math.min(creature.health, Math.max(0, amount));
  creature.health -= damage;
  return damage;
}

function localWater(point) { return waterAt(point); }

function addPowerZone(type, x, y, radius) {
  const duration = toolDefs[type]?.duration;
  if (!duration) return false;
  const existing = state.zones.find(z => z.type === type && pointInArea(z, x, y, Math.min(radius, z.radius) * 0.3));
  if (existing) { Object.assign(existing, { x, y, radius, ttl: duration, duration }); return true; }
  const active = state.zones.filter(z => toolDefs[z.type]?.duration && z.ttl > 0);
  if (active.length >= MAX_ACTIVE_ZONES) return false;
  state.zones.push({ type, x, y, radius, ttl: duration, duration });
  return true;
}

function addPowerMarker(type, x, y, radius) {
  const markers = state.zones.filter(z => !toolDefs[z.type]?.duration);
  if (markers.length >= MAX_TOOL_MARKERS) state.zones.splice(state.zones.indexOf(markers[0]), 1);
  state.zones.push({ type, x, y, radius, ttl: 2, duration: 2 });
}

function samplePowerPoint(x, y, radius, margin = 0) {
  // Sample the actual intersection with the world rather than piling up clamped points at its edge.
  for (let attempt = 0; attempt < 48; attempt++) {
    const angle = rand(0, Math.PI * 2);
    const d = Math.sqrt(Math.random()) * radius;
    const px = x + Math.cos(angle) * d, py = y + Math.sin(angle) * d;
    if (px >= margin && py >= margin && px <= state.worldSize - margin && py <= state.worldSize - margin) return {x: px, y: py};
  }
  // Reachable even for the smallest allowed brush placed on a corner.
  return {x: clamp(x, margin, state.worldSize - margin), y: clamp(y, margin, state.worldSize - margin)};
}

function powerPopulation(radius, type) {
  return Math.max(type === "favor" ? 3 : 6, Math.round(radius / (type === "favor" ? 22 : 10)));
}

function syncFavorOptions() {
  const options = document.getElementById("favorSpecies");
  // Periodic UI refreshes must not reset a native popup or its pending choice.
  // Live species changes are reconciled when focus leaves the selector.
  if (document.activeElement === options) return;
  const species = state.species.filter(sp => sp.population > 0 && !sp.extinct);
  if (!species.some(sp => sp.id === favorSpeciesId)) {
    favorSpeciesId = species.find(sp => sp.id === state.selected?.speciesId)?.id || species[0]?.id || null;
  }
  const signature = species.map(sp => `${sp.id}:${sp.name}`).join("|");
  if (signature !== favorOptionsSignature) {
    options.innerHTML = species.length
      ? species.map(sp => `<option value="${escapeHtml(sp.id)}">${escapeHtml(sp.name)}</option>`).join("")
      : '<option value="">No hay especies vivas</option>';
    favorOptionsSignature = signature;
  }
  const value = favorSpeciesId || "";
  if (options.value !== value) options.value = value;
  const disabled = species.length === 0;
  if (options.disabled !== disabled) options.disabled = disabled;
}

function setToolRadius(value) {
  if (!state.activeTool) return;
  const radius = Number(value);
  if (!Number.isFinite(radius)) return;
  state.toolRadius = clamp(Math.round(radius / 10) * 10, 60, 650);
  toolRadii[state.activeTool] = state.toolRadius;
  document.getElementById("toolRadius").value = state.toolRadius;
  setText("toolRadiusValue", state.toolRadius);
  document.querySelectorAll("[data-radius]").forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.radius) === state.toolRadius)));
  updateToolPreviewStatus(); invalidate();
}

function syncToolUI(message) {
  const def = toolDefs[state.activeTool];
  document.querySelectorAll("[data-tool]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.tool === state.activeTool)));
  document.getElementById("toolControls").classList.toggle("hidden", !def);
  document.getElementById("powerDock").classList.toggle("hidden", !def);
  document.getElementById("app").classList.toggle("tool-active", Boolean(def));
  canvas.classList.toggle("targeting", Boolean(def));
  if (def) {
    document.getElementById("toolControls").style.setProperty("--tool-color", def.color);
    document.getElementById("powerDock").style.setProperty("--tool-color", def.color);
    setText("toolName", def.name);
    setText("dockToolName", def.name);
    setText("toolDescription", def.tip);
    document.getElementById("favorOptions").classList.toggle("hidden", state.activeTool !== "favor");
    document.getElementById("toolRepeat").checked = toolRepeat;
    if (state.activeTool === "favor") syncFavorOptions();
    setToolRadius(state.toolRadius);
  }
  setText("toolHint", message || (def
    ? "Clic para aplicar · Rueda: área · Mayús + rueda: zoom."
    : "Elegí un poder o usá las teclas 1–6. Podés intervenir también en pausa."));
  updateToolPreviewStatus(); invalidate();
}

function selectTool(id) {
  if (!state.started || !toolDefs[id]) return;
  if (state.activeTool === id) { cancelTool(); return; }
  state.activeTool = id;
  state.toolRadius = toolRadii[id];
  if (id === "favor" && state.selected && getSpecies(state.selected)?.population > 0) favorSpeciesId = state.selected.speciesId;
  syncToolUI();
  if (innerWidth < 901) togglePanel("ecosystemPanel", "toggleSpecies", false);
  document.getElementById("toolControls").scrollIntoView?.({block: "nearest"});
}

function cancelTool(message = "Poder desactivado. Clic para seleccionar; arrastrá para explorar.") {
  state.activeTool = null;
  syncToolUI(message);
}

function powerTargets(x, y, radius) {
  return [...creatureGrid.query(x, y, radius)].filter(c => c.health > 0 && c.energy > -35);
}

function updateToolPreviewStatus() {
  if (!state.activeTool) return;
  const p = screenToWorld(state.mouse.x, state.mouse.y);
  if (!pointerOverWorld) { setText("toolTargets", "Mové el cursor al agua para ver el alcance."); return; }
  if (!insideWorld(p.x, p.y)) { setText("toolTargets", "Fuera del mundo: acercá el cursor al agua."); return; }
  const id = state.activeTool;
  let text;
  if (id === "nutrientBloom" || id === "favor") {
    if (id === "favor" && !speciesById.get(favorSpeciesId)?.population) {
      setText("toolTargets", "Elegí una especie viva en el panel."); return;
    }
    const available = id === "favor" ? MAX_CREATURES - state.creatures.length : MAX_RESOURCES - state.resources.length;
    const count = Math.min(Math.max(0, available), powerPopulation(state.toolRadius, id));
    text = id === "favor" ? powerCount(count, "nuevo individuo", "nuevos individuos") : powerCount(count, "nueva alga", "nuevas algas");
  } else {
    const targets = powerTargets(p.x, p.y, state.toolRadius);
    const count = id === "feed" ? targets.filter(c => getSpecies(c)?.class !== "producer" && c.energy < c.maxEnergy).length
      : id === "disaster" ? targets.filter(c => !isProtected(c)).length : targets.length;
    text = id === "feed" ? powerCount(count, "animal por alimentar", "animales por alimentar")
      : id === "disaster" ? powerCount(count, "individuo vulnerable", "individuos vulnerables")
      : powerCount(count, "habitante en el área", "habitantes en el área");
  }
  setText("toolTargets", `${text} · radio ${state.toolRadius}`);
}

function reportPowerResult(result) {
  state.lastEvent = result.message;
  if (result.ok && !toolRepeat) state.activeTool = null;
  syncToolUI(result.message);
  if (result.ok && state.activeTool && innerWidth < 621) togglePanel("environmentPanel", "toggleEnvironment", false);
  rebuildSpatialIndexes(); recalcSpecies(); updateSpeciesList(); updateSelection(); updateHud();
  return result;
}

function applyTool(x, y) {
  const id = state.activeTool;
  if (!state.started || !toolDefs[id]) return {ok: false, affected: 0, message: "Elegí un poder para intervenir."};
  if (!insideWorld(x, y)) return reportPowerResult({ok: false, affected: 0, message: "Ese punto está fuera del mundo. Aplicá el poder sobre el agua."});
  const radius = state.toolRadius;
  rebuildSpatialIndexes();
  const targets = powerTargets(x, y, radius);
  let affected = 0;
  let message;
  if (id === "nutrientBloom" || id === "favor") {
    const desired = powerPopulation(radius, id);
    const count = Math.min(desired, Math.max(0, id === "favor" ? MAX_CREATURES - state.creatures.length : MAX_RESOURCES - state.resources.length));
    if (!count) return reportPowerResult({ok: false, affected: 0, message: id === "favor" ? "Límite de población alcanzado. Esperá a que haya espacio." : "Límite de algas alcanzado. Esperá a que se consuman."});
    if (id === "favor") {
      syncFavorOptions();
      const sp = speciesById.get(favorSpeciesId);
      if (!sp || sp.population <= 0) return reportPowerResult({ok: false, affected: 0, message: "No hay una especie viva para favorecer. Creá una especie primero."});
      for (let i = 0; i < count; i++) {
        const p = samplePowerPoint(x, y, radius, 8);
        spawnCreature(sp, p.x, p.y, sp.generation);
      }
      message = `Favorecer: ${powerCount(count, "nuevo individuo", "nuevos individuos")} de ${sp.name}${count < desired ? " (límite de población)" : ""}.`;
    } else {
      for (let i = 0; i < count; i++) {
        const p = samplePowerPoint(x, y, radius);
        spawnResource(p.x, p.y, rand(45, 120));
      }
      message = `Floración: ${powerCount(count, "alga creada", "algas creadas")}${count < desired ? " (límite de algas)" : ""}.`;
    }
    affected = count;
    addPowerMarker(id, x, y, radius);
  } else if (id === "protect" || id === "cleanse") {
    if (!addPowerZone(id, x, y, radius)) return reportPowerResult({ok: false, affected: 0, message: `Ya hay ${MAX_ACTIVE_ZONES} zonas activas. Esperá a que una termine o renová una existente.`});
    affected = targets.length;
    message = id === "protect" ? `Refugio activo: ${powerCount(affected, "habitante protegido", "habitantes protegidos")} · 80 s de simulación.`
      : `Agua limpia: ${powerCount(affected, "habitante en el área", "habitantes en el área")} · 60 s de simulación.`;
  } else if (id === "feed") {
    for (const c of targets) {
      if (getSpecies(c)?.class === "producer" || c.energy >= c.maxEnergy) continue;
      c.energy = Math.min(c.maxEnergy, c.energy + 45);
      affected++;
    }
    message = affected ? `Alimento entregado a ${powerCount(affected, "animal", "animales")} (+45 como máximo, hasta llenar sus reservas).`
      : "Los animales del área ya tienen sus reservas llenas, o no hay animales. Las plantas necesitan luz y nutrientes.";
    if (affected) addPowerMarker(id, x, y, radius);
  } else if (id === "disaster") {
    for (const c of targets) if (damageCreature(c, 60) > 0) affected++;
    const deaths = removeDeadCreatures();
    const protectedCount = targets.filter(c => isProtected(c)).length;
    message = affected ? `Catástrofe: ${powerCount(affected, "afectado", "afectados")}, ${powerCount(deaths, "baja", "bajas")}${protectedCount ? `; ${powerCount(protectedCount, "protegido resistió", "protegidos resistieron")}` : ""}.`
      : protectedCount ? `El escudo resistió: ${powerCount(protectedCount, "habitante protegido", "habitantes protegidos")}. Sin daño.` : "No hay habitantes en esa área. Probá en otra zona.";
    if (affected) addPowerMarker(id, x, y, radius);
  }
  return reportPowerResult({ok: affected > 0 || id === "protect" || id === "cleanse", affected, message});
}
