import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readdir, readFile, mkdir, writeFile, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, configStatus, checkGoogle, generateSpecies, generateImage, generationCache, server } from '../server.js';

const realFetch = globalThis.fetch;
const originalConfig = {...config};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const inline=(data=png,mimeType='image/png')=>({inlineData:{mimeType,data}});
const responseImage=(parts=[inline()])=>({candidates:[{content:{parts},finishReason:'STOP'}]});
async function withProvider(response, callback, status=200) {
  const calls = [];
  const originalDirectory=generationCache.directory;
  const directory=await mkdtemp(join(tmpdir(),'evo-api-test-'));
  generationCache.directory=directory;
  for(const key of Object.keys(config)) delete config[key];
  Object.assign(config, {geminiApiKey: 'test-key', geminiModel: 'test-model', geminiImageModel: 'test-image-model'});
  globalThis.fetch = async (url, options) => {
    calls.push({url, ...options, payload: options.body?JSON.parse(options.body):null});
    return {ok:status<400,status,json:async()=>response};
  };
  try { await callback(calls); }
  finally {
    globalThis.fetch = realFetch;
    generationCache.directory=originalDirectory;
    await rm(directory,{recursive:true,force:true});
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, originalConfig);
  }
}

test('one Google key enables species and images without Together',async()=>{
  await withProvider({},async()=>{
    const status=configStatus();
    assert.equal(status.canUseAiImages,true);
    assert.equal(status.canUseAiText,true);
    assert.deepEqual(status.missing,[]);
    assert.equal(status.geminiImageModel,'test-image-model');
    assert.equal('geminiApiKey' in status,false);
    assert.equal(JSON.stringify(status).includes('test-key'),false);
    config.geminiApiKey='';
    assert.deepEqual(configStatus().missing,['geminiApiKey']);
    assert.equal(configStatus().canUseAiImages,false);
  });
});

