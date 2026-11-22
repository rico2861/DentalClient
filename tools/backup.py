#!/usr/bin/env python3
"""Sauvegarde complète : base PostgreSQL (pg_dump) + documents privés (STORAGE_DIR).

Usage :
    python3 tools/backup.py                       # -> ./backups/
    python3 tools/backup.py --dest /mnt/sauvegardes --keep-days 30

À planifier (cron / planificateur de tâches) : la base et les documents
doivent être sauvegardés ensemble.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tarfile
import time
from datetime import datetime
from pathlib import Path

from _common import PROJECT_ROOT, database_url, load_env, require_tool, storage_dir


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", type=Path, default=PROJECT_ROOT / "backups", help="dossier de destination")
    ap.add_argument("--keep-days", type=int, default=30, help="supprime les sauvegardes plus anciennes (0 = tout garder)")
    args = ap.parse_args()

    env = load_env()
    url, docs = database_url(env), storage_dir(env)
    pg_dump = require_tool("pg_dump")
    args.dest.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    dump = args.dest / f"dental_light_{stamp}.dump"
    print(f"-> Base de données : {dump.name}")
    r = subprocess.run([pg_dump, "--format=custom", "--no-owner", "--file", str(dump), url])
    if r.returncode:
        dump.unlink(missing_ok=True)
        print("Échec de pg_dump.", file=sys.stderr)
        return 1

    archive = args.dest / f"dental_light_documents_{stamp}.tar.gz"
    if docs.exists() and any(docs.iterdir()):
        print(f"-> Documents       : {archive.name}")
        with tarfile.open(archive, "w:gz") as t:
            t.add(docs, arcname="storage")
    else:
        print("-> Documents       : dossier vide ou absent, ignoré")

    if args.keep_days > 0:
        limit = time.time() - args.keep_days * 86400
        for f in args.dest.glob("dental_light_*"):
            if f.is_file() and f.stat().st_mtime < limit:
                f.unlink()
                print(f"   ancienne sauvegarde supprimée : {f.name}")
    print("Sauvegarde terminée.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
