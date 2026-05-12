from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import mimetypes
import urllib.request
import urllib.error
import base64
import time

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.local.json"
MAX_SPECIES_PER_REQUEST = 18
MAX_IMAGES_PER_REQUEST = 2

if CONFIG_PATH.exists():
    CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
else:
    CONFIG = {"togetherApiKey": "", "geminiApiKey": ""}


def config_status():
    has_gemini = bool(CONFIG.get("geminiApiKey"))
    has_together = bool(CONFIG.get("togetherApiKey"))
    missing = []
    if not has_gemini:
        missing.append("geminiApiKey")
    if not has_together:
        missing.append("togetherApiKey")
    return {
        "configFile": CONFIG_PATH.name,
        "hasGeminiApiKey": has_gemini,
        "hasTogetherApiKey": has_together,
        "missing": missing,
        "canUseAiText": has_gemini,
        "canUseAiImages": has_gemini and has_together,
    }


def clamp_count(value):
    try:
        return max(0, min(MAX_SPECIES_PER_REQUEST, int(value)))
    except Exception:
        return 0


def post_json(url, payload, headers=None):
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
        with urllib.request.urlopen(req, timeout=90) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode("utf-8"))
        except Exception:
            body = {"error": {"message": str(error)}}
        return error.code, body
    except urllib.error.URLError as error:
        return 599, {"error": {"message": str(error)}}


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
        "speed": "producers 0-2, herbivores 1-10, carnivores 6-10",
        "attack": 0-10,
        "defense": 0-10,
        "perception": 1-10,
        "fertility": "producers 10-30, herbivores/carnivores 5-20",
        "metabolism": 1-10,
        "foodEfficiency": 1-10,
        "toxicity": 0-10
      }},
      "portraitPrompt": "English prompt for detailed isolated scientific aquatic creature illustration, clean white background, no text",
      "spritePrompt": "English prompt for simple filled top-down game sprite of the same species, isolated solid chroma blue background, no text, head facing right"
    }}
  ]
}}

Balance rules:
- Producers have attack 0, low speed, use nutrients/light, may have toxicity or defense.
- Producers should start with fertility between 10 and 30.
- Herbivores and carnivores should start with fertility between 5 and 20.
- Producers may have high fertility too; the game limits them by local crowding and energy.
- Herbivores have attack 0, can have defense, speed, perception, toxicity.
- Carnivores can eat herbivores and other carnivores; attack, speed, size and perception matter.
- Carnivores must start fast enough to hunt: speed should be between 6 and 10.
- Bigger size increases defense/reserves but should imply higher metabolism.
- High speed, defense, attack, perception, toxicity, or fertility should have tradeoffs.
- Make species varied, visually memorable, and mechanically fair.
- Portrait prompt must use a clean white background because it is shown directly in the selection panel.
- Sprite prompt must use a solid chroma blue background (#0047ff) so the game can remove it safely.
- Sprite prompt must say the creature is viewed from above and its head/front faces exactly to the right.
- Sprite prompt must request a filled colored body, not line art, not outline-only, thick readable silhouette, no transparency, no hollow interior, avoid blue body colors.
"""


def extract_json(text):
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Gemini did not return JSON.")
    return json.loads(text[start : end + 1])


def generate_species(body):
    key = CONFIG.get("geminiApiKey")
    if not key:
        raise RuntimeError("Missing Gemini API key.")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={key}"
    status, data = post_json(
        url,
        {
            "contents": [{"parts": [{"text": build_species_prompt(body)}]}],
            "generationConfig": {
                "temperature": 0.95,
                "responseMimeType": "application/json",
            },
        },
    )
    if status >= 400:
        message = data.get("error", {}).get("message", "Gemini request failed.")
        raise RuntimeError(f"Gemini HTTP {status}: {message}")
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts)
    parsed = extract_json(text)
    return parsed.get("species", [])[:MAX_SPECIES_PER_REQUEST]


def generate_image(prompt, mode):
    key = CONFIG.get("togetherApiKey")
    if not key:
        raise RuntimeError("Missing Together/Flux API key.")
    status, data = post_json(
        "https://api.together.ai/v1/images/generations",
        {
            "model": "black-forest-labs/FLUX.1-schnell",
            "prompt": prompt,
            "steps": 4,
            "n": 1,
            "response_format": "url",
            "aspect_ratio": "1:1" if mode == "sprite" else "4:3",
        },
        {"Authorization": f"Bearer {key}"},
    )
    if status >= 400:
        message = data.get("error", {}).get("message", "Together image request failed.")
        raise RuntimeError(f"Together/Flux HTTP {status}: {message}")
    image_url = data.get("data", [{}])[0].get("url", "")
    if not image_url:
        return ""
    image_req = urllib.request.Request(
        image_url,
        headers={"User-Agent": "evolucion-local/0.1"},
    )
    with urllib.request.urlopen(image_req, timeout=90) as response:
        raw = response.read()
        content_type = response.headers.get("Content-Type", "image/png").split(";")[0]
    encoded = base64.b64encode(raw).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def generate_image_with_retry(prompt, mode):
    last_error = None
    for attempt in range(3):
        try:
            if attempt:
                time.sleep(8 * attempt)
            return generate_image(prompt, mode)
        except RuntimeError as error:
            last_error = error
            if not any(code in str(error) for code in ("HTTP 429", "HTTP 500", "HTTP 502", "HTTP 503", "HTTP 504")):
                raise
    raise last_error


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
            if self.path == "/api/generate-species":
                self._json(200, {"species": generate_species(body)})
                return
            if self.path == "/api/generate-images":
                prompts = body.get("prompts", [])[:MAX_IMAGES_PER_REQUEST]
                images = []
                for index, item in enumerate(prompts):
                    if index:
                        time.sleep(2.0)
                    images.append(generate_image_with_retry(str(item.get("prompt", "")), item.get("mode")))
                self._json(200, {"images": images})
                return
            self._json(404, {"error": "Unknown API route."})
        except Exception as error:
            self._json(500, {"error": str(error)})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/config-status":
            self._json(200, config_status())
            return
        rel = "index.html" if parsed.path == "/" else parsed.path.lstrip("/")
        target = (ROOT / rel).resolve()
        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if target.name == "config.local.json":
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
