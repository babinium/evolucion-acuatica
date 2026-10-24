// Lineage bookkeeping and one-at-a-time identity work, outside the simulation step.
const LINEAGE_VERSION = 1;
let evolutionWork = null;
let evolutionEpoch = 0;

function lineageFields(raw, id) {
  const depth = Math.max(0, Math.min(2, Math.round(Number(raw.variationDepth) || 0)));
  return {lineageVersion: LINEAGE_VERSION, identityId: depth ? (raw.identityId || id) : id,
    variationDepth: depth, variationOrdinal: Math.max(1, Math.round(Number(raw.variationOrdinal) || 1)),
    lineageName: String(raw.lineageName || raw.name || "Especie").slice(0,70),
    evolutionSource: raw.evolutionSource || null,
    evolutionTextStatus: raw.evolutionTextStatus || "none", evolutionImageStatus: raw.evolutionImageStatus || "none",
    evolutionError: String(raw.evolutionError || "").slice(0,800)};
}

function variationName(sp) {
  let number = sp.variationOrdinal, suffix = "";
  while (number > 0) { number--; suffix = String.fromCharCode(97 + number % 26) + suffix; number = Math.floor(number / 26); }
  return `${sp.lineageName} var. ${sp.variationDepth}${sp.variationOrdinal === 1 ? "" : suffix}`;
}

function localEvolutionIdentity(sp, genes, serial) {
  const names = {producer:["Fitonácar","Fronda ámbar","Talofaro"],herbivore:["Nácar alado","Branquialuna","Aletacobre"],carnivore:["Lanza de ónice","Mandíbula ámbar","Fauce coral"]};
  const base = `${names[sp.class][serial % 3]} ${serial}`;
  let name=base, suffix=2;
  while (state.species.some(other=>other.name===name)) name=`${base} (${suffix++})`;
  const changes = traitKeys.filter(k=>traitMax(k,sp.class)>0).sort((a,b)=>
    Math.abs(genes[b]-sp.traits[b])/traitMax(b,sp.class)-Math.abs(genes[a]-sp.traits[a])/traitMax(a,sp.class)).slice(0,3);
  return {name,description:`Especie descendiente de ${sp.lineageName || sp.name}. Cambios heredados en ${changes.map(k=>traitLabels[k].toLowerCase()).join(", ")}.`,
    visualDescription: `${sp.class === "producer" ? "A distinct compact aquatic plant colony" : "A distinct aquatic animal with a different silhouette and sturdy fins"}. Descendant of ${sp.visualDescription.slice(0,150)}.`};
}

function retireExtinctVariation() {
  const index = state.species.findIndex(sp=>sp.extinct && sp.variationDepth>0
    && !state.creatures.some(c=>c.speciesId===sp.id && c.health>0));
  if (index < 0) return false;
  const [sp] = state.species.splice(index,1);
  speciesById.delete(sp.id);
  for (const key of proceduralSprites.keys()) if (key===sp.id || key.startsWith(sp.id+":")) proceduralSprites.delete(key);
  if (sp.spriteUrl && !state.species.some(other=>other.spriteUrl===sp.spriteUrl)) spriteCache.delete(sp.spriteUrl);
  return true;
}

function migrateLineages() {
  const byId = new Map(state.species.map(sp=>[sp.id,sp]));
  const visiting = new Set();
  function visit(sp) {
    if (sp.lineageVersion===LINEAGE_VERSION) return;
    if (visiting.has(sp.id)) { sp.parentId=null; }
    visiting.add(sp.id);
    const parent = byId.get(sp.parentId);
    if (parent && !visiting.has(parent.id)) visit(parent);
    const depth = parent && parent.lineageVersion===LINEAGE_VERSION ? Math.min(2,parent.variationDepth+1) : 0;
    Object.assign(sp,lineageFields({name:sp.name,variationDepth:depth,identityId:parent?.identityId,
      lineageName:parent?.lineageName || sp.name.split(" var.")[0]},sp.id));
    // Existing branches keep their art; loading an old world never buys identities.
    visiting.delete(sp.id);
  }
  for (const sp of state.species) visit(sp);
  for (const sp of state.species) {
    if (sp.evolutionTextStatus==="generating" || sp.evolutionImageStatus==="generating") {
      sp.evolutionError="La preparación se interrumpió. Se conserva un dibujo local y no se reenvía la solicitud.";
      if (sp.evolutionTextStatus==="generating") sp.evolutionTextStatus="failed";
      if (sp.evolutionImageStatus==="generating" || sp.evolutionImageStatus==="pending") sp.evolutionImageStatus="failed";
    }
  }
}

