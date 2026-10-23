from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, quote, unquote
import json
import os
import base64
import binascii
import mimetypes
import urllib.request
import urllib.error
import time

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.local.json"
MAX_SPECIES_PER_TYPE = 4
MAX_SPECIES_PER_REQUEST = MAX_SPECIES_PER_TYPE * 3
MAX_IMAGE_BYTES = 8 * 1024 * 1024
GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models/"

if CONFIG_PATH.exists():
    CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
else:
    CONFIG = {"geminiApiKey": ""}
if os.environ.get("GEMINI_API_KEY"):
    CONFIG["geminiApiKey"] = os.environ["GEMINI_API_KEY"]


def config_status():
    has_gemini = bool(CONFIG.get("geminiApiKey"))
    return {
        "configFile": CONFIG_PATH.name,
        "provider": "google",
        "hasGeminiApiKey": has_gemini,
        "missing": [] if has_gemini else ["geminiApiKey"],
        "canUseAiText": has_gemini,
        "canUseAiImages": has_gemini,
        "geminiModel": CONFIG.get("geminiModel") or "gemini-3.1-flash-lite",
        "geminiImageModel": CONFIG.get("geminiImageModel") or "gemini-3.1-flash-image",
        "geminiImageSize": CONFIG.get("geminiImageSize") or "512",
    }


def clamp_count(value):
    try:
        return max(0, min(MAX_SPECIES_PER_TYPE, int(value)))
    except Exception:
        return 0


def post_json(url, payload, headers=None, timeout=60):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "evolucion-local/0.1",
            **(headers or {}),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except Exception:
            body = {"error": {"message": str(error)}}
        return error.code, body
    except (urllib.error.URLError, TimeoutError):
        return 504, {"error": {"message": "No se pudo conectar o se agotó el tiempo de espera."}}


def build_species_prompt(body):
    producers = clamp_count(body.get("producers", 0))
    herbivores = clamp_count(body.get("herbivores", 0))
    carnivores = clamp_count(body.get("carnivores", 0))
    total = producers + herbivores + carnivores
    world = json.dumps(body.get("world", {}), ensure_ascii=False)
    return f"""
Create {total} original aquatic ecosystem species for a survival/evolution simulation.
Counts: {producers} producers, {herbivores} herbivores, {carnivores} carnivores.
World settings: {world}

Return ONLY valid JSON, no markdown. Use this schema:
{{
  "species": [
    {{
      "name": "Spanish common/species name",
      "class": "producer|herbivore|carnivore",
      "description": "short biological description in Spanish",
      "visualDescription": "short visual description in Spanish",
      "diet": "what it eats in Spanish",
      "habitat": "preferred aquatic zone in Spanish",
      "behavior": "short behavior in Spanish",
      "strengths": ["Spanish text"],
      "weaknesses": ["Spanish text"],
      "traits": {{
        "size": 1-10,
        "speed": "producers 0, herbivores 1-10, carnivores 6-10",
        "attack": 0-10,
        "defense": 0-10,
        "perception": 1-10,
        "fertility": "producers 10-30, herbivores/carnivores 5-20",
        "metabolism": 1-10,
        "foodEfficiency": 1-10,
        "toxicity": 0-10
      }},
      "spritePrompt": "English description of this species' body, colors, fins and distinctive features. A single top-down game creature, head right. Do not describe a background."
    }}
  ]
}}

Balance rules:
- Producers have attack 0 and speed 0; they are anchored and use light plus shared local nutrients.
- Producers should start with fertility between 10 and 30.
- Herbivores and carnivores should start with fertility between 5 and 20.
- Producers may have high fertility too; the game limits them by local crowding and energy.
- Herbivores have attack 0, can have defense, speed, perception, toxicity.
- Carnivores can eat herbivores and other carnivores; attack, speed, size and perception matter.
- Carnivores must start fast enough to hunt: speed should be between 6 and 10.
- Bigger size increases health and energy reserves, costs upkeep and reduces agility. Metabolism is a separate tradeoff.
- High metabolism accelerates activity and digestion/photosynthesis but increases energy and oxygen demand and aging.
- Perception extends animal senses and improves nutrient uptake in producers. Carnivores should start with perception 5-9.
- Efficiency improves assimilation, body toxins poison consumers, and defense reduces damage; all cost energy to maintain.
- Fertility affects birth opportunities and recovery time. Every baby costs the parent both reserves and edible tissue.
- High speed, defense, attack, perception, toxicity, or fertility should have tradeoffs. Avoid maximizing every trait.
- Make species varied, visually memorable, and mechanically fair.
- Sprite prompt must say the creature is viewed from above and its head/front faces exactly to the right.
- Sprite prompt must describe an opaque filled body, sturdy fins and a clear silhouette, with no background or scenery.
"""


