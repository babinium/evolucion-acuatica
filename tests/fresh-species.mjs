function freshSpecies(seed,counts=[2,2,2]) {
  let value=seed>>>0;
  const random=()=>((value=(Math.imul(value,1664525)+1013904223)>>>0)/4294967296);
  return ['producer','herbivore','carnivore'].flatMap((type,index)=>Array.from({length:counts[index]},(_,i)=>({
    name:`Nueva ${seed}-${type}-${i}`,class:type,description:'Una especie nueva e independiente.',
    visualDescription:`Unique aquatic ${type}, variation ${seed}-${i}.`,
    traits:Object.fromEntries(['size','speed','attack','defense','perception','fertility','metabolism','foodEfficiency','toxicity']
      .map(key=>[key,Math.round(random()*(key==='fertility'?30:10)*100)/100]))
  })));
}

export {freshSpecies};
