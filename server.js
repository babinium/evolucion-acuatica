import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const configPath = join(root, "config.local.json");
export const config = existsSync(configPath)
  ? JSON.parse(await readFile(configPath, "utf8"))
  : { geminiApiKey: "" };
if (process.env.GEMINI_API_KEY) config.geminiApiKey = process.env.GEMINI_API_KEY;
const GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models/";

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

function buildSpeciesPrompt(body) {
  const producers = clampCount(body.producers);
  const herbivores = clampCount(body.herbivores);
  const carnivores = clampCount(body.carnivores);
  const total = producers + herbivores + carnivores;

  return `
Create ${total} original aquatic ecosystem species for a survival/evolution simulation.
Counts: ${producers} producers, ${herbivores} herbivores, ${carnivores} carnivores.
World settings: ${JSON.stringify(body.world || {})}

Return ONLY valid JSON, no markdown. Use this schema:
{
  "species": [
    {
      "name": "Spanish common/species name",
      "class": "producer|herbivore|carnivore",
      "description": "short biological description in Spanish",
      "visualDescription": "short visual description in Spanish",
      "diet": "what it eats in Spanish",
      "habitat": "preferred aquatic zone in Spanish",
      "behavior": "short behavior in Spanish",
      "strengths": ["Spanish text"],
      "weaknesses": ["Spanish text"],
      "traits": {
        "size": 1-10,
        "speed": "producers 0, herbivores 1-10, carnivores 6-10",
        "attack": 0-10,
        "defense": 0-10,
        "perception": 1-10,
        "fertility": "producers 10-30, herbivores/carnivores 5-20",
        "metabolism": 1-10,
        "foodEfficiency": 1-10,
        "toxicity": 0-10
      },
      "spritePrompt": "English description of this species' body, colors, fins and distinctive features. A single top-down game creature, head right. Do not describe a background."
    }
  ]
}

Balance rules:
- Producers have attack 0 and speed 0; they are anchored and use light plus shared local nutrients.
- Herbivores have attack 0, can have defense, speed, perception, toxicity.
- Carnivores hunt animals and eat finite corpses; attack, speed, size and perception matter.
- Carnivores must start fast enough to hunt: speed should be between 6 and 10.
- Bigger size increases health and energy reserves, costs upkeep and reduces agility. Metabolism is a separate tradeoff.
- High metabolism accelerates activity and digestion/photosynthesis but increases energy and oxygen demand and aging.
- Perception extends animal senses and improves nutrient uptake in producers. Carnivores should start with perception 5-9.
- Efficiency improves assimilation, body toxins poison consumers, and defense reduces damage; all cost energy to maintain.
- Fertility affects birth opportunities and recovery time. Every baby costs the parent both reserves and edible tissue.
- High speed, defense, attack, perception, toxicity, or fertility should have tradeoffs. Avoid maximizing every trait.
- Make species varied, visually memorable, and mechanically fair.
`;
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

export async function retryRequest(operation, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt === 2 || ![429, 500, 502, 503, 504].includes(error.status)) throw error;
      await sleep(1500 * 2 ** attempt);
    }
  }
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
  const help = status === 400 ? "Revisá la clave, el modelo y su configuración."
    : [401, 403].includes(status) ? "Revisá la clave y sus permisos para la API de Gemini."
    : status === 404 ? "El modelo no está disponible: revisá geminiModel o geminiImageModel."
    : status === 429 ? "Revisá la cuota y la facturación del proyecto en Google AI Studio."
    : "Podés volver a intentar más tarde.";
  return `Google HTTP ${status}: ${safe} ${help}`;
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
  const model = config.geminiModel || "gemini-3.1-flash-lite";
  const data = await retryRequest(() => postJson(
    `${GOOGLE_API}${encodeURIComponent(model)}:generateContent`,
    { contents: [{ parts: [{ text: buildSpeciesPrompt(body) }] }], generationConfig: { temperature: 0.95, responseMimeType: "application/json" } },
    { "x-goog-api-key": config.geminiApiKey }, "Gemini"
  ));
  const text = data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || "").join("") || "";
  let parsed;
  try { parsed = extractJson(text); }
  catch { throw new ApiError("Gemini no devolvió un JSON válido de especies."); }
  const species = Array.isArray(parsed.species) ? parsed.species.filter(sp => sp && typeof sp.name === "string" && ["producer", "herbivore", "carnivore"].includes(sp.class)).slice(0, MAX_SPECIES_PER_REQUEST) : [];
  if (!species.length) throw new ApiError("Gemini no devolvió especies válidas.");
  for (const [key, type] of [["producers", "producer"], ["herbivores", "herbivore"], ["carnivores", "carnivore"]]) {
    if (species.filter(sp => sp.class === type).length !== clampCount(body[key])) {
      throw new ApiError("Google devolvió cantidades de especies distintas de las pedidas. No se generaron imágenes.", 422);
    }
  }
  return species;
}

export function buildImagePrompt(prompt) {
  return `Create exactly ONE aquatic species illustration for a small 2D ecosystem game.
Species appearance: ${prompt}
Mandatory asset format (override any conflicting background or framing in the description):
- Exactly one specimen, orthographic dorsal TOP-DOWN view, not side view, not isometric.
- Animal head/front points exactly RIGHT, tail/back LEFT. Plants are a compact anchored colony viewed from above.
- Opaque filled colored body, clear silhouette, readable at 32 pixels; limited detail and sturdy fins.
- Entire specimen centered, all fins and appendages visible, at least 12% empty margin on every side.
- Flat perfectly uniform chroma MAGENTA background (#ff00ff). The body must not contain magenta or pink. Blue, cyan and green bodies are allowed.
- No transparency, checkerboard, gradients, glow, shadows, water, scenery, floor, rocks, props, labels, text, frame, watermark or multiple views.
- This exact illustration will also be shown enlarged as the species portrait. Return the image only.`;
}

export async function generateImage(prompt) {
  requireGoogleKey();
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 10000) throw new ApiError("Falta una descripción de imagen válida (máximo 10000 caracteres).", 400);
  const { geminiImageModel: model, geminiImageSize: size } = configStatus();
  if (!["512", "1K"].includes(size)) throw new ApiError("geminiImageSize debe ser 512 o 1K para este juego.", 400);
  const data = await postJson(`${GOOGLE_API}${encodeURIComponent(model)}:generateContent`, {
    contents: [{ parts: [{ text: buildImagePrompt(prompt) }] }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: size } }
  }, { "x-goog-api-key": config.geminiApiKey }, "Google imágenes", 90000);
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
  return `data:${image.mimeType};base64,${encoded}`;
}

export async function generateImageWithRetry(prompt) {
  return retryRequest(() => generateImage(prompt));
}

async function handleApi(req, res) {
  try {
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
      sendJson(res, 200, { image: await generateImageWithRetry(body.prompt) });
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
  if (!target.startsWith(root + sep) || target.endsWith("config.local.json") || pathname.split("/").some(part => part.startsWith("."))) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(target);
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
