import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from './harness.mjs';

// Pixel fixtures reproduce the original pale-body loss and exercise borders,
// isolated interior colors, existing alpha, enclosed background and edge mattes.
function fixture({size=48,bg=[255,0,255,255],body=[0,125,230,255],rect=[12,16,36,32]}={}) {
  const data=new Uint8ClampedArray(size*size*4);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    data.set(x>=rect[0]&&x<rect[2]&&y>=rect[1]&&y<rect[3]?body:bg,(y*size+x)*4);
  }
  return {data,width:size,height:size};
}
function cut(input,options={}) {
  const game=createGame();
  game.context.pixelFixture=input;
  game.context.cutoutOptions=options;
  return game.run('SpriteTools.cutout(pixelFixture.data,pixelFixture.width,pixelFixture.height,cutoutOptions)');
}
const pixel=(result,x,y)=>[...result.data.slice((y*result.width+x)*4,(y*result.width+x)*4+4)];

test('cutting a white background preserves a pale grey opaque creature',()=>{
  const result=cut(fixture({bg:[255,255,255,255],body:[205,205,205,255]}));
  assert.equal(pixel(result,24,24)[3],255);
  assert.equal(pixel(result,0,0)[3],0);
});
test('magenta key preserves blue bodies and interior white details',()=>{
  const input=fixture();
  input.data.set([255,255,255,255],(24*48+24)*4);
  const result=cut(input);
  assert.deepEqual(pixel(result,24,24),[255,255,255,255]);
  assert.deepEqual(pixel(result,25,24),[0,125,230,255]);
  assert.equal(pixel(result,0,0)[3],0);
  assert.equal(result.bounds.width,24);
  assert.equal(result.bounds.height,16);
});
test('old blue-key sprites preserve magenta body colors',()=>{
  const result=cut(fixture({bg:[0,71,255,255],body:[220,15,180,255]}));
  assert.equal(pixel(result,24,24)[3],255);
  assert.equal(pixel(result,0,0)[3],0);
});
test('native transparency preserves black bodies and partial-alpha fins',()=>{
  const input=fixture({bg:[0,0,0,0],body:[0,0,0,255]});
  input.data.set([30,90,120,120],(24*48+11)*4);
  const result=cut(input);
  assert.deepEqual(pixel(result,11,24),[30,90,120,120]);
  assert.equal(pixel(result,24,24)[3],255);
});
test('background-colored enclosed body spots are not punched out',()=>{
  const input=fixture();
  input.data.set([255,0,255,255],(24*48+24)*4);
  assert.equal(pixel(cut(input),24,24)[3],255);
});
test('empty and non-uniform scenery images fail instead of displaying a rectangle',()=>{
  assert.throws(()=>cut(fixture({body:[255,0,255,255]})),/vacía|silueta/i);
  const input=fixture();
  for(let y=0;y<48;y++) for(let x=0;x<48;x++) input.data.set([x*5,y*5,(x+y)*2,255],(y*48+x)*4);
  assert.throws(()=>cut(input),/fondo/i);
});
test('edge unmatting removes a magenta halo and preserves opaque interior',()=>{
  const input=fixture({body:[0,100,200,255]});
  // A 50% antialiased foreground pixel over magenta beside the solid body.
  input.data.set([128,50,228,255],(24*48+11)*4);
  const result=cut(input), edge=pixel(result,11,24);
  assert.ok(edge[3]>90&&edge[3]<170,JSON.stringify(edge));
  assert.ok(edge[0]<15&&edge[1]>85&&edge[2]<215,JSON.stringify(edge));
  assert.deepEqual(pixel(result,12,24),[0,100,200,255]);
});
test('a small detached background speck does not shrink the creature framing',()=>{
  const input=fixture();
  input.data.set([0,125,230,255],(3*48+3)*4);
  const result=cut(input);
  assert.equal(pixel(result,3,3)[3],0);
  assert.equal(result.bounds.x,12);
});

test('animal cutouts remove large contrasting scenery joined by a narrow stem',()=>{
  const input=fixture({rect:[8,8,40,25]});
  for(let y=29;y<44;y++) for(let x=15;x<33;x++) input.data.set([65,55,25,255],(y*48+x)*4);
  for(let y=25;y<29;y++) input.data.set([65,55,25,255],(y*48+24)*4);
  const result=cut(input,{singleAnimal:true});
  assert.equal(pixel(result,24,36)[3],0);
  assert.deepEqual(pixel(result,24,16),[0,125,230,255]);
  assert.ok(result.bounds.y+result.bounds.height<29);
  // Anchored colonies can legitimately have large leaves on fine stems.
  assert.equal(pixel(cut(input),24,36)[3],255);
});

