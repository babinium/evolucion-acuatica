import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { config, configStatus, checkGoogle, ApiError, generateSpecies, generateImage, generateImageWithRetry, retryRequest, server } from '../server.js';

const realFetch = globalThis.fetch;
const originalConfig = {...config};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
const inline=(data=png,mimeType='image/png')=>({inlineData:{mimeType,data}});
const responseImage=(parts=[inline()])=>({candidates:[{content:{parts},finishReason:'STOP'}]});
async function withProvider(response, callback, status=200) {
  const calls = [];
  for(const key of Object.keys(config)) delete config[key];
  Object.assign(config, {geminiApiKey: 'test-key', geminiModel: 'test-model', geminiImageModel: 'test-image-model'});
  globalThis.fetch = async (url, options) => {
    calls.push({url, ...options, payload: options.body?JSON.parse(options.body):null});
    return {ok:status<400,status,json:async()=>response};
  };
  try { await callback(calls); }
  finally {
    globalThis.fetch = realFetch;
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
    assert.deepEqual(calls[0].payload.generationConfig,{responseModalities:['IMAGE'],imageConfig:{aspectRatio:'1:1',imageSize:'512'}});
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
      await assert.rejects(generateImageWithRetry('fish'),error=>error.status===422);
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

test('transient errors retry with backoff, credential errors do not retry', async () => {
  const waits = [];
  let calls = 0;
  const result = await retryRequest(() => {
    if (++calls < 3) throw new ApiError('rate limit', 429);
    return 'ok';
  }, async ms => waits.push(ms));
  assert.equal(result, 'ok');
  assert.deepEqual(waits, [1500, 3000]);
  calls = 0;
  await assert.rejects(retryRequest(() => {calls++; throw new ApiError('invalid key', 401);}, async () => assert.fail('should not wait')), /invalid key/);
  assert.equal(calls, 1);
});

test('Node HTTP image route generates exactly one asset and rejects the old pair format',async()=>{
  await withProvider(responseImage(),async calls=>{
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}/api/generate-images`;
    try {
      const image=await realFetch(url,{method:'POST',body:JSON.stringify({prompt:'fish'})});
      assert.deepEqual(await image.json(),{image:`data:image/png;base64,${png}`});
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
    for (const path of ['/config.local.json', '/.git/config']) assert.equal((await realFetch(url + path)).status, 403);
    if (!config.geminiApiKey) {
      const missing = await realFetch(url + '/api/generate-species', {method: 'POST', body: '{}'});
      assert.equal(missing.status, 400);
      assert.match((await missing.json()).error, /geminiApiKey/);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
