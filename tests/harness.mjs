import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

export function createGame({ baseline = false, seed = 123456, ref, fetch: fetchImpl, storage } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const canvasContext = new Proxy({}, { get(target, key) {
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({addColorStop() {}});
    if (key === 'getImageData') return () => ({data: new Uint8ClampedArray(192 * 192 * 4)});
    return target[key] ?? (() => {});
  }});
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const classes = new Set();
    const el = {id, value: ({setupProducers: '1', setupHerbivores: '1', setupCarnivores: '1', setupSize: '3600', setupChaos: '0.55', setupMutation: '0.09', setupQuality: 'eco'})[id] ?? '', textContent: '', innerHTML: '', disabled: false,
      dataset: {}, style: {setProperty() {}}, children: [],
      classList: {add(...names) {names.forEach(n => classes.add(n));}, remove(...names) {names.forEach(n => classes.delete(n));}, contains(n) {return classes.has(n);}, toggle(n, force) {const on = force ?? !classes.has(n); on ? classes.add(n) : classes.delete(n); return on;}},
      getContext: () => canvasContext,
      toDataURL: () => 'data:image/png;base64,' + Buffer.from(id).toString('base64'),
      getBoundingClientRect: () => ({top:0,left:0,width:200,height:400}),
      addEventListener(name, fn) {listeners.set(`${id}:${name}`, fn);},
      appendChild(child) {this.children.push(child);}, setAttribute() {}, removeAttribute() {}, focus() {}, closest() {return null;}, querySelectorAll() {return [];}, querySelector() {return element(`${id}:child`);},
      open:false,showModal(){this.open=true;},close(){if(!this.open)return;this.open=false;listeners.get(`${id}:close`)?.({});}
    };
    elements.set(id, el);
    return el;
  }
  const values = storage ?? new Map();
  const sandbox = {console, Date: class extends Date { static now() { return 1700000000000; } }, Map, Set, JSON, Uint8Array, Uint8ClampedArray, URL, AbortController, AbortSignal, performance,
    innerWidth: 1366, innerHeight: 768,
    navigator: {hardwareConcurrency: 2, deviceMemory: 4},
    document: {getElementById: element, querySelector: element, querySelectorAll: () => [], createElement: element, activeElement: null, hidden: false, addEventListener(name, fn) {listeners.set(`document:${name}`, fn);}},
    localStorage: {getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v)},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    fetch: fetchImpl ?? (async () => ({ok: true, json: async () => ({canUseAiImages: false, canUseAiText: false, missing: ['geminiApiKey']})})),
    location: {hostname: 'localhost', protocol: 'http:', reload() {}}, Image: class {set src(value) {}},
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (name, fn) => listeners.set(`window:${name}`, fn);
  const context = vm.createContext(sandbox);
  vm.runInContext(`let testSeed = ${seed >>> 0}; Math.random = () => {
    testSeed = (Math.imul(testSeed,1664525) + 1013904223) >>> 0; return testSeed/4294967296;
  };`, context);
  const readSource = file => ref ? execFileSync('git', ['show', `${ref}:${file}`], {encoding: 'utf8', stdio:['ignore','pipe','ignore']}) : fs.readFileSync(file, 'utf8');
  const sources = [];
  if (!baseline) for (const file of ['darwin-core.js','darwin-data.js','darwin-vault.js','darwin-ui.js','spatial-grid.js', 'ecology.js', 'world-rules.js', 'powers.js', 'sprite-tools.js','evolution.js']) {
    try { sources.push(readSource(file)); } catch (error) { if (!ref) throw error; }
  }
  sources.push(baseline ? execFileSync('git', ['show', 'origin/main:app.js'], {encoding: 'utf8'}) : readSource('app.js'));
  // Keep ordinary function calls lexical, as in a browser, instead of routing each
  // call through Node's slow context-global proxy. All versions use this same harness.
  const run = vm.runInContext(`(function() {
    const {Math, Object, Array, Number, String, Date, Map, Set, JSON} = globalThis;
    ${sources.join('\n')}
    return code => eval(code);
  })()`, context, {filename: 'game-test.js'});
  return {run, context, elements, listeners, values, element};
}
