// Creation-time constraints only. Evolution and the manual editor keep the full
// genetic range. Identity/artwork come from the provider; feasibility is local.
const founderBounds = {
  producer: {size:[2,7],speed:[0,0],attack:[0,0],defense:[1,7],perception:[3,8],fertility:[16,26],metabolism:[1,4],foodEfficiency:[6,9],toxicity:[0,4]},
  herbivore: {size:[2,7],speed:[4,8],attack:[0,0],defense:[0,7],perception:[4,8],fertility:[10,18],metabolism:[2,4],foodEfficiency:[6,9],toxicity:[0,3]},
  carnivore: {size:[3,8],speed:[7,10],attack:[3,8],defense:[0,6],perception:[4,8],fertility:[6,12],metabolism:[4,6],foodEfficiency:[6,8],toxicity:[0,3]}
};

function initialSpeciesFitness(sp) {
  const body=phenotype(sp.traits,sp.class);
  const upkeep=body.basal*(0.45+48*0.013);
  if (sp.class==='producer') {
    // Budget for depleted (35%) water, not a permanently full nutrient tank.
    const income=body.photosynthesis*(1-((48-50)/55)**2)*0.88*(24.5/(24.5+25));
    const lifetime=(body.lifespan-body.maturity)/body.agingRate;
    const margin=income-upkeep-body.birthCost*3/lifetime;
    return {valid:margin>=0.15,upkeep,income,margin};
  }
  const budget=sp.class==='herbivore'?0.9:1.1;
  return {valid:upkeep<=budget+1e-8,upkeep,margin:budget-upkeep};
}

function fitFounderBudget(sp) {
  const bounds=founderBounds[sp.class];
  // Greedy half-point adjustments preserve most of the original variety. This
  // is a bounded algebraic pass, never a simulation or another provider call.
  for(let step=0;step<96 && !initialSpeciesFitness(sp).valid;step++) {
    const current=initialSpeciesFitness(sp).margin;
    let best=null,score=current;
    for(const key of ['defense','toxicity','perception','fertility','foodEfficiency','metabolism','attack']) {
      for(const delta of [-0.5,0.5]) {
        const value=clamp(sp.traits[key]+delta,...bounds[key]);
        if(value===sp.traits[key])continue;
        const traits={...sp.traits,[key]:value};
        const next=initialSpeciesFitness({...sp,traits}).margin;
        if(next>score+1e-9){best={key,value};score=next;}
      }
    }
    if(!best)break;
    sp.traits[best.key]=best.value;
  }
  return sp;
}

function balanceInitialSpecies(rawList) {
  const species=rawList.map(raw=>{
    const sp=normalizeSpecies(raw),bounds=founderBounds[sp.class];
    for(const key of traitKeys)sp.traits[key]=clamp(sp.traits[key],...bounds[key]);
    return fitFounderBudget(sp);
  });
  const grazers=species.filter(sp=>sp.class==='herbivore');
  const escape=grazers.length?Math.min(...grazers.map(sp=>phenotype(sp.traits,sp.class).speed*1.45)):0;
  for(const hunter of species.filter(sp=>sp.class==='carnivore')) {
    // At least one prey can be caught in an open chase. Shelter, injuries,
    // standing variation and later mutations still change the actual outcome.
    for(let i=0;i<40 && phenotype(hunter.traits,hunter.class).speed*1.2<escape*1.04;i++) {
      if(hunter.traits.speed<10)hunter.traits.speed=Math.min(10,hunter.traits.speed+0.5);
      else if(hunter.traits.defense>0)hunter.traits.defense=Math.max(0,hunter.traits.defense-0.5);
      else if(hunter.traits.metabolism<6)hunter.traits.metabolism=Math.min(6,hunter.traits.metabolism+0.5);
      else break;
    }
    // Preserve chase speed while paying for it from armor/other costly traits.
    const metabolism=hunter.traits.metabolism;
    fitFounderBudget(hunter);
    if(hunter.traits.metabolism<metabolism) {
      hunter.traits.metabolism=metabolism;
      for(const key of ['defense','toxicity','perception','attack','fertility']) {
        while(!initialSpeciesFitness(hunter).valid && hunter.traits[key]>founderBounds.carnivore[key][0])
          hunter.traits[key]=Math.max(founderBounds.carnivore[key][0],hunter.traits[key]-0.5);
      }
    }
  }
  return species;
}

function balancedFounderGenes(sp) {
  const traits=initialGenes(sp),bounds=founderBounds[sp.class];
  for(const key of traitKeys)traits[key]=clamp(traits[key],...bounds[key]);
  return fitFounderBudget({...sp,traits}).traits;
}
