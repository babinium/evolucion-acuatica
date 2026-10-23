"""Bounded local response cache shared with the Node server; no credentials."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class GenerationCache:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.lock = threading.Lock()

    def key(self, kind, request):
        return kind + "-" + hashlib.sha256((kind + "\n" + canonical_json(request)).encode()).hexdigest()

    def get(self, kind, request):
        return self.read(self.key(kind, request), kind)

    def read(self, key, kind):
        path = self.directory / (key + ".json")
        try:
            record = json.loads(path.read_text())
        except FileNotFoundError:
            return None
        if record.get("version") != 1 or record.get("kind") != kind or "value" not in record:
            raise ValueError("Caché de IA inválida.")
        try:
            path.touch()
        except OSError:
            pass
        return record

    def get_or_create(self, kind, request, generate, fresh=False):
        key = self.key(kind, request)
        # The local UI generates in series; a second tab must not duplicate it.
        with self.lock:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            path = self.directory / (key + ".json")
            if not fresh:
                record = self.read(key, kind)
                if record:
                    return record
            result = generate()
            record = {"version": 1, "kind": kind, "value": result["value"], "usage": result.get("usage")}
            temp = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.directory, delete=False, suffix=".tmp") as out:
                    temp = out.name
                    json.dump(record, out, ensure_ascii=False, separators=(",", ":"))
                os.replace(temp, path)
                self.trim()
            except OSError:
                if temp:
                    Path(temp).unlink(missing_ok=True)
                print("No se pudo conservar la generación en la caché local.")
            return record

    def trim(self):
        files = sorted(self.directory.glob("*-*.json"), key=lambda path: path.stat().st_mtime)
        total = sum(path.stat().st_size for path in files)
        while files and (len(files) > 128 or total > 64 * 1024 * 1024):
            oldest = files.pop(0)
            total -= oldest.stat().st_size
            oldest.unlink()
