#!/usr/bin/env python3
"""Restauration d'une sauvegarde créée par backup.py.

Usage :
    python3 tools/restore.py --dump backups/dental_light_20260101_020000.dump \\
        [--documents backups/dental_light_documents_20260101_020000.tar.gz] --yes

ATTENTION : le contenu actuel de la base est REMPLACÉ. Arrêtez le serveur avant de restaurer.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from _common import database_url, load_env, require_tool, storage_dir


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dump", type=Path, required=True, help="fichier .dump (pg_dump format custom)")
    ap.add_argument("--documents", type=Path, help="archive .tar.gz des documents")
    ap.add_argument("--yes", action="store_true", help="confirme le remplacement des données actuelles")
    args = ap.parse_args()

    if not args.dump.is_file():
        sys.exit(f"Fichier introuvable : {args.dump}")
    if args.documents and not args.documents.is_file():
        sys.exit(f"Fichier introuvable : {args.documents}")
    if not args.yes:
        sys.exit("Opération destructive : relancez avec --yes pour confirmer.")

    env = load_env()
    url, docs = database_url(env), storage_dir(env)
    pg_restore = require_tool("pg_restore")

    print("-> Restauration de la base...")
    r = subprocess.run([pg_restore, "--clean", "--if-exists", "--no-owner", "--dbname", url, str(args.dump)])
    if r.returncode not in (0, 1):  # 1 = avertissements non bloquants (objets absents avant --clean)
        print("Échec de pg_restore.", file=sys.stderr)
        return 1

    if args.documents:
        print(f"-> Restauration des documents vers {docs}")
        with tempfile.TemporaryDirectory() as tmp:
            with tarfile.open(args.documents, "r:gz") as t:
                t.extractall(tmp, filter="data")
            if docs.exists():
                shutil.rmtree(docs)
            shutil.move(str(Path(tmp) / "storage"), str(docs))
    print("Restauration terminée.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
