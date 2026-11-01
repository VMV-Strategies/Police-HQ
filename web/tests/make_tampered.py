"""Writes two damaged copies of a content package for the web e2e test:
tamper-file.phqpkg (one byte of a stored PDF flipped -> hash mismatch) and
tamper-manifest.phqpkg (one byte of the manifest flipped -> signature invalid).
Usage: python3 make_tampered.py <package.phqpkg> <out-dir>"""
import json, struct, sys
from pathlib import Path
src, out = Path(sys.argv[1]), Path(sys.argv[2])
raw = bytearray(src.read_bytes())
n = struct.unpack(">Q", raw[8:16])[0]
idx = json.loads(raw[16:16 + n]); base = 16 + n
e = next(x for x in idx["entries"] if x["path"].endswith(".pdf") and x["compression"] == "none")
a = bytearray(raw); a[base + e["offset"] + e["length"] // 2] ^= 0xFF
(out / "tamper-file.phqpkg").write_bytes(a)
m = idx["entries"][0]; b = bytearray(raw); b[base + m["offset"] + 40] ^= 0x01
(out / "tamper-manifest.phqpkg").write_bytes(b)
print("wrote", out / "tamper-file.phqpkg", out / "tamper-manifest.phqpkg")
