import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GenerationCache, canonicalJson } from "./generation-cache.js";

const root = dirname(fileURLToPath(import.meta.url));
const configPath = join(root, "config.local.json");
export const config = existsSync(configPath)
  ? JSON.parse(await readFile(configPath, "utf8"))
  : { geminiApiKey: "" };
if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;
const GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models/";
const PROMPTS = JSON.parse(await readFile(join(root,"generation-prompts.json"),"utf8"));
export const generationCache = new GenerationCache(join(root,".ai-cache"));

export function configStatus() {
  const hasGeminiApiKey = Boolean(config.geminiApiKey);
  return {
    configFile: "config.local.json",
    provider: "google",
    hasGeminiApiKey,
    missing: hasGeminiApiKey ? [] : ["geminiApiKey"],
    canUseAiText: hasGeminiApiKey,
    canUseAiImages: hasGeminiApiKey,
    geminiModel: config.geminiModel || "gemini-3.1-flash-lite",
    geminiImageModel: config.geminiImageModel || "gemini-3.1-flash-image",
    geminiImageSize: config.geminiImageSize || "512"
  };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const MAX_SPECIES_PER_TYPE = 4;
const MAX_SPECIES_PER_REQUEST = MAX_SPECIES_PER_TYPE * 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function clampCount(value) {
  return Math.max(0, Math.min(MAX_SPECIES_PER_TYPE, Math.round(Number(value)) || 0));
}

function normalizedWorld(body) {
  const perThousand=(value,fallback)=>Number.isFinite(Number(value??fallback))?Math.round(Math.max(0,Math.min(1,Number(value??fallback)))*1000):Math.round(fallback*1000);
  return {chaos:perThousand(body.world?.chaos,0.55),mutationRate:perThousand(body.world?.mutationRate,0.09)};
}

function buildSpeciesPrompt(body) {
  const counts=`${clampCount(body.producers)} producer, ${clampCount(body.herbivores)} herbivore, ${clampCount(body.carnivores)} carnivore`;
  return PROMPTS.species.replace('$COUNTS',counts).replace('$WORLD',canonicalJson(normalizedWorld(body)));
}

function thinkingConfig(model) {
  if(model.startsWith('gemini-3')&&model.includes('flash-lite')) return {thinkingConfig:{thinkingLevel:'MINIMAL',includeThoughts:false}};
  if(model.startsWith('gemini-3')) return {thinkingConfig:{thinkingLevel:'LOW',includeThoughts:false}};
  return {};
}

function usageOf(data) {
  return Object.fromEntries(['promptTokenCount','candidatesTokenCount','thoughtsTokenCount','totalTokenCount']
    .map(key=>[key,Number.isFinite(data.usageMetadata?.[key])?data.usageMetadata[key]:null]));
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Gemini did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

export class ApiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}


async function postJson(url, payload, headers, provider, timeout = 60000) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "evolucion-local/0.2", ...headers },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout)
    });
  } catch {
    throw new ApiError(`${provider}: no se pudo conectar o se agotó el tiempo de espera.`, 504);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    throw new ApiError(googleError(response.status, message || "La solicitud falló."), response.status);
  }
  return data;
}

function googleError(status, message) {
  // Provider errors occasionally echo request values. Never forward our key.
  const safe = String(message).replaceAll(config.geminiApiKey || "\u0000", "[clave oculta]").slice(0, 800);
  if(status===429) {
    return /free_tier/i.test(safe)&&/limit:\s*0/i.test(safe)
      ? 'Google HTTP 429: este modelo tiene cuota 0 en el nivel gratuito del proyecto de esta clave. Revisá la facturación de ese mismo proyecto en Google AI Studio. No se reenvió la solicitud.'
      : 'Google HTTP 429: se alcanzó una cuota de solicitudes o tokens. Revisá los límites, el saldo y la facturación del proyecto. No se reenvió la solicitud.';
  }
  const help = status === 400 ? "Revisá la clave, el modelo y su configuración."
    : [401, 403].includes(status) ? "Revisá la clave y sus permisos para la API de Gemini."
    : status === 404 ? "El modelo no está disponible: revisá geminiModel o geminiImageModel."
    : status === 429 ? "Revisá la cuota y la facturación del proyecto en Google AI Studio."
    : "Podés volver a intentar más tarde.";
  return `Google HTTP ${status}: ${safe.slice(0,180)} ${help}`;
}

function requireGoogleKey() {
  if (!config.geminiApiKey) throw new ApiError("Agregá geminiApiKey en config.local.json o GEMINI_API_KEY para usar Google.", 400);
}