test('Google returns a persistent image from generateContent using the configured model and size', async () => {
  await withProvider(responseImage(), async calls => {
    assert.equal(await generateImage('blue fish'), `data:image/png;base64,${png}`);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://generativelanguage.googleapis.com/v1beta/models/test-image-model:generateContent');
    assert.equal(calls[0].headers['x-goog-api-key'],'test-key');
    assert.equal(calls[0].url.includes('test-key'),false);
    assert.deepEqual(calls[0].payload.generationConfig,{responseModalities:['IMAGE'],candidateCount:1,maxOutputTokens:4096,imageConfig:{aspectRatio:'1:1',imageSize:'512'}});
    const prompt=calls[0].payload.contents[0].parts[0].text;
    assert.match(prompt,/blue fish/);
    assert.match(prompt,/#ff00ff/);
    assert.match(prompt,/TOP-DOWN/);
    assert.match(prompt,/RIGHT/);
    assert.match(prompt,/12%/);
    assert.equal(calls.some(c=>c.url.includes('together')),false);
  });
});

test('interleaved text and thinking images do not hide or replace the final image',async()=>{
  await withProvider(responseImage([{text:'preparing'}, {...inline('bad'),thought:true},inline()]),async()=>{
    assert.equal(await generateImage('fish'),`data:image/png;base64,${png}`);
  });
});

test('blocked, empty and invalid images fail without regenerating',async()=>{
  for(const response of [{promptFeedback:{blockReason:'SAFETY'}},responseImage([]),responseImage([inline('not-base64')]),responseImage([inline('aGVsbG8=')]),responseImage([inline(png,'image/svg+xml')])]) {
    await withProvider(response,async calls=>{
      await assert.rejects(generateImage('fish'),error=>error.status===422);
      assert.equal(calls.length,1);
    });
  }
});

test('unsupported sizes and empty prompts fail before spending quota',async()=>{
  await withProvider(responseImage(),async calls=>{
    await assert.rejects(generateImage(''),error=>error.status===400);
    config.geminiImageSize='4K';
    await assert.rejects(generateImage('fish'),/512 o 1K/);
    assert.equal(calls.length,0);
  });
});

test('connection check reads model metadata without paid generation',async()=>{
  await withProvider({supportedGenerationMethods:['generateContent']},async calls=>{
    assert.equal((await checkGoogle()).ok,true);
    assert.equal(calls.length,2);
    assert.ok(calls.every(c=>!c.method&&!c.payload&&!c.url.includes(':generateContent')));
  });
});

test('quota errors explain billing and never expose the credential',async()=>{
  await withProvider({error:{message:'Quota exhausted for test-key'}},async calls=>{
    await assert.rejects(generateImage('fish'),error=>error.status===429 && /facturación/.test(error.message) && !error.message.includes('test-key'));
    assert.equal(calls.length,1);
  },429);
});

test('zero image quota gives a short actionable notice without another request',async()=>{
  await withProvider({error:{message:'generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, test-key'}},async calls=>{
    await assert.rejects(generateImage('fish'),error=>error.status===429 && /cuota 0/.test(error.message) && /mismo proyecto/.test(error.message) && error.message.length<250 && !error.message.includes('test-key'));
    assert.equal(calls.length,1);
  },429);
});

test('Gemini uses a configurable text model, ignores thoughts and keeps the key out of the URL', async () => {
  await withProvider({candidates: [{content: {parts: [{thought:true,text:'ignore {this}'},{text: '{"species":[{"name":"Alga","class":"producer"}]}'}]}}]}, async calls => {
    assert.equal((await generateSpecies({producers:1}))[0].name,'Alga');
    assert.ok(calls[0].url.endsWith('/test-model:generateContent'));
    assert.equal(calls[0].url.includes('test-key'),false);
    assert.equal(calls[0].headers['x-goog-api-key'],'test-key');
  });
});

test('empty species and wrong diet counts stop before generating images',async()=>{
  for(const species of [[],[{name:'Pez',class:'herbivore'}]]) await withProvider({candidates:[{content:{parts:[{text:JSON.stringify({species})}]}}]},async calls=>{
    await assert.rejects(generateSpecies({producers:1}),/especies/);
    assert.equal(calls.length,1);
  });
});

test('generation errors never resend paid requests automatically',async()=>{
  for(const status of [429,500,502,503,504]) await withProvider({error:{message:'temporarily unavailable'}},async calls=>{
    await assert.rejects(generateImage('fish'),error=>error.status===status);
    assert.equal(calls.length,1);
  },status);
});

test('repeat and concurrent image requests reuse one generation stored locally',async()=>{
  await withProvider(responseImage(),async calls=>{
    const images=await Promise.all([generateImage('same fish'),generateImage('same fish')]);
    assert.equal(images[0],images[1]);
    assert.equal(await generateImage('same fish'),images[0]);
    assert.equal(calls.length,1);
    const files=await readdir(generationCache.directory);
    assert.equal(files.length,1);
    const record=await readFile(join(generationCache.directory,files[0]),'utf8');
    assert.equal(record.includes('test-key'),false);
    assert.equal(record.includes('x-goog-api-key'),false);
    // Python must reuse the same disk entry after switching servers.
    const output=execFileSync('python3',['-c',
      'import json,sys;from generation_cache import GenerationCache;d=json.load(sys.stdin);r=GenerationCache(d["directory"]).get_or_create("image",d["request"],lambda:sys.exit(2));print(r["value"])'],
      {input:JSON.stringify({directory:generationCache.directory,request:{model:'test-image-model',payload:calls[0].payload}}),encoding:'utf8'});
    assert.equal(output.trim(),images[0]);
  });
});

test('species are reused until the user explicitly requests new ones',async()=>{
  await withProvider({candidates:[{content:{parts:[{text:'{"species":[{"name":"Alga","class":"producer"}]}'}]}}]},async calls=>{
    const body={producers:1};
    await generateSpecies(body);await generateSpecies(body);
    assert.equal(calls.length,1);
    assert.equal(calls[0].payload.generationConfig.candidateCount,1);
    assert.equal(calls[0].payload.generationConfig.maxOutputTokens,576);
    assert.ok(calls[0].payload.contents[0].parts[0].text.length<1500);
    await generateSpecies({...body,fresh:true});
    assert.equal(calls.length,2);
  });
});

test('Node HTTP image route generates exactly one asset and rejects the old pair format',async()=>{
  await withProvider(responseImage(),async calls=>{
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}/api/generate-images`;
    try {
      const image=await realFetch(url,{method:'POST',body:JSON.stringify({prompt:'fish'})});
      assert.deepEqual(await image.json(),{image:`data:image/png;base64,${png}`});
      const foreign=await realFetch(url,{method:'POST',headers:{Origin:'https://foreign.invalid'},body:JSON.stringify({prompt:'new fish'})});
      assert.equal(foreign.status,403);
      assert.equal(calls.length,1);
      const invalid=await realFetch(url,{method:'POST',body:JSON.stringify({prompts:[{prompt:'fish'},{prompt:'fish'}]})});
      assert.equal(invalid.status,400);
      assert.equal(calls.length,1);
    } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
  });
});

test('local Node server serves the game and protects the key file', async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await realFetch(url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Crear mi ecosistema/);
    const status = await (await realFetch(`${url}/api/config-status`)).json();
    assert.equal(Object.keys(status).some(k => k === 'geminiApiKey' || k === 'togetherApiKey'), false);
    for (const path of ['/config.local.json', '/config.local.example.json', '/config.local.backup.json', '/.env', '/.ai-cache/private.json', '/.git/config']) assert.equal((await realFetch(url + path)).status, 403);
    await mkdir('.local-tools',{recursive:true});
    const directory=await mkdtemp(join(process.cwd(),'.local-tools','privacy-'));
    const alias=join(process.cwd(),'public-'+basename(directory)+'.json');
    try {
      const target=join(directory,'secret.json');
      await writeFile(target,'{"fixture":true}');await symlink(target,alias);
      assert.equal((await realFetch(url+'/'+basename(alias))).status,403);
    } finally {await unlink(alias).catch(()=>{});await rm(directory,{recursive:true,force:true});}

    if (!config.geminiApiKey) {
      const missing = await realFetch(url + '/api/generate-species', {method: 'POST', body: '{}'});
      assert.equal(missing.status, 400);
      assert.match((await missing.json()).error, /geminiApiKey/);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
