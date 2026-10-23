import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {config,configStatus,checkProvider,generateImage,generateSpecies,generationCache,buildImagePrompt} from '../server.js';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const image={data:[{b64_json:png,media_type:'image/png'}],usage:{cost:0.0184}};
const specimen=name=>({name,description:'Especie de prueba.',visualDescription:'Compact blue aquatic body.',habitat:'Aguas medias',
  traits:{size:5,speed:5,attack:0,defense:4,perception:6,fertility:12,metabolism:4,foodEfficiency:6,toxicity:0}});
const species={choices:[{finish_reason:'stop',message:{content:JSON.stringify({species:{producer_1:specimen('Alga')}})}}]};

test('strict species slots enforce unequal, zero and maximum diet counts in one request',async()=>{
  for(const counts of [{producers:2,herbivores:1,carnivores:3},{producers:1,herbivores:1,carnivores:0},
    {producers:0,herbivores:0,carnivores:1},{producers:4,herbivores:4,carnivores:4}]) {
    const slots={};
    for(const [key,type] of [['producers','producer'],['herbivores','herbivore'],['carnivores','carnivore']])
      for(let i=1;i<=counts[key];i++) slots[`${type}_${i}`]=specimen(`${type} ${i}`);
    await provider({choices:[{finish_reason:'stop',message:{content:JSON.stringify({species:slots})}}]},async calls=>{
      const result=await generateSpecies(counts);
      assert.equal(result.length,Object.keys(slots).length);
      for(const [key,type] of [['producers','producer'],['herbivores','herbivore'],['carnivores','carnivore']])
        assert.equal(result.filter(sp=>sp.class===type).length,counts[key]);
      const format=calls[0].payload.response_format;
      assert.equal(format.type,'json_schema');
      assert.equal(format.json_schema.strict,true);
      const schema=format.json_schema.schema.properties.species;
      assert.deepEqual(schema.required,Object.keys(slots));
      assert.deepEqual(Object.keys(schema.properties),Object.keys(slots));
      assert.equal(schema.additionalProperties,false);
      assert.equal(calls.length,1);
    });
  }
});

test('image instructions distinguish a solitary animal from an anchored colony',()=>{
  const animal=buildImagePrompt('Silver fish. Species type: herbivore.');
  assert.match(animal,/Only the animal/);
  assert.match(animal,/Do not draw a lateral side profile/);
  assert.equal(animal.includes('Only the colony'),false);
  const producer=buildImagePrompt('Green algae. Species type: producer.');
  assert.match(producer,/Only the colony/);
  assert.equal(producer.includes('bilateral fins'),false);
  assert.equal(producer.includes('$BODY'),false);
});

async function provider(result,run,status=200) {
  const original={...config},fetch=globalThis.fetch,directory=generationCache.directory;
  const temporary=await mkdtemp(join(tmpdir(),'evo-openrouter-'));
  for(const key of Object.keys(config)) delete config[key];
  Object.assign(config,{aiProvider:'openrouter',openrouterApiKey:'test-openrouter-key',geminiApiKey:'test-unused-google-key'});
  generationCache.directory=temporary;
  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url,...options,payload:options.body?JSON.parse(options.body):null});
    return {ok:status<400,status,json:async()=>typeof result==='function'?result(url):result};
  };
  try {await run(calls);} finally {
    globalThis.fetch=fetch;generationCache.directory=directory;
    for(const key of Object.keys(config)) delete config[key];
    Object.assign(config,original);await rm(temporary,{recursive:true,force:true});
  }
}

test('OpenRouter selects its own key and never exposes or falls back to Google credentials',async()=>{
  await provider(image,async calls=>{
    const status=configStatus();
    assert.equal(status.provider,'openrouter');
    assert.equal(status.textModel,'openai/gpt-4.1-nano');
    assert.equal(status.imageModel,'qwen/qwen-image-2.1-turbo');
    assert.equal(status.canUseAiImages,true);
    assert.equal(JSON.stringify(status).includes('test-openrouter-key'),false);
    config.openrouterApiKey='';
    assert.equal(configStatus().canUseAiText,false);
    await assert.rejects(generateImage('fish'),/openrouterApiKey/);
    assert.equal(calls.length,0);
    config.aiProvider='unknown';
    await assert.rejects(generateSpecies({producers:1}),/aiProvider/);
    assert.equal(calls.length,0);
  });
});