test('animal isolation preserves sturdy contrasting fins and same-colored tail lobes',()=>{
  const input=fixture();
  for(let y=8;y<18;y++) for(let x=19;x<29;x++) input.data.set([255,140,10,255],(y*48+x)*4);
  for(let y=19;y<29;y++) for(let x=2;x<11;x++) input.data.set([0,125,230,255],(y*48+x)*4);
  input.data.set([0,125,230,255],(24*48+11)*4);
  const result=cut(input,{singleAnimal:true});
  assert.deepEqual(pixel(result,24,9),[255,140,10,255]);
  assert.deepEqual(pixel(result,5,24),[0,125,230,255]);
});

test('animal isolation scales to the 512 px working image and removes an eight-pixel scenery bridge',()=>{
  const input=fixture({size:512,rect:[45,100,465,280]});
  for(let y=300;y<450;y++) for(let x=100;x<350;x++) input.data.set([65,55,25,255],(y*512+x)*4);
  for(let y=280;y<300;y++) for(let x=200;x<208;x++) input.data.set([65,55,25,255],(y*512+x)*4);
  const result=cut(input,{singleAnimal:true});
  assert.equal(pixel(result,220,400)[3],0);
  assert.equal(pixel(result,250,200)[3],255);
  assert.ok(result.bounds.y+result.bounds.height<300);
});

test('framing removes excess margin without stretching a long fish',()=>{
  const game=createGame();
  const fit=game.run('SpriteTools.fit({width:120,height:30},192)');
  assert.equal(fit.width/fit.height,4);
  assert.ok(fit.width<192&&fit.width>160);
  assert.equal(fit.x,(192-fit.width)/2);
  assert.equal(fit.y,(192-fit.height)/2);
});

test('a single generated image creates the portrait and sprite locally',async()=>{
  const calls=[];
  const game=createGame({fetch:async(url,options)=>{
    calls.push({url,body:options?.body?JSON.parse(options.body):null});
    return {ok:true,json:async()=>url==='/api/config-status'?{canUseAiImages:true,canUseAiText:true}:{image:'mock-generated-image'}};
  }});
  game.run('prepareSpeciesArtwork=async url=>{if(url!=="mock-generated-image") throw Error("wrong source");return {spriteUrl:"data:image/png;base64,c3ByaXRl",portraitUrl:"data:image/png;base64,cG9ydHJhaXQ="};};');
  game.run('state.species=[normalizeSpecies({name:"Azul",class:"herbivore",traits:{}})]');
  await game.run('addSpeciesArtwork(state.species[0],document.getElementById("setupStatus"))');
  const requests=calls.filter(c=>c.url==='/api/generate-images');
  assert.equal(requests.length,1);
  assert.deepEqual(Object.keys(requests[0].body),['prompt']);
  assert.equal(game.run('state.species[0].artworkVersion'),1);
  assert.match(game.run('state.species[0].portraitUrl'),/^data:image\/png/);
});

test('a bad cutout does not regenerate or leave a partial portrait/sprite pair',async()=>{
  const calls=[];
  const game=createGame({fetch:async url=>{calls.push(url);return {ok:true,json:async()=>url==='/api/config-status'?{}:{image:'bad-image'}};}});
  game.run('prepareSpeciesArtwork=async()=>{throw Error("invalid cutout")}; state.species=[normalizeSpecies({name:"Pez",class:"herbivore",traits:{}})]');
  await assert.rejects(game.run('addSpeciesArtwork(state.species[0],document.getElementById("setupStatus"))'),/invalid cutout/);
  assert.equal(calls.filter(url=>url==='/api/generate-images').length,1);
  assert.equal(game.run('state.species[0].spriteUrl'), '');
  assert.equal(game.run('state.species[0].portraitUrl'), '');
});

test('descendants share one sprite cache entry and saves retain prepared images',()=>{
  const game=createGame();
  game.run(`seedWorld([normalizeSpecies({name:'Pez',class:'herbivore',traits:{},artworkVersion:1,
    spriteUrl:'data:image/png;base64,c3ByaXRl',portraitUrl:'data:image/png;base64,cG9ydHJhaXQ='})]);
    state.selected=state.creatures[0];
    state.species.push(normalizeSpecies({...state.species[0],id:'descendant'}));`);
  assert.equal(game.run('getSprite(state.species[0])===getSprite(state.species[1])'),true);
  assert.equal(game.run('spriteCache.size'),1);
  game.run('saveWorld();state.species=[];loadWorld()');
  assert.equal(game.run('state.species[0].artworkVersion'),1);
  assert.equal(game.run('state.species[1].artworkVersion'),1);
  assert.equal(game.run('state.species[0].spriteUrl===state.species[1].spriteUrl'),true);
  assert.equal(game.run('state.creatures.includes(state.selected)'),true);
});
