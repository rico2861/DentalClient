"""Fonctions communes aux outils d'exploitation DENTAL (bibliothèque standard uniquement)."""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND = PROJECT_ROOT / "backend"


def load_env(path: Path | None = None) -> dict[str, str]:
    """Lit backend/.env ; les variables d'environnement déjà définies restent prioritaires."""
    env: dict[str, str] = {}
    f = path or BACKEND / ".env"
    if f.exists():
        for raw in f.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k in list(env) + ["DATABASE_URL", "STORAGE_DIR"]:
        if k in os.environ:
            env[k] = os.environ[k]
    return env


def database_url(env: dict[str, str]) -> str:
    url = env.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL introuvable (backend/.env ou variable d'environnement).")
    return url


def storage_dir(env: dict[str, str]) -> Path:
    raw = env.get("STORAGE_DIR")
    return (BACKEND / raw).resolve() if raw else (BACKEND / "storage")


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        sys.exit(f"Outil « {name} » introuvable : installez les clients PostgreSQL (pg_dump, pg_restore, psql).")
    return path