export async function checkGoogle() {
  requireGoogleKey();
  const { geminiModel, geminiImageModel } = configStatus();
  for (const model of new Set([geminiModel, geminiImageModel])) {
    let response;
    try { response = await fetch(GOOGLE_API + encodeURIComponent(model), {
      headers: { "x-goog-api-key": config.geminiApiKey }, signal: AbortSignal.timeout(15000)
    }); } catch { throw new ApiError("No se pudo conectar con Google para comprobar los modelos.", 504); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(googleError(response.status, data.error?.message || "La comprobación falló."), response.status);
    if (!data.supportedGenerationMethods?.includes("generateContent")) {
      throw new ApiError(`El modelo ${model} no admite generateContent. Revisá la configuración.`, 400);
    }
  }
  return { ok: true, message: "Google responde y ambos modelos están disponibles. La cuota de imágenes se comprueba al generar." };
}

export async function generateSpecies(body) {
  requireGoogleKey();
  const total=['producers','herbivores','carnivores'].reduce((sum,key)=>sum+clampCount(body[key]),0);
  if(!total) throw new ApiError('Elegí al menos una especie.',400);
  const model=config.geminiModel||'gemini-3.1-flash-lite';
  const payload={contents:[{parts:[{text:buildSpeciesPrompt(body)}]}],generationConfig:{
    temperature:0.85,candidateCount:1,maxOutputTokens:Math.min(4096,256+320*total),
    responseMimeType:'application/json',...thinkingConfig(model)
  }};
  const record=await generationCache.getOrCreate('species',{model,payload},async()=>{
    const data=await postJson(`${GOOGLE_API}${encodeURIComponent(model)}:generateContent`,payload,
      {'x-goog-api-key':config.geminiApiKey},'Google');
    const text=data.candidates?.[0]?.content?.parts?.filter(part=>!part.thought).map(part=>part.text||'').join('')||'';
    let parsed;
    try {parsed=extractJson(text);} catch {throw new ApiError('Google no devolvió un JSON válido de especies. No se reenvió la solicitud.',422);}
    const species=Array.isArray(parsed?.species)?parsed.species.filter(sp=>sp&&typeof sp.name==='string'&&['producer','herbivore','carnivore'].includes(sp.class)).slice(0,MAX_SPECIES_PER_REQUEST):[];
    if(!species.length) throw new ApiError('Google no devolvió especies válidas.',422);
    for(const [key,type] of [['producers','producer'],['herbivores','herbivore'],['carnivores','carnivore']]) {
      if(species.filter(sp=>sp.class===type).length!==clampCount(body[key])) throw new ApiError('Google devolvió cantidades de especies distintas de las pedidas. No se generaron imágenes.',422);
    }
    return {value:species,usage:usageOf(data)};
  },{fresh:body.fresh===true});
  return record.value;
}

export function buildImagePrompt(prompt) {
  return PROMPTS.image.replace('$APPEARANCE',prompt);
}

export async function generateImage(prompt) {
  requireGoogleKey();
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 10000) throw new ApiError("Falta una descripción de imagen válida (máximo 10000 caracteres).", 400);
  const { geminiImageModel: model, geminiImageSize: size } = configStatus();
  if (!["512", "1K"].includes(size)) throw new ApiError("geminiImageSize debe ser 512 o 1K para este juego.", 400);
  const payload={
    contents:[{parts:[{text:buildImagePrompt(prompt)}]}],
    generationConfig:{responseModalities:['IMAGE'],candidateCount:1,maxOutputTokens:4096,
      imageConfig:{aspectRatio:'1:1',imageSize:size},...thinkingConfig(model)}
  };
  const record=await generationCache.getOrCreate('image',{model,payload},async()=>{
  const data=await postJson(`${GOOGLE_API}${encodeURIComponent(model)}:generateContent`,payload,
    {'x-goog-api-key':config.geminiApiKey},'Google imágenes',90000);
  const candidate = data.candidates?.[0];
  const image = candidate?.content?.parts?.find(part => !part.thought && part.inlineData?.mimeType?.startsWith("image/"))?.inlineData;
  if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)) {
    const reason = data.promptFeedback?.blockReason || candidate?.finishReason || "sin imagen";
    throw new ApiError(`Google no devolvió una imagen utilizable (${reason}). No se repetirá automáticamente.`, 422);
  }
  const encoded = image.data;
  if (typeof encoded !== "string" || !encoded.length || encoded.length > MAX_IMAGE_BYTES * 4 / 3 + 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4) {
    throw new ApiError("Google devolvió datos de imagen inválidos o demasiado grandes.", 422);
  }
  const bytes = Buffer.from(encoded, "base64");
  const valid = image.mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : image.mimeType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new ApiError("Google devolvió una imagen con formato inválido.", 422);
  return {value:`data:${image.mimeType};base64,${encoded}`,usage:usageOf(data)};
  });
  return record.value;
}


async function handleApi(req, res) {
  try {
    const host=req.headers.host||'';
    const allowed=new Set([`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`]);
    if(!allowed.has(host)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==`http://${host}`)) {
      throw new ApiError('Las acciones de IA solo se aceptan desde este juego local.',403);
    }
    const body = await readBody(req);
    if (req.url === "/api/check-google") {
      sendJson(res, 200, await checkGoogle());
      return;
    }
    if (req.url === "/api/generate-species") {
      const species = await generateSpecies(body);
      sendJson(res, 200, { species });
      return;
    }
    if (req.url === "/api/generate-images") {
      sendJson(res, 200, { image: await generateImage(body.prompt) });
      return;
    }
    sendJson(res, 404, { error: "Unknown API route." });
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/config-status") {
    sendJson(res, 200, configStatus());
    return;
  }
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = resolve(join(root, pathname));
  const isPrivate=path=>path.split(/[\\/]/).some(part=>part.startsWith('.')||part.toLowerCase().startsWith('config.local'));
  if (!target.startsWith(root + sep) || isPrivate(pathname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const actual=await realpath(target);
    if(!actual.startsWith(root+sep)||isPrivate(relative(root,actual))) {
      res.writeHead(403);res.end('Forbidden');return;
    }
    const content = await readFile(actual);
    res.writeHead(200, { "Content-Type": mime[extname(target)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

export const server = createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5173;
  server.listen(port, "127.0.0.1", () => console.log(`Evolución acuática: http://127.0.0.1:${port}`));
}
