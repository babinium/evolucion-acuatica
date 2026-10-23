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
import math
import re
from generation_cache import GenerationCache, canonical_json

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.local.json"
MAX_SPECIES_PER_TYPE = 4
MAX_SPECIES_PER_REQUEST = MAX_SPECIES_PER_TYPE * 3
MAX_IMAGE_BYTES = 8 * 1024 * 1024
GOOGLE_API = "https://generativelanguage.googleapis.com/v1beta/models/"
PROMPTS = json.loads((ROOT / "generation-prompts.json").read_text())
generation_cache = GenerationCache(ROOT / ".ai-cache")

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


def normalized_world(body):
    world = body.get("world") or {}
    def per_thousand(value, fallback):
        try:
            number = float(fallback if value is None else value)
            if not math.isfinite(number):
                number = fallback
            return math.floor(max(0, min(1, number)) * 1000 + 0.5)
        except (ValueError, TypeError):
            return math.floor(fallback * 1000 + 0.5)
    return {"chaos": per_thousand(world.get("chaos"), 0.55), "mutationRate": per_thousand(world.get("mutationRate"), 0.09)}


def build_species_prompt(body):
    counts = f"{clamp_count(body.get('producers', 0))} producer, {clamp_count(body.get('herbivores', 0))} herbivore, {clamp_count(body.get('carnivores', 0))} carnivore"
    return PROMPTS["species"].replace("$COUNTS", counts).replace("$WORLD", canonical_json(normalized_world(body)))


def thinking_config(model):
    if model.startswith("gemini-3") and "flash-lite" in model:
        return {"thinkingConfig": {"thinkingLevel": "MINIMAL", "includeThoughts": False}}
    if model.startswith("gemini-3"):
        return {"thinkingConfig": {"thinkingLevel": "LOW", "includeThoughts": False}}
    return {}


def usage_of(data):
    usage = data.get("usageMetadata") or {}
    return {key: usage.get(key) if isinstance(usage.get(key), (int, float)) else None
            for key in ("promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount")}


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



def provider_error(provider, status, data):
    error = data.get("error", {})
    message = error if isinstance(error, str) else error.get("message", "La solicitud falló.")
    raise ApiError(google_error(status, message), status)


def google_error(status, message):
    safe = str(message).replace(CONFIG.get("geminiApiKey") or "\x00", "[clave oculta]")[:800]
    if status == 429:
        if "free_tier" in safe.lower() and re.search(r"limit:\s*0", safe, re.I):
            return "Google HTTP 429: este modelo tiene cuota 0 en el nivel gratuito del proyecto de esta clave. Revisá la facturación de ese mismo proyecto en Google AI Studio. No se reenvió la solicitud."
        return "Google HTTP 429: se alcanzó una cuota de solicitudes o tokens. Revisá los límites, el saldo y la facturación del proyecto. No se reenvió la solicitud."
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
    return f"Google HTTP {status}: {safe[:180]} {help_text}"


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
    total = sum(clamp_count(body.get(key, 0)) for key in ("producers", "herbivores", "carnivores"))
    if not total:
        raise ApiError("Elegí al menos una especie.", 400)
    model = CONFIG.get("geminiModel") or "gemini-3.1-flash-lite"
    payload = {"contents": [{"parts": [{"text": build_species_prompt(body)}]}], "generationConfig": {
        "temperature": 0.85, "candidateCount": 1, "maxOutputTokens": min(4096, 256 + 320 * total),
        "responseMimeType": "application/json", **thinking_config(model),
    }}
    def generate():
        status, data = post_json(f"{GOOGLE_API}{quote(model, safe='')}:generateContent", payload, {"x-goog-api-key": CONFIG["geminiApiKey"]})
        if status >= 400:
            provider_error("Google", status, data)
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
        try:
            parsed = extract_json(text)
        except (ValueError, TypeError):
            raise ApiError("Google no devolvió un JSON válido de especies. No se reenvió la solicitud.", 422)
        species = parsed.get("species") if isinstance(parsed, dict) else None
        if not isinstance(species, list):
            raise ApiError("Google no devolvió especies válidas.", 422)
        valid = [sp for sp in species if isinstance(sp, dict) and isinstance(sp.get("name"), str)
                 and sp.get("class") in ("producer", "herbivore", "carnivore")][:MAX_SPECIES_PER_REQUEST]
        if not valid:
            raise ApiError("Google no devolvió especies válidas.", 422)
        for key, species_class in (("producers", "producer"), ("herbivores", "herbivore"), ("carnivores", "carnivore")):
            if sum(sp["class"] == species_class for sp in valid) != clamp_count(body.get(key, 0)):
                raise ApiError("Google devolvió cantidades de especies distintas de las pedidas. No se generaron imágenes.", 422)
        return {"value": valid, "usage": usage_of(data)}
    return generation_cache.get_or_create("species", {"model": model, "payload": payload}, generate, fresh=body.get("fresh") is True)["value"]


def build_image_prompt(prompt):
    return PROMPTS["image"].replace("$APPEARANCE", prompt)


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
        "generationConfig": {"responseModalities": ["IMAGE"], "candidateCount": 1, "maxOutputTokens": 4096,
                             "imageConfig": {"aspectRatio": "1:1", "imageSize": size}, **thinking_config(settings["geminiImageModel"])},
    }
    def generate():
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
        return {"value": f"data:{mime};base64,{encoded}", "usage": usage_of(data)}
    return generation_cache.get_or_create("image", {"model": settings["geminiImageModel"], "payload": payload}, generate)["value"]


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
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            allowed = (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")
            if host not in allowed or self.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and origin != f"http://{host}"):
                raise ApiError("Las acciones de IA solo se aceptan desde este juego local.", 403)
            body = self._read_json()
            if self.path == "/api/check-google":
                self._json(200, check_google())
                return
            if self.path == "/api/generate-species":
                self._json(200, {"species": generate_species(body)})
                return
            if self.path == "/api/generate-images":
                self._json(200, {"image": generate_image(body.get("prompt"))})
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
        if any(part.startswith(".") or part.lower().startswith("config.local")
               for part in (*Path(rel).parts, *target.relative_to(ROOT).parts)):
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
