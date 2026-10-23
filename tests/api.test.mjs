import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { config, ApiError, generateSpecies, generateImage, retryRequest, server } from '../server.js';

const realFetch = globalThis.fetch;
const originalConfig = {...config};
async function withProvider(response, callback) {
  const calls = [];
  Object.assign(config, {geminiApiKey: 'test-key', togetherApiKey: 'test-key', geminiModel: 'test-model', togetherModel: 'test-image-model'});
  globalThis.fetch = async (url, options) => {
    calls.push({url, ...options, payload: JSON.parse(options.body)});
    return {ok: true, status: 200, json: async () => response};
  };
  try { await callback(calls); }
  finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, originalConfig);
  }
}

test('Together uses the official endpoint and returns a persistent compact PNG', async () => {
  await withProvider({data: [{b64_json: 'aGVsbG8='}]}, async calls => {
    assert.equal(await generateImage('fish', 'sprite'), 'data:image/png;base64,aGVsbG8=');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.together.ai/v1/images/generations');
    assert.equal(calls[0].payload.width, 512);
    assert.equal(calls[0].payload.height, 512);
    assert.equal(calls[0].payload.response_format, 'base64');
    assert.equal(calls[0].payload.model, 'test-image-model');
    assert.equal('aspect_ratio' in calls[0].payload, false);
  });
});

test('Gemini uses a configurable model and keeps the key out of the URL', async () => {
  await withProvider({candidates: [{content: {parts: [{text: '{"species":[{"name":"Alga","class":"producer"}]}'}]}}]}, async calls => {
    const species = await generateSpecies({producers: 1});
    assert.equal(species[0].name, 'Alga');
    assert.ok(calls[0].url.endsWith('/test-model:generateContent'));
    assert.equal(calls[0].url.includes('test-key'), false);
    assert.equal(calls[0].headers['x-goog-api-key'], 'test-key');
  });
});

test('an empty Gemini answer is reported as an error', async () => {
  await withProvider({candidates: [{content: {parts: [{text: '{"species":[]}'}]}}]}, async () => {
    await assert.rejects(generateSpecies({producers: 1}), /especies válidas/);
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

test('local Node server serves the game and handles missing keys without revealing them', async () => {
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