function resetEvolutionWork() { evolutionEpoch++; }

function refreshEvolutionUI() {
  selectionKey=null; speciesListSignature="";
  updateSelection(); updateSpeciesList(); syncEvolutionControls(); invalidate();
}

function identityMembers(root) { return state.species.filter(sp=>sp.identityId===root.id); }

function livingIdentities() { return new Set(state.species.filter(sp=>!sp.extinct).map(sp=>sp.identityId)); }

function applyEvolutionIdentity(root, identity) {
  let name=String(identity.name).trim().slice(0,70);
  if (state.species.some(sp=>sp.id!==root.id && sp.variationDepth===0 && sp.name===name)) name=`${name.slice(0,58)} ${root.id.slice(-6)}`;
  for (const sp of identityMembers(root)) {
    sp.lineageName=name;
    sp.name=sp.variationDepth ? variationName(sp) : name;
    sp.description=String(identity.description).slice(0,2000);
    sp.visualDescription=String(identity.visualDescription).slice(0,2000);
    sp.spritePrompt=sp.visualDescription;
  }
  queueBookSpecies(root);
}

function shareEvolutionArtwork(root) {
  for (const sp of identityMembers(root)) if (sp!==root) Object.assign(sp,{
    portraitUrl:root.portraitUrl,spriteUrl:root.spriteUrl,artworkVersion:root.artworkVersion,artworkError:root.artworkError});
  queueBookSpecies(root);
}

function ensureLocalEvolutionArtwork(root) {
  if (root.portraitUrl) return;
  const source=getProceduralSprite(root,384);
  const width=0.78+root.traits.speed*0.018, height=0.74+root.traits.defense*0.022;
  const make=size=>{
    const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
    const w=size*Math.min(0.94,width),h=size*Math.min(0.94,height);
    canvas.getContext("2d").drawImage(source,(size-w)/2,(size-h)/2,w,h);
    return canvas.toDataURL("image/png");
  };
  root.spriteUrl=make(192);root.portraitUrl=make(384);root.artworkVersion=1;
  shareEvolutionArtwork(root);
}

function hasLivingIdentity(root) {
  return state.creatures.some(c=>getSpecies(c)?.identityId===root.id && c.health>0);
}

function evolutionSummary(sp) {
  const root=speciesById.get(sp.identityId) || sp;
  const ancestorName=sp.evolutionSource && (speciesById.get(sp.evolutionSource.identityId)?.lineageName || sp.evolutionSource.name);
  const phase=sp.variationDepth ? `Variación ${sp.variationDepth}/2 de ${sp.lineageName}`
    : sp.evolutionSource ? `Nueva especie · descendiente de ${ancestorName}` : "Especie de origen";
  const status=root.evolutionTextStatus==="generating" ? "Preparando nombre y descripción…"
    : root.evolutionImageStatus==="generating" ? "Preparando su ilustración…"
    : root.evolutionTextStatus==="pending" || root.evolutionImageStatus==="pending" ? "Identidad en espera"
    : root.evolutionError ? `Ilustración local. ${root.evolutionError}`
    : root.evolutionSource && root.evolutionImageStatus==="local" ? "Ilustración local" : "";
  return `${phase}${status ? " · "+status : ""}`;
}

function syncEvolutionControls() {
  const input=document.getElementById("evolutionAi");
  input.checked=!!state.evolutionAiEnabled;
  input.disabled=!configState.canUseAiText || !configState.canUseAiImages;
  setText("evolutionAiStatus",state.evolutionAiBlocked ? `IA detenida: ${state.evolutionAiBlocked}`
    : state.evolutionAiEnabled ? "Usa saldo solo al surgir una especie nueva; las dos variaciones reutilizan su imagen."
    : "Nuevas especies con nombres y dibujos locales, sin gasto de API.");
}

