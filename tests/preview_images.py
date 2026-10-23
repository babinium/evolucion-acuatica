"""Local visual fixture: real UI and API parsing + synthetic provider responses.

Run: python3 tests/preview_images.py, then open http://127.0.0.1:5174.
Uses a separate origin so it cannot overwrite the normal game's saved world.
"""
import base64
import math
import json
import struct
import sys
import zlib
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def png_fixture(kind):
    size = 512
    rows = bytearray()
    leaves = [(math.cos(a * math.pi / 3), math.sin(a * math.pi / 3)) for a in range(6)]
    for y in range(size):
        rows.append(0)
        for x in range(size):
            u, v = x / 2, y / 2
            color = (255, 0, 255)
            if kind == "producer":
                for cosine, sine in leaves:
                    rx = (u - 128) * cosine + (v - 128) * sine
                    ry = -(u - 128) * sine + (v - 128) * cosine
                    if ((rx - 33) / 50) ** 2 + (ry / 17) ** 2 <= 1:
                        color = (65, 172, 104) if ry < 0 else (104, 202, 137)
                if (u - 128) ** 2 + (v - 128) ** 2 < 13 ** 2:
                    color = (230, 205, 105)
            else:
                body = (31, 161, 222) if kind == "herbivore" else (236, 125, 62)
                if 32 <= u <= 91 and abs(v - 128) <= (91 - u) * 0.52:
                    color = body
                if 107 <= u <= 165 and 77 <= v <= 128 and v >= 77 + abs(u - 132) * 0.8:
                    color = (36, 114, 170) if kind == "herbivore" else (170, 75, 48)
                if ((u - 139) / 75) ** 2 + ((v - 128) / 36) ** 2 < 1:
                    color = body if v < 132 else tuple(min(255, c + 25) for c in body)
                if (u - 188) ** 2 + (v - 119) ** 2 < 6 ** 2:
                    color = (245, 247, 224)
                if (u - 190) ** 2 + (v - 119) ** 2 < 3 ** 2:
                    color = (12, 30, 43)
            rows.extend(color)
    def chunk(name, data):
        return struct.pack("!I", len(data)) + name + data + struct.pack("!I", zlib.crc32(name + data))
    raw = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", size, size, 8, 2, 0, 0, 0))
    raw += chunk(b"IDAT", zlib.compress(bytes(rows))) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(raw).decode()


def species_fixture(body):
    result = []
    for key, kind, name in (("producers", "producer", "Alga de prueba"), ("herbivores", "herbivore", "Nadador azul de prueba"), ("carnivores", "carnivore", "Cazador de prueba")):
        for i in range(server.clamp_count(body.get(key, 0))):
            result.append({"name": f"{name} {i+1}", "class": kind,
                           "description": "Ilustración sintética para comprobar recorte, orientación y escala. No se llamó a Google.",
                           "visualDescription": kind, "habitat": "Aguas medias",
                           "traits": {"size": 5, "speed": 8 if kind == "carnivore" else 5, "attack": 6 if kind == "carnivore" else 0,
                                      "defense": 4, "perception": 6, "fertility": 14, "metabolism": 4, "foodEfficiency": 6, "toxicity": 0}})
    return result


class PreviewHandler(server.Handler):
    def do_GET(self):
        if self.path.split("?")[0] == "/":
            html = (server.ROOT / "index.html").read_text()
            banner = '<aside style="position:fixed;bottom:80px;right:12px;z-index:9999;background:#3b2948;color:white;padding:7px 12px;border-radius:6px;font:12px sans-serif">PRUEBA VISUAL · Imágenes sintéticas · Sin gasto de API</aside>'
            raw = html.replace("</body>", banner + "</body>").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        super().do_GET()


if __name__ == "__main__":
    server.CONFIG.clear()
    server.CONFIG.update(aiProvider="openrouter", openrouterApiKey="synthetic-fixture-no-real-key")
    cache = tempfile.TemporaryDirectory(prefix="evo-visual-cache-")
    server.generation_cache = server.GenerationCache(cache.name)
    images = {kind: png_fixture(kind) for kind in ("producer", "herbivore", "carnivore")}
    def synthetic_provider(url, payload, headers=None, **kwargs):
        if url == server.OPENROUTER_API + "chat/completions":
            slots = payload["response_format"]["json_schema"]["schema"]["properties"]["species"]["required"]
            counts = {key: sum(slot.startswith(kind + "_") for slot in slots)
                      for key, kind in (("producers", "producer"), ("herbivores", "herbivore"), ("carnivores", "carnivore"))}
            species = {}
            for slot, sp in zip(slots, species_fixture(counts)):
                species[slot] = {key: sp[key] for key in server.SPECIES_SCHEMA["required"]}
            return 200, {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"species": species})}}]}
        if url == server.OPENROUTER_API + "images":
            kind = next((kind for kind in images if f"Species type: {kind}" in payload["prompt"]), "herbivore")
            return 200, {"data": [{"b64_json": images[kind].split(",", 1)[1], "media_type": "image/png"}]}
        raise RuntimeError("La prueba recibió una solicitud no prevista.")
    server.post_json = synthetic_provider
    server.check_provider = lambda: {"ok": True, "message": "Prueba visual: no se consultó a ningún proveedor ni se consumió saldo."}
    # Make accidental real network calls impossible in this fixture server.
    def offline(*args, **kwargs):
        raise RuntimeError("Esta prueba no permite conexiones con proveedores.")
    server.urllib.request.urlopen = offline
    print("Prueba visual sin gasto de API: http://127.0.0.1:5174", flush=True)
    server.ThreadingHTTPServer(("127.0.0.1", 5174), PreviewHandler).serve_forever()
