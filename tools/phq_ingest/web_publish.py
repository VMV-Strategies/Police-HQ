"""Publish a signed content package for the home-screen web app.

Splits the .phqpkg into parts small enough for GitHub's web uploader (25 MB per file)
and writes web/content/latest.json, which the app reads to download and reassemble it.
The parts are not trusted on their own: the app joins them and then applies the full
signature, schema and per-file hash verification, exactly as for a file import.

Usage (from tools/):
    python -m phq_ingest.web_publish --pkg ../dist/PoliceHQ-2026.11.01.phqpkg --out ../web/content

Publishing puts the package on a public website when the repository and its Pages site
are public. See docs/REDISTRIBUTION.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .package import read_container, extract_entry

PART_SIZE = 20 * 1024 * 1024  # stays under GitHub's 25 MB browser-upload limit


def publish(pkg: Path, out: Path, part_size: int = PART_SIZE) -> dict:
    index, raw, base = read_container(pkg)
    entries = {e["path"]: e for e in index["entries"]}
    manifest = json.loads(extract_entry(raw, base, entries["manifest.json"]))
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("package.part*"):
        old.unlink()
    parts = []
    for i in range(0, len(raw), part_size):
        chunk = raw[i:i + part_size]
        name = f"package.part{len(parts) + 1:02d}"
        (out / name).write_bytes(chunk)
        parts.append({"path": name, "size": len(chunk), "sha256": hashlib.sha256(chunk).hexdigest()})
    latest = {
        "format": "phq-web-content",
        "package_version": manifest["package_version"],
        "signing_key_id": manifest.get("signing_key_id"),
        "file": pkg.name,
        "size": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "published_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "parts": parts,
    }
    (out / "latest.json").write_text(json.dumps(latest, indent=1) + "\n")
    return latest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pkg", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--part-mb", type=int, default=20)
    a = ap.parse_args()
    m = publish(a.pkg, a.out, a.part_mb * 1024 * 1024)
    print(f"published {m['package_version']} as {len(m['parts'])} parts in {a.out}")


if __name__ == "__main__":
    main()