test('the dedicated image API requests one image and reuses it across calls and backends',async()=>{
  await provider(image,async calls=>{
    const results=await Promise.all([generateImage('blue fish'),generateImage('blue fish')]);
    assert.equal(results[0],`data:image/png;base64,${png}`);
    assert.equal(await generateImage('blue fish'),results[0]);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://openrouter.ai/api/v1/images');
    assert.equal(calls[0].headers.Authorization,'Bearer test-openrouter-key');
    assert.equal(calls[0].headers['x-goog-api-key'],undefined);
    assert.equal(calls[0].payload.n,1);
    assert.equal(calls[0].payload.resolution,'1K');
    assert.equal(calls[0].payload.provider.allow_fallbacks,false);
    assert.match(calls[0].payload.prompt,/#ff00ff/);
    assert.match(calls[0].payload.prompt,/TOP-DOWN/);
    const files=await readdir(generationCache.directory);
    const record=await readFile(join(generationCache.directory,files[0]),'utf8');
    assert.equal(record.includes('test-openrouter-key'),false);
    assert.equal(JSON.parse(record).usage.cost,0.0184);
    const reused=execFileSync('python3',['-c',
      'import json,sys;import server;d=json.load(sys.stdin);server.CONFIG.clear();server.CONFIG.update(aiProvider="openrouter",openrouterApiKey="test-cache-key");server.generation_cache=server.GenerationCache(d["directory"]);server.post_json=lambda *a,**kw:sys.exit(2);print(server.generate_image("blue fish"))'],
      {input:JSON.stringify({directory:generationCache.directory}),encoding:'utf8'});
    assert.equal(reused.trim(),results[0]);
  });
});

test('text generation is bounded JSON, cached by default and refreshed only explicitly',async()=>{
  await provider(species,async calls=>{
    const body={producers:1};
    assert.equal((await generateSpecies(body))[0].name,'Alga');
    await generateSpecies(body);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(calls[0].payload.max_tokens,576);
    assert.equal(calls[0].payload.response_format.type,'json_schema');
    assert.equal(calls[0].payload.response_format.json_schema.strict,true);
    assert.equal(calls[0].payload.provider.allow_fallbacks,false);
    assert.equal(calls[0].payload.provider.require_parameters,true);
    assert.equal(calls[0].payload.tools,undefined);
    await generateSpecies({...body,fresh:true});
    assert.equal(calls.length,2);
    await assert.rejects(generateSpecies({}),/al menos/);
    assert.equal(calls.length,2);
  });
});

test('OpenRouter rejects wrong diet counts and invalid JSON without requesting artwork',async()=>{
  const good=specimen('Alga');
  for(const content of ['not JSON','{"species":[{"name":"Pez","class":"herbivore"}]}',
    JSON.stringify({species:{}}),JSON.stringify({species:{herbivore_1:good}}),
    JSON.stringify({species:{producer_1:good,producer_2:good}}),
    JSON.stringify({species:{producer_1:{...good,traits:{...good.traits,size:'big'}}}}),
    JSON.stringify({species:{producer_1:{...good,traits:{...good.traits,speed:true}}}}),
    JSON.stringify({species:{producer_1:{...good,visualDescription:''}}})]) {
    await provider({choices:[{message:{content}}]},async calls=>{
      await assert.rejects(generateSpecies({producers:1}),error=>error.status===422);
      assert.equal(calls.length,1);
      assert.ok(calls[0].url.endsWith('chat/completions'));
    });
  }
});

test('truncated or refused species responses never start an image or retry',async()=>{
  for(const choice of [{...species.choices[0],finish_reason:'length'},
    {finish_reason:'stop',message:{refusal:'No content'}}]) {
    await provider({choices:[choice]},async calls=>{
      await assert.rejects(generateSpecies({producers:1}),error=>error.status===422);
      assert.equal(calls.length,1);
    });
  }
});

test('old validated species are reused and new structured results are shared across backends',async()=>{
  await provider(species,async calls=>{
    const body={producers:1};
    const created=await generateSpecies(body);
    const reused=execFileSync('python3',['-c',
      'import json,sys;import server;d=json.load(sys.stdin);server.CONFIG.clear();server.CONFIG.update(aiProvider="openrouter",openrouterApiKey="test-cache-key");server.generation_cache=server.GenerationCache(d["directory"]);server.post_json=lambda *a,**kw:sys.exit(2);print(json.dumps(server.generate_species({"producers":1})))'],
      {input:JSON.stringify({directory:generationCache.directory}),encoding:'utf8'});
    assert.deepEqual(JSON.parse(reused),created);
    // This is the former public request contract, kept solely for cache lookup.
    const prompts=JSON.parse(await readFile(new URL('../generation-prompts.json',import.meta.url),'utf8'));
    const legacyPayload={...calls[0].payload,response_format:{type:'json_object'},messages:[{role:'user',content:
      prompts.species.replace('$COUNTS','1 producer, 0 herbivore, 0 carnivore').replace('$WORLD','{"chaos":550,"mutationRate":90}')}]};
    const oldSpecies=[{name:'Alga anterior',class:'producer'}];
    await generationCache.getOrCreate('species',{provider:'openrouter',payload:legacyPayload},async()=>({value:oldSpecies}));
    assert.deepEqual(await generateSpecies(body),created);
    await rm(join(generationCache.directory,generationCache.key('species',{provider:'openrouter',payload:calls[0].payload})+'.json'));
    assert.deepEqual(await generateSpecies(body),oldSpecies);
    assert.equal(calls.length,1);
    await generateSpecies({...body,fresh:true});
    assert.deepEqual(await generateSpecies(body),created);
    assert.equal(calls.length,2);
  });
});

test('balance and provider failures do not retry or use the configured Google key',async()=>{
  for(const status of [401,402,429,500,502,503,504]) {
    await provider({error:{message:'failed test-openrouter-key and test-unused-google-key'}},async calls=>{
      await assert.rejects(generateImage('fish'),error=>{
        assert.equal(error.status,status);
        assert.equal(error.message.includes('test-openrouter-key'),false);
        assert.equal(error.message.includes('test-unused-google-key'),false);
        if(status===402) assert.match(error.message,/saldo/);
        return true;
      });
      assert.equal(calls.length,1);
      assert.ok(calls.every(call=>call.url.startsWith('https://openrouter.ai/')));
    },status);
  }
  await provider({error:{code:402,message:'insufficient credits'}},async calls=>{
    await assert.rejects(generateImage('fish'),error=>error.status===402);
    assert.equal(calls.length,1);
  });
});

test('remote URLs, malformed data and unsafe image types are rejected without fetching them',async()=>{
  for(const item of [{url:'https://untrusted.invalid/art.png'},{b64_json:'bad'},{b64_json:'aGVsbG8='},{b64_json:png,media_type:'image/svg+xml'}]) {
    await provider({data:[item]},async calls=>{
      await assert.rejects(generateImage('fish'),error=>error.status===422);
      assert.equal(calls.length,1);
    });
  }
  await provider({data:[{b64_json:png}]},async()=>{
    assert.equal(await generateImage('fish'),`data:image/png;base64,${png}`);
  });
  await provider(image,async calls=>{
    config.openrouterImageSize='4K';
    await assert.rejects(generateImage('fish'),error=>error.status===400);
    assert.equal(calls.length,0);
  });
});

test('connection checks authenticate and inspect capabilities without generating content',async()=>{
  const metadata=url=>url.endsWith('/key')?{data:{limit_remaining:1}}:url.endsWith('/models')
    ?{data:[{id:'openai/gpt-4.1-nano',architecture:{output_modalities:['text']}}]}
    :{endpoints:[{supported_parameters:{resolution:{values:['1K','2K']}}}]};
  await provider(metadata,async calls=>{
    assert.equal((await checkProvider()).ok,true);
    assert.equal(calls.length,3);
    assert.ok(calls.every(call=>!call.method&&!call.payload));
    config.openrouterImageSize='512';
    await assert.rejects(checkProvider(),/resolución/);
  });
});
