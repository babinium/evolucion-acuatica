import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

export function createGame({ baseline = false, fetch: fetchImpl, storage } = {}) {
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
      addEventListener(name, fn) {listeners.set(`${id}:${name}`, fn);},
      appendChild(child) {this.children.push(child);}, setAttribute() {}, removeAttribute() {}, focus() {}, closest() {return null;}, querySelectorAll() {return [];}, querySelector() {return element(`${id}:child`);}
    };
    elements.set(id, el);
    return el;
  }
  const values = storage ?? new Map();
  let randomSeed = 123456;
  const math = Object.create(Math);
  math.random = () => {randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296;};
  const sandbox = {console, Math: math, Date: class extends Date { static now() { return 1700000000000; } }, Map, Set, JSON, Uint8Array, Uint8ClampedArray, URL, AbortController, AbortSignal, performance,
    innerWidth: 1366, innerHeight: 768,
    navigator: {hardwareConcurrency: 2, deviceMemory: 4},
    document: {getElementById: element, querySelector: element, querySelectorAll: () => [], createElement: element, activeElement: null, hidden: false, addEventListener(name, fn) {listeners.set(`document:${name}`, fn);}},
    localStorage: {getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v)},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    fetch: fetchImpl ?? (async () => ({ok: true, json: async () => ({canUseAiImages: false, canUseAiText: false, hasTogetherApiKey: false, missing: ['geminiApiKey', 'togetherApiKey']})})),
    location: {hostname: 'localhost', protocol: 'http:', reload() {}}, Image: class {set src(value) {}},
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (name, fn) => listeners.set(`window:${name}`, fn);
  const context = vm.createContext(sandbox);
  if (!baseline) for (const file of ['spatial-grid.js', 'powers.js']) {
    if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  }
  const source = baseline ? execFileSync('git', ['show', 'origin/main:app.js'], {encoding: 'utf8'}) : fs.readFileSync('app.js', 'utf8');
  vm.runInContext(source, context, {filename: 'app.js'});
  return {run: code => vm.runInContext(code, context), context, elements, listeners, values, element};
}