function processEvolutionQueue() {
  if (evolutionWork) return evolutionWork;
  if (!state.started || !configLoaded || document.hidden || worldStarting || creatingSpecies || state.evolutionAiBlocked || document.getElementById('darwinBook').open) return Promise.resolve();
  const root=state.species.find(sp=>sp.variationDepth===0 && sp.evolutionSource
    && (sp.evolutionTextStatus==="pending" || sp.evolutionImageStatus==="pending"));
  if (!root || !state.evolutionAiEnabled) return Promise.resolve();
  const epoch=evolutionEpoch;
  const current=()=>epoch===evolutionEpoch && state.species.includes(root);
  evolutionWork=(async()=>{
    if (!hasLivingIdentity(root)) { root.evolutionTextStatus="skipped";root.evolutionImageStatus="skipped";return; }
    try {
      if (!configState.canUseAiText || !configState.canUseAiImages) throw new Error("La IA no está disponible. Revisá la configuración del proveedor.");
      if (root.evolutionTextStatus==="pending") {
        root.evolutionTextStatus="generating";refreshEvolutionUI();state.aiCalls++;
        const ancestor=speciesById.get(root.evolutionSource.identityId) || root.evolutionSource;
        const data=await requestApi("/api/evolve-species",{requestId:root.id,class:root.class,
          ancestor:{name:ancestor.lineageName || ancestor.name,description:ancestor.description,
            visualDescription:ancestor.visualDescription,traits:ancestor.traits},traits:root.traits});
        if (!current()) return;
        if (!data.identity || ["name","description","visualDescription"].some(k=>typeof data.identity[k]!=="string" || !data.identity[k].trim())) throw new Error("La IA no devolvió una identidad válida.");
        applyEvolutionIdentity(root,data.identity);root.evolutionTextStatus="ready";refreshEvolutionUI();
      }
      if (!current() || !state.evolutionAiEnabled || document.hidden || worldStarting || creatingSpecies || document.getElementById('darwinBook').open) return;
      if (!hasLivingIdentity(root)) {root.evolutionImageStatus="skipped";return;}
      if (root.evolutionImageStatus==="pending") {
        root.evolutionImageStatus="generating";refreshEvolutionUI();
        await addSpeciesArtwork(root,{textContent:""},{background:true});
        if (!current()) return;
        root.evolutionImageStatus="ready";root.evolutionError="";shareEvolutionArtwork(root);
        state.lastEvent=`Nueva especie ilustrada: ${root.name}`;
      }
    } catch(error) {
      if (!current()) return;
      root.evolutionError=String(error.message).slice(0,800);
      if (root.evolutionTextStatus==="generating") {root.evolutionTextStatus="failed";root.evolutionImageStatus="failed";}
      if (root.evolutionImageStatus==="generating") root.evolutionImageStatus="failed";
      ensureLocalEvolutionArtwork(root);
      state.evolutionAiBlocked=root.evolutionError;
      logError(`Identidad de ${root.name}: ${root.evolutionError}`);
    } finally { if (current()) refreshEvolutionUI(); }
  })().finally(()=>{evolutionWork=null;});
  return evolutionWork;
}

function packArtwork(snapshot) {
  const assets=[], byPortrait=new Map();
  const species=snapshot.species.map(sp=>{
    if (!sp.portraitUrl && !sp.spriteUrl) return sp;
    let index=byPortrait.get(sp.portraitUrl || sp.spriteUrl);
    if (index===undefined || assets[index].spriteUrl!==sp.spriteUrl) {
      index=assets.length;byPortrait.set(sp.portraitUrl || sp.spriteUrl,index);
      assets.push({portraitUrl:sp.portraitUrl,spriteUrl:sp.spriteUrl,artworkVersion:sp.artworkVersion});
    }
    return {...sp,portraitUrl:"",spriteUrl:"",artworkRef:index};
  });
  return {...snapshot,species,artworkAssets:assets};
}

function unpackArtwork(saved) {
  if (!saved || !Array.isArray(saved.artworkAssets)) return;
  for (const sp of saved.species || []) if (Number.isInteger(sp.artworkRef)) {
    const asset=saved.artworkAssets[sp.artworkRef];
    if (!asset || typeof asset.portraitUrl!=="string" || typeof asset.spriteUrl!=="string") throw new Error("La partida contiene una ilustración incompleta.");
    Object.assign(sp,asset);delete sp.artworkRef;
  }
  delete saved.artworkAssets;
}
