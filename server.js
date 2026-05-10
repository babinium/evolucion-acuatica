import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = process.cwd();
const configPath = join(root, "config.local.json");
const config = existsSync(configPath)
  ? JSON.parse(await readFile(configPath, "utf8"))
  : { togetherApiKey: "", geminiApiKey: "" };

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

const MAX_SPECIES_PER_REQUEST = 18;
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
  return Math.max(0, Math.min(MAX_SPECIES_PER_REQUEST, Number(value) || 0));
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
        "speed": 1-10,
        "attack": 0-10,
        "defense": 0-10,
        "camouflage": 0-10,
        "perception": 1-10,
        "fertility": 1-10,
        "metabolism": 1-10,
        "foodEfficiency": 1-10,
        "temperatureTolerance": 1-10,
        "toxicity": 0-10,
        "sociability": 0-10,
        "aggression": 0-10
      },
      "portraitPrompt": "English prompt for detailed isolated scientific aquatic creature illustration, white background, no text",
      "spritePrompt": "English prompt for extremely simple top-down game sprite of the same species, isolated white background, no text"
    }
  ]
}

Balance rules:
- Producers have attack 0, low speed, use nutrients/light, may have toxicity or defense.
- Herbivores have attack 0, can have defense, speed, camouflage, toxicity.
- Carnivores can eat herbivores and other carnivores; attack and aggression matter.
- Bigger size increases defense/reserves but should imply higher metabolism.
- High speed, defense, attack, perception, toxicity, or fertility should have tradeoffs.
- Make species varied, visually memorable, and mechanically fair.
`;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Gemini did not return JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

async function generateSpecies(body) {
  if (!config.geminiApiKey) throw new Error("Missing Gemini API key.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${config.geminiApiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildSpeciesPrompt(body) }] }],
      generationConfig: {
        temperature: 0.95,
        responseMimeType: "application/json"
      }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gemini request failed.");
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  const parsed = extractJson(text);
  return Array.isArray(parsed.species) ? parsed.species.slice(0, MAX_SPECIES_PER_REQUEST) : [];
}

async function generateImage(prompt, mode) {
  if (!config.togetherApiKey) throw new Error("Missing Together/Flux API key.");
  const response = await fetch("https://api.together.xyz/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.togetherApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "black-forest-labs/FLUX.1-schnell",
      prompt,
      steps: 4,
      n: 1,
      response_format: "url",
      aspect_ratio: mode === "sprite" ? "1:1" : "4:3"
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Together image request failed.");
  return data.data?.[0]?.url || "";
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
        images.push(await generateImage(String(item.prompt || ""), item.mode));
      }
      sendJson(res, 200, { images });
      return;
    }
    sendJson(res, 404, { error: "Unknown API route." });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const target = resolve(join(root, pathname));
  if (!target.startsWith(root) || target.endsWith("config.local.json")) {
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

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(5173, "127.0.0.1", () => {
  console.log("Evolucion acuatica: http://127.0.0.1:5173");
});
