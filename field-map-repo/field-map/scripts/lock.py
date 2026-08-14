#!/usr/bin/env python3
"""
Encrypt the parcel into a built field-map.html, for publishing somewhere public.

This is the non-interactive half of "Map -> Backup & privacy -> Lock a copy".
The browser version in src/loader.js is still the one you use by hand; this one
exists so CI can publish a locked file without a human typing a passphrase into
a page first.

The format it writes is the format loader.js reads, and nothing here is a
second opinion about it: AES-256-GCM, PBKDF2-SHA256 at 310,000 rounds, 16-byte
salt, 12-byte IV, each base64, wrapped as {v,salt,iv,ct}. WebCrypto appends the
16-byte GCM tag to the ciphertext and so does AESGCM.encrypt, which is what
makes the two interoperable. If you change one side, --verify will tell you.

The passphrase comes from FIELDMAP_PASSPHRASE, never a command-line argument,
so it stays out of `ps` and out of shell history.

    FIELDMAP_PASSPHRASE=... python3 scripts/lock.py dist/field-map.html
    FIELDMAP_PASSPHRASE=... python3 scripts/lock.py dist/field-map.html -o _site/index.html
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
ITER = 310_000          # must match ITER in src/loader.js
BEGIN = "/*PARCEL_BEGIN*/"
END = "/*PARCEL_END*/"

# If any of these survive into the locked file, the lock did not do its job.
#
# This list does two jobs, and only one of them is about privacy. The other is
# proof the encryption actually ran: these strings live in the parcel payload, so
# if encrypt_parcel() ever silently no-ops or the markers stop matching, they
# reappear in the output and the deploy fails instead of publishing the deed.
# That is why the deed references stay even though the plan they come from is a
# public record.
#
# The road and town were on this list and are not any more, by decision: the
# repository is public and names both -- CLAUDE.md's first line and the README
# say "Hobart Road in Auburn, Maine" -- so blocking them in the deployed HTML
# bought nothing while costing the three sharpest historical basemaps, whose
# service paths are literally named after the town.
TELLTALES = ["POINT OF BEGINNING", "Karen S. Pease", "Bk 10912", "Maine W SP ftUS",
             "iron pipe found", "Course 1 end"]


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def encrypt_parcel(parcel: dict, passphrase: str) -> dict:
    salt = os.urandom(16)
    iv = os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, ITER, dklen=32)
    # separators match JSON.stringify so the plaintext is what the browser
    # would have produced; ensure_ascii=False keeps the degree signs as UTF-8.
    plain = json.dumps(parcel, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ct = AESGCM(key).encrypt(iv, plain, None)
    return {"v": 1, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def lock(src_path: Path, out_path: Path, passphrase: str) -> None:
    html = src_path.read_text(encoding="utf-8")
    a, b = html.find(BEGIN), html.find(END)
    if a < 0 or b < 0:
        sys.exit(f"{src_path}: lock markers missing - was this built by scripts/build.py?")

    parcel = json.loads((ROOT / "data/parcel.geojson").read_text(encoding="utf-8"))
    enc = encrypt_parcel(parcel, passphrase)

    locked = (html[:a] + BEGIN + "\nvar PARCEL_ENC = " + json.dumps(enc)
              + ";\nvar PARCEL_RAW = null;\n" + html[b:])

    # Refuse to write something that only looks locked.
    leaked = [t for t in TELLTALES if t in locked]
    if leaked:
        sys.exit(f"refusing to write: plaintext survived the lock: {leaked}")
    if re.search(r'var PARCEL_RAW = [^n]', locked):
        sys.exit("refusing to write: PARCEL_RAW is not null")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(locked, encoding="utf-8", newline="\n")
    print(f"{out_path}  {out_path.stat().st_size // 1024} KB  locked "
          f"(AES-256-GCM, PBKDF2-SHA256 x{ITER:,})")


def verify(out_path: Path, passphrase: str) -> None:
    """Decrypt what we just wrote, the way loader.js would, and compare."""
    html = out_path.read_text(encoding="utf-8")
    m = re.search(r"var PARCEL_ENC = (\{.*?\});", html, re.S)
    if not m:
        sys.exit("verify: no PARCEL_ENC in the locked file")
    enc = json.loads(m.group(1))
    key = hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"),
                              base64.b64decode(enc["salt"]), ITER, dklen=32)
    plain = AESGCM(key).decrypt(base64.b64decode(enc["iv"]), base64.b64decode(enc["ct"]), None)
    got = json.loads(plain.decode("utf-8"))
    want = json.loads((ROOT / "data/parcel.geojson").read_text(encoding="utf-8"))
    if got != want:
        sys.exit("verify: round-trip did not reproduce data/parcel.geojson")
    print(f"verify: round-trip OK, {len(got['features'])} features recovered")


def scan(root: Path) -> None:
    """Scan every published file, not just the one lock() wrote.

    lock() only ever sees the HTML it produces. sw.js, the manifest and the icons
    are copied into _site alongside it, so a place name reappearing in any of
    them would sail past the guard -- which is exactly the class of mistake that
    put the road name in a "locked" file once already.
    """
    bad = []
    for f in sorted(root.rglob("*")):
        if not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue                      # icons and anything else binary
        for t in TELLTALES:
            if t in text:
                bad.append(f"{f.relative_to(root)}: {t!r}")
    for b in bad:
        print("LEAK:", b)
    print(f"scanned {root}: {len(bad)} leak(s)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path, help="a built field-map.html, or a directory with --scan")
    ap.add_argument("-o", "--out", type=Path, help="defaults to alongside the source")
    ap.add_argument("--verify", action="store_true", help="decrypt the result and compare")
    ap.add_argument("--scan", action="store_true",
                    help="treat SOURCE as a directory and fail on any telltale in any file")
    a = ap.parse_args()

    if a.scan:
        scan(a.source)

    pw = os.environ.get("FIELDMAP_PASSPHRASE", "")
    if not pw:
        sys.exit("FIELDMAP_PASSPHRASE is not set - refusing to publish an unlocked parcel")

    out = a.out or a.source.with_name("field-map-locked.html")
    lock(a.source, out, pw)
    if a.verify:
        verify(out, pw)
