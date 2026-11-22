#!/usr/bin/env python3
"""Diagnostic de l'installation : configuration, base de données, dossier des documents.

Usage : python3 tools/check_env.py
Code de sortie 0 si tout est correct, 1 sinon.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.request

from _common import BACKEND, PROJECT_ROOT, load_env, storage_dir

ok_all = True


def check(label: str, ok: bool, detail: str = "") -> None:
    global ok_all
    ok_all &= ok
    print(f"[{'OK' if ok else 'KO'}] {label}{(' - ' + detail) if detail else ''}")


def main() -> int:
    env = load_env()
    check("backend/.env présent", (BACKEND / ".env").exists() or "DATABASE_URL" in os.environ)
    secret = env.get("JWT_SECRET", "")
    check("JWT_SECRET (64+ caractères recommandés)", len(secret) >= 32 and not secret.startswith("remplacez"), f"{len(secret)} car.")
    prod = env.get("NODE_ENV") == "production"
    check("OWNER_PASSWORD retiré du .env en production", not (prod and env.get("OWNER_PASSWORD")))

    docs = storage_dir(env)
    try:
        docs.mkdir(parents=True, exist_ok=True)
        probe = docs / ".write_test"
        probe.write_text("ok")
        probe.unlink()
        check("Dossier des documents inscriptible", True, str(docs))
    except OSError as e:
        check("Dossier des documents inscriptible", False, str(e))
    check("Dossier des documents hors du frontend", PROJECT_ROOT / "frontend" not in [docs, *docs.parents])

    url = env.get("DATABASE_URL")
    psql = shutil.which("psql")
    if url and psql:
        r = subprocess.run([psql, url, "-Atc", "select count(*) from schema_migrations"], capture_output=True, text=True)
        check("Base de données joignable et migrée", r.returncode == 0,
              f"{r.stdout.strip()} migration(s)" if r.returncode == 0 else r.stderr.strip()[:120])
    else:
        check("Client psql / DATABASE_URL", False, "psql ou DATABASE_URL manquant")

    port = env.get("PORT", "3000")
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/api/health", timeout=3) as resp:
            check("Serveur en ligne (/api/health)", json.load(resp).get("status") == "ok")
    except Exception:
        print(f"[--] Serveur non démarré sur le port {port} (normal si l'application est arrêtée)")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