def extract_json(text):
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Gemini did not return JSON.")
    return json.loads(text[start : end + 1])


class ApiError(RuntimeError):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def retry_request(operation, sleep=None):
    sleep = sleep or time.sleep
    for attempt in range(3):
        try:
            return operation()
        except ApiError as error:
            if attempt == 2 or error.status not in (429, 500, 502, 503, 504):
                raise
            sleep(1.5 * 2 ** attempt)


def provider_error(provider, status, data):
    error = data.get("error", {})
    message = error if isinstance(error, str) else error.get("message", "La solicitud falló.")
    raise ApiError(google_error(status, message), status)


def google_error(status, message):
    safe = str(message).replace(CONFIG.get("geminiApiKey") or "\x00", "[clave oculta]")[:800]
    if status == 400:
        help_text = "Revisá la clave, el modelo y su configuración."
    elif status in (401, 403):
        help_text = "Revisá la clave y sus permisos para la API de Gemini."
    elif status == 404:
        help_text = "El modelo no está disponible: revisá geminiModel o geminiImageModel."
    elif status == 429:
        help_text = "Revisá la cuota y la facturación del proyecto en Google AI Studio."
    else:
        help_text = "Podés volver a intentar más tarde."
    return f"Google HTTP {status}: {safe} {help_text}"


def require_google_key():
    if not CONFIG.get("geminiApiKey"):
        raise ApiError("Agregá geminiApiKey en config.local.json o GEMINI_API_KEY para usar Google.", 400)


def check_google():
    require_google_key()
    settings = config_status()
    for model in dict.fromkeys((settings["geminiModel"], settings["geminiImageModel"])):
        req = urllib.request.Request(GOOGLE_API + quote(model, safe=""), headers={"x-goog-api-key": CONFIG["geminiApiKey"]})
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                data = json.loads(error.read().decode("utf-8"))
            except Exception:
                data = {}
            provider_error("Google", error.code, data)
        except (urllib.error.URLError, TimeoutError):
            raise ApiError("No se pudo conectar con Google para comprobar los modelos.", 504)
        if "generateContent" not in data.get("supportedGenerationMethods", []):
            raise ApiError(f"El modelo {model} no admite generateContent. Revisá la configuración.", 400)
    return {"ok": True, "message": "Google responde y ambos modelos están disponibles. La cuota de imágenes se comprueba al generar."}


def generate_species(body):
    require_google_key()
    key = CONFIG.get("geminiApiKey")
    model = CONFIG.get("geminiModel") or "gemini-3.1-flash-lite"
    url = f"{GOOGLE_API}{quote(model, safe='')}:generateContent"

    def request():
        status, data = post_json(
            url,
            {"contents": [{"parts": [{"text": build_species_prompt(body)}]}],
             "generationConfig": {"temperature": 0.95, "responseMimeType": "application/json"}},
            {"x-goog-api-key": key},
        )
        if status >= 400:
            provider_error("Gemini", status, data)
        return data

    data = retry_request(request)
    candidates = data.get("candidates") or [{}]
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
    try:
        parsed = extract_json(text)
    except (ValueError, TypeError):
        raise ApiError("Gemini no devolvió un JSON válido de especies.")
    species = parsed.get("species", [])
    if not isinstance(species, list):
        raise ApiError("Gemini no devolvió especies válidas.")
    valid = [sp for sp in species if isinstance(sp, dict) and isinstance(sp.get("name"), str)
             and sp.get("class") in ("producer", "herbivore", "carnivore")][:MAX_SPECIES_PER_REQUEST]
    if not valid:
        raise ApiError("Gemini no devolvió especies válidas.")
    for key, species_class in (("producers", "producer"), ("herbivores", "herbivore"), ("carnivores", "carnivore")):
        if sum(sp["class"] == species_class for sp in valid) != clamp_count(body.get(key, 0)):
            raise ApiError("Google devolvió cantidades de especies distintas de las pedidas. No se generaron imágenes.", 422)
    return valid


