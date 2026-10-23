import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const configPath = join(root, "config.local.json");
export const config = existsSync(configPath)
  ? JSON.parse(await readFile(configPath, "utf8"))
  : { togetherApiKey: "", geminiApiKey: "" };

function configStatus() {
  const hasGeminiApiKey = Boolean(config.geminiApiKey);
  const hasTogetherApiKey = Boolean(config.togetherApiKey);
  const missing = [];
  if (!hasGeminiApiKey) missing.push("geminiApiKey");
  if (!hasTogetherApiKey) missing.push("togetherApiKey");
  return {
    configFile: "config.local.json",
    hasGeminiApiKey,
    hasTogetherApiKey,
    missing,
    canUseAiText: hasGeminiApiKey,
    canUseAiImages: hasGeminiApiKey && hasTogetherApiKey,
    geminiModel: config.geminiModel || "gemini-3.1-flash-lite",
    togetherModel: config.togetherModel || "black-forest-labs/FLUX.2-dev"
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
const MAX_IMAGES_PER_REQUEST = 2;

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
      "portraitPrompt": "English prompt for detailed isolated scientific aquatic creature illustration, white background, no text",
      "spritePrompt": "English prompt for extremely simple top-down game sprite of the same species, solid chroma blue background (#0047ff), filled body, head facing right, no text"
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

async function postJson(url, payload, headers, provider) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "evolucion-local/0.2", ...headers },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(60000)
    });
  } catch {
    throw new ApiError(`${provider}: no se pudo conectar o se agotó el tiempo de espera.`, 504);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : data.error?.message;
    throw new ApiError(`${provider} HTTP ${response.status}: ${message || "La solicitud falló."}`, response.status);
  }
  return data;
}

export async function generateSpecies(body) {
  if (!config.geminiApiKey) throw new ApiError("Agregá geminiApiKey en config.local.json para usar IA.", 400);
  const model = config.geminiModel || "gemini-3.1-flash-lite";
  const data = await retryRequest(() => postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { contents: [{ parts: [{ text: buildSpeciesPrompt(body) }] }], generationConfig: { temperature: 0.95, responseMimeType: "application/json" } },
    { "x-goog-api-key": config.geminiApiKey }, "Gemini"
  ));
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
  let parsed;
  try { parsed = extractJson(text); }
  catch { throw new ApiError("Gemini no devolvió un JSON válido de especies."); }
  const species = Array.isArray(parsed.species) ? parsed.species.filter(sp => sp && typeof sp.name === "string" && ["producer", "herbivore", "carnivore"].includes(sp.class)).slice(0, MAX_SPECIES_PER_REQUEST) : [];
  if (!species.length) throw new ApiError("Gemini no devolvió especies válidas.");
  return species;
}

export async function generateImage(prompt, mode) {
  if (!config.togetherApiKey) throw new ApiError("Agregá togetherApiKey en config.local.json para generar imágenes.", 400);
  const model = config.togetherModel || "black-forest-labs/FLUX.2-dev";
  const data = await postJson("https://api.together.ai/v1/images/generations", {
    model, prompt, n: 1, width: mode === "sprite" ? 512 : 768, height: mode === "sprite" ? 512 : 576,
    response_format: "base64", output_format: "png",
    ...(model.includes("schnell") ? { steps: 4 } : {})
  }, { Authorization: `Bearer ${config.togetherApiKey}` }, "Together");
  const encoded = data.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || !encoded) throw new ApiError("Together no devolvió una imagen válida en base64.");
  return `data:image/png;base64,${encoded}`;
}

async function generateImageWithRetry(prompt, mode) {
  return retryRequest(() => generateImage(prompt, mode));
}

async function handleApi(req, res) {
  try {
    const body = await readBody(req);
    if (req.url === "/api/generate-species") {
      const species = await generateSpecies(body);
      sendJson(res, 200, { species });
      return;
    }
    if (req.url === "/api/generate-images") {
      const prompts = Array.isArray(body.prompts) ? body.prompts.slice(0, MAX_IMAGES_PER_REQUEST) : [];
      const images = [];
      for (const item of prompts) {
        images.push(await generateImageWithRetry(String(item.prompt || ""), item.mode));
      }
      sendJson(res, 200, { images });
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
