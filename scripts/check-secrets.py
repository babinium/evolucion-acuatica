#!/usr/bin/env python3
"""Reject private files and credential literals without printing their values."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

GOOGLE_KEY = re.compile(rb"AIza[0-9A-Za-z_-]{35}")
OPENROUTER_KEY = re.compile(rb"sk-or-v1-[0-9A-Za-z_-]{20,}")
KEY_FIELD = re.compile(rb'''["'](?:geminiApiKey|openrouterApiKey|togetherApiKey|api_key|apiKey)["']\s*:\s*["']([^"'\r\n]{12,})["']''')
PLACEHOLDER = re.compile(rb"^(?:tu[-_]|your[-_]|test[-_]|fake[-_]|dummy[-_]|pega[_ -]|pon[_ -]|reemplaza[_ -]|paste[_ -]|example|placeholder|synthetic-fixture)", re.I)


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def private_path(path):
    parts = Path(path).parts
    return any(part in (".ai-cache", ".local-tools") or part.startswith(".env") and part != ".env.example"
               or part.startswith("config.local") and part != "config.local.example.json" for part in parts)


def local_keys():
    keys = []
    path = Path("config.local.json")
    if path.exists():
        try:
            config = json.loads(path.read_text())
            keys += [value.encode() for key, value in config.items() if "key" in key.lower()
                     and isinstance(value, str) and len(value.strip()) >= 12 and not PLACEHOLDER.match(value.encode())]
        except (OSError, ValueError):
            pass
    for variable in ("GEMINI_API_KEY", "OPENROUTER_API_KEY"):
        key = os.environ.get(variable, "")
        if len(key) >= 12:
            keys.append(key.encode())
    return keys


def has_secret(data, keys):
    if GOOGLE_KEY.search(data) or OPENROUTER_KEY.search(data) or any(key in data for key in keys):
        return True
    return any(not PLACEHOLDER.match(match.group(1)) for match in KEY_FIELD.finditer(data))


def check_current(staged, keys):
    names = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z") if staged else git("ls-files", "-z")
    problems = []
    for raw in filter(None, names.split(b"\0")):
        name = os.fsdecode(raw)
        path = Path(name)
        if private_path(name):
            problems.append((name, "archivo privado"))
        try:
            data = git("show", ":" + name) if staged else path.read_bytes()
        except (OSError, subprocess.CalledProcessError):
            continue
        if has_secret(data, keys):
            problems.append((name, "posible credencial"))
    return problems


def check_history(keys):
    # Read blobs through a pipe; never pass a secret as a command argument or
    # print matching lines. Include all fetched branches and tags.
    objects = {}
    private = set()
    for line in git("rev-list", "--objects", "--all").splitlines():
        oid, _, raw = line.partition(b" ")
        if not raw:
            continue
        name = os.fsdecode(raw)
        objects.setdefault(oid, name)
        if private_path(name):
            private.add((name, "archivo privado en historial"))
    problems = list(private)
    process = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        for oid, name in objects.items():
            process.stdin.write(oid + b"\n")
            process.stdin.flush()
            header = process.stdout.readline().split()
            if len(header) != 3:
                continue
            size = int(header[2])
            data = process.stdout.read(size)
            process.stdout.read(1)
            if header[1] == b"blob" and has_secret(data, keys):
                problems.append((name, "posible credencial en historial"))
    finally:
        process.stdin.close()
        process.wait()
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true")
    parser.add_argument("--history", action="store_true")
    args = parser.parse_args()
    os.chdir(os.fsdecode(git("rev-parse", "--show-toplevel").strip()))
    keys = local_keys()
    problems = check_current(args.staged, keys)
    if args.history:
        problems += check_history(keys)
    if problems:
        for path, reason in sorted(set(problems)):
            print(f"BLOQUEADO: {path} — {reason}. Valor oculto.", file=sys.stderr)
        return 1
    print("Credenciales: no se detectaron claves ni archivos privados en lo revisado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