def build_image_prompt(prompt):
    return f"""Create exactly ONE aquatic species illustration for a small 2D ecosystem game.
Species appearance: {prompt}
Mandatory asset format (override any conflicting background or framing in the description):
- Exactly one specimen, orthographic dorsal TOP-DOWN view, not side view, not isometric.
- Animal head/front points exactly RIGHT, tail/back LEFT. Plants are a compact anchored colony viewed from above.
- Opaque filled colored body, clear silhouette, readable at 32 pixels; limited detail and sturdy fins.
- Entire specimen centered, all fins and appendages visible, at least 12% empty margin on every side.
- Flat perfectly uniform chroma MAGENTA background (#ff00ff). The body must not contain magenta or pink. Blue, cyan and green bodies are allowed.
- No transparency, checkerboard, gradients, glow, shadows, water, scenery, floor, rocks, props, labels, text, frame, watermark or multiple views.
- This exact illustration will also be shown enlarged as the species portrait. Return the image only."""


def generate_image(prompt):
    require_google_key()
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 10000:
        raise ApiError("Falta una descripción de imagen válida (máximo 10000 caracteres).", 400)
    settings = config_status()
    size = settings["geminiImageSize"]
    if size not in ("512", "1K"):
        raise ApiError("geminiImageSize debe ser 512 o 1K para este juego.", 400)
    payload = {
        "contents": [{"parts": [{"text": build_image_prompt(prompt)}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "1:1", "imageSize": size}},
    }
    status, data = post_json(
        f"{GOOGLE_API}{quote(settings['geminiImageModel'], safe='')}:generateContent", payload,
        {"x-goog-api-key": CONFIG["geminiApiKey"]}, timeout=90,
    )
    if status >= 400:
        provider_error("Google", status, data)
    candidate = (data.get("candidates") or [{}])[0]
    parts = candidate.get("content", {}).get("parts", [])
    image = next((p["inlineData"] for p in parts if not p.get("thought") and p.get("inlineData", {}).get("mimeType", "").startswith("image/")), None)
    if not image or image.get("mimeType") not in ("image/png", "image/jpeg", "image/webp"):
        reason = data.get("promptFeedback", {}).get("blockReason") or candidate.get("finishReason") or "sin imagen"
        raise ApiError(f"Google no devolvió una imagen utilizable ({reason}). No se repetirá automáticamente.", 422)
    encoded = image.get("data")
    try:
        if not isinstance(encoded, str) or not encoded or len(encoded) > MAX_IMAGE_BYTES * 4 / 3 + 4:
            raise ValueError()
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ApiError("Google devolvió datos de imagen inválidos o demasiado grandes.", 422)
    mime = image["mimeType"]
    valid = (raw.startswith(b"\x89PNG\r\n\x1a\n") if mime == "image/png" else
             raw.startswith(b"\xff\xd8\xff") if mime == "image/jpeg" else
             raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")
    if not valid:
        raise ApiError("Google devolvió una imagen con formato inválido.", 422)
    return f"data:{mime};base64,{encoded}"


def generate_image_with_retry(prompt):
    return retry_request(lambda: generate_image(prompt))


class Handler(BaseHTTPRequestHandler):
    def _json(self, status, body):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_POST(self):
        try:
            body = self._read_json()
            if self.path == "/api/check-google":
                self._json(200, check_google())
                return
            if self.path == "/api/generate-species":
                self._json(200, {"species": generate_species(body)})
                return
            if self.path == "/api/generate-images":
                self._json(200, {"image": generate_image_with_retry(body.get("prompt"))})
                return
            self._json(404, {"error": "Unknown API route."})
        except Exception as error:
            self._json(getattr(error, "status", 500), {"error": str(error)})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/config-status":
            self._json(200, config_status())
            return
        rel = "index.html" if parsed.path == "/" else unquote(parsed.path).lstrip("/")
        target = (ROOT / rel).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if target.name == "config.local.json" or any(part.startswith(".") for part in Path(rel).parts):
            self.send_error(403)
            return
        if not target.exists() or not target.is_file():
            self.send_error(404)
            return
        content = target.read_bytes()
        mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            mime = "text/javascript"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5173), Handler)
    print("Evolucion acuatica: http://127.0.0.1:5173")
    server.serve_forever()
