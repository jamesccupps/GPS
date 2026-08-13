#!/usr/bin/env python3
"""
Assemble src/ + vendor/ + data/ into a single self-contained field-map.html.

Everything is inlined deliberately: the file has to boot with no network at all,
because that is the condition it is used in. Vendored libraries are pinned
copies, not CDN links.

Reads and writes pin the encoding and the newline explicitly. The Windows
default codec is cp1252, which cannot decode the box-drawing section banners in
app.js, and the default newline translation would rewrite every LF as CRLF —
5 KB of padding, and a dist/ that differs byte-for-byte by platform.

    python3 scripts/build.py            -> dist/field-map.html
    python3 scripts/build.py --check    -> build, then verify invariants
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
SIDECARS = ("manifest.webmanifest", "icon-192.png", "icon-512.png")

TOKENS = {
    "{{VENDOR_CSS}}":       ("vendor/leaflet.css",       "/* Leaflet 1.9.4 */"),
    "{{APP_CSS}}":          ("src/app.css",              ""),
    "{{LEAFLET_JS}}":       ("vendor/leaflet.js",        "/* Leaflet 1.9.4 - BSD-2-Clause, (c) Vladimir Agafonkin */"),
    "{{LEAFLET_ROTATE_JS}}":("vendor/leaflet-rotate.js", "/* leaflet-rotate 0.2.8 - MIT, (c) Raruto */"),
    "{{APP_JS}}":           ("src/app.js",               ""),
    "{{LOADER_JS}}":        ("src/loader.js",            ""),
}


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8", newline="\n")


def build() -> Path:
    html = read(ROOT / "src/index.html")

    for token, (rel, banner) in TOKENS.items():
        body = read(ROOT / rel)
        html = html.replace("/*" + token + "*/", (banner + "\n" + body) if banner else body)

    parcel = read(ROOT / "data/parcel.geojson").strip()
    html = html.replace("__PARCEL_GEOJSON__", parcel)

    # only build tokens, not runtime globals like window.__PARCEL__
    leftover = re.findall(r"\{\{[A-Z_]+\}\}|__PARCEL_GEOJSON__|__LEAFLET_ROTATE__", html)
    if leftover:
        sys.exit(f"unreplaced build tokens: {sorted(set(leftover))}")

    DIST.mkdir(exist_ok=True)
    out = DIST / "field-map.html"
    sw = read(ROOT / "src/sw.js")
    write(out, html)
    write(DIST / "sw.js", sw)
    # Sidecars, not inlined: a manifest has to be a real URL for Chrome to treat
    # the site as installable, and an install is what makes storage.persist()
    # likely to be granted. The app still boots without them.
    for name in SIDECARS:
        shutil.copyfile(ROOT / "src" / name, DIST / name)

    # the add-on serves its own copy
    static = ROOT / "addon/field_map/rootfs/app/static"
    static.mkdir(parents=True, exist_ok=True)
    write(static / "field-map.html", html)
    write(static / "sw.js", sw)
    for name in SIDECARS:
        shutil.copyfile(ROOT / "src" / name, static / name)

    print(f"dist/field-map.html  {out.stat().st_size // 1024} KB")
    return out


def check(path: Path) -> None:
    html = read(path)
    fails = []

    # The app must not fetch anything at load. Tiles are runtime-only and
    # deliberate; a <script src> or <link href> would break offline boot.
    for tag in re.findall(r'<(?:script|link)[^>]*\s(?:src|href)="(https?://[^"]+)"', html):
        fails.append(f"external load-time dependency: {tag}")

    app = re.findall(r'<script id="appsrc" type="text/plain">(.*?)</script>', html, re.S)
    if not app:
        fails.append("appsrc payload missing")
    else:
        # NamedTemporaryFile, not /tmp: that path is POSIX-only and silently
        # resolves to C:\tmp on Windows.
        with tempfile.NamedTemporaryFile("w", suffix=".js", encoding="utf-8",
                                         newline="\n", delete=False) as fh:
            fh.write(app[0])
        try:
            if subprocess.run(["node", "--check", fh.name], capture_output=True).returncode:
                fails.append("app.js does not parse")
        finally:
            os.unlink(fh.name)

    if "/*PARCEL_BEGIN*/" not in html or "/*PARCEL_END*/" not in html:
        fails.append("lock markers missing - 'Lock a copy' will fail")

    if subprocess.run(["node", "--check", str(path.parent / "sw.js")], capture_output=True).returncode:
        fails.append("sw.js does not parse")

    for msg in fails:
        print("FAIL:", msg)
    print("checks passed" if not fails else f"{len(fails)} failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    out = build()
    if a.check:
        check(out)
