import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {config,evolveSpecies,generationCache} from '../server.js';

const traits={size:5.127,speed:5,attack:0,defense:4,perception:6,fertility:12,metabolism:4,foodEfficiency:6,toxicity:0};
const body={requestId:'new-species-1',class:'herbivore',ancestor:{name:'Ancestro',description:'Especie de origen.',visualDescription:'Compact blue grazer.',traits},traits:{...traits,size:7}};
const identity={name:'Aleta de jade',description:'Herbívoro acorazado descendiente del ancestro.',visualDescription:'Jade aquatic grazer with broad sturdy fins.'};
async function provider(response,run,{status=200,google=false}={}) {
  const original={...config},fetch=globalThis.fetch,directory=generationCache.directory;
  const temporary=await mkdtemp(join(tmpdir(),'evo-identity-'));
  for(const key of Object.keys(config)) delete config[key];
  Object.assign(config,google?{geminiApiKey:'test-identity-key'}:{aiProvider:'openrouter',openrouterApiKey:'test-identity-key'});
  generationCache.directory=temporary;
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,...options,payload:JSON.parse(options.body)});
    return {ok:status<400,status,json:async()=>response};};
  try {await run(calls);} finally {
    globalThis.fetch=fetch;generationCache.directory=directory;
    for(const key of Object.keys(config)) delete config[key];Object.assign(config,original);
    await rm(temporary,{recursive:true,force:true});
  }
}
const answer=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});

test('evolved identity uses bounded strict text only and is shared by concurrent requests, restart and Python',async()=>{
  await provider(answer(identity),async calls=>{
    const identities=await Promise.all([evolveSpecies(body),evolveSpecies(body)]);
    assert.deepEqual(identities[0],identity);assert.deepEqual(identities[1],identity);
    assert.deepEqual(await evolveSpecies(body),identity);assert.equal(calls.length,1);
    const {payload,url}=calls[0];assert.match(url,/chat\/completions$/);
    assert.equal(payload.max_tokens,448);assert.equal(payload.provider.allow_fallbacks,false);
    assert.deepEqual(payload.response_format.json_schema.schema.required,['name','description','visualDescription']);
    assert.equal(payload.response_format.json_schema.schema.additionalProperties,false);
    const prompt=payload.messages[0].content;
    assert.match(prompt,/'?herbivore/);assert.match(prompt,/"size":513/);assert.match(prompt,/"size":700/);
    const reused=execFileSync('python3',['-c',
      'import json,sys;import server;d=json.load(sys.stdin);server.CONFIG.clear();server.CONFIG.update(aiProvider="openrouter",openrouterApiKey="test-cache-key");server.generation_cache=server.GenerationCache(d["directory"]);server.post_json=lambda *a,**kw:sys.exit(2);print(json.dumps(server.evolve_species(d["body"])))'],
      {input:JSON.stringify({directory:generationCache.directory,body}),encoding:'utf8'});
    assert.deepEqual(JSON.parse(reused),identity);
    const files=await readdir(generationCache.directory);
    assert.equal(files.length,1);assert.equal((await readFile(join(generationCache.directory,files[0]),'utf8')).includes('test-identity-key'),false);
  });
});

test('invalid lineage is rejected before paid text or images',async()=>{
  await provider(answer(identity),async calls=>{
    for(const bad of [{...body,class:'omnivore'},{...body,requestId:''},{...body,traits:{}},{...body,ancestor:null},
      {...body,traits:{...traits,speed:Infinity}},{...body,traits:{...traits,size:31}}]) {
      await assert.rejects(evolveSpecies(bad),error=>error.status===400);
    }
    assert.equal(calls.length,0);
  });
});

test('missing identity, repeated name and invented traits fail once without requesting images',async()=>{
  for(const value of [{},{...identity,name:'Ancestro'},{...identity,traits}, {...identity,visualDescription:''}]) {
    await provider(answer(value),async calls=>{
      await assert.rejects(evolveSpecies(body),error=>error.status===422);assert.equal(calls.length,1);
    });
  }
});

test('provider failures redact the key and never retry or fall back',async()=>{
  await provider({error:{message:'bad test-identity-key'}},async calls=>{
    await assert.rejects(evolveSpecies(body),error=>error.status===402 && !error.message.includes('test-identity-key'));
    assert.equal(calls.length,1);
  },{status:402});
});

test('explicit Google provider uses its text model and the same identity validation',async()=>{
  await provider({candidates:[{content:{parts:[{text:JSON.stringify(identity)}]}}]},async calls=>{
    assert.deepEqual(await evolveSpecies(body),identity);assert.equal(calls.length,1);
    assert.match(calls[0].url,/generateContent$/);assert.equal(calls[0].payload.generationConfig.maxOutputTokens,512);
    assert.equal(calls[0].payload.generationConfig.candidateCount,1);
  },{google:true});
});
