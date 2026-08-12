#!/usr/bin/env python3
"""
Assemble src/ + vendor/ + data/ into a single self-contained field-map.html.

Everything is inlined deliberately: the file has to boot with no network at all,
because that is the condition it is used in. Vendored libraries are pinned
copies, not CDN links.

    python3 scripts/build.py            -> dist/field-map.html
    python3 scripts/build.py --check    -> build, then verify invariants
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

TOKENS = {
    "{{VENDOR_CSS}}":       ("vendor/leaflet.css",       "/* Leaflet 1.9.4 */"),
    "{{APP_CSS}}":          ("src/app.css",              ""),
    "{{LEAFLET_JS}}":       ("vendor/leaflet.js",        "/* Leaflet 1.9.4 - BSD-2-Clause, (c) Vladimir Agafonkin */"),
    "{{LEAFLET_ROTATE_JS}}":("vendor/leaflet-rotate.js", "/* leaflet-rotate 0.2.8 - MIT, (c) Raruto */"),
    "{{APP_JS}}":           ("src/app.js",               ""),
    "{{LOADER_JS}}":        ("src/loader.js",            ""),
}


def build() -> Path:
    html = (ROOT / "src/index.html").read_text()

    for token, (rel, banner) in TOKENS.items():
        body = (ROOT / rel).read_text()
        html = html.replace("/*" + token + "*/", (banner + "\n" + body) if banner else body)

    parcel = (ROOT / "data/parcel.geojson").read_text().strip()
    html = html.replace("__PARCEL_GEOJSON__", parcel)

    # only build tokens, not runtime globals like window.__PARCEL__
    leftover = re.findall(r"\{\{[A-Z_]+\}\}|__PARCEL_GEOJSON__|__LEAFLET_ROTATE__", html)
    if leftover:
        sys.exit(f"unreplaced build tokens: {sorted(set(leftover))}")

    DIST.mkdir(exist_ok=True)
    out = DIST / "field-map.html"
    out.write_text(html)
    (DIST / "sw.js").write_text((ROOT / "src/sw.js").read_text())

    # the add-on serves its own copy
    static = ROOT / "addon/field_map/rootfs/app/static"
    static.mkdir(parents=True, exist_ok=True)
    (static / "field-map.html").write_text(html)
    (static / "sw.js").write_text((ROOT / "src/sw.js").read_text())

    print(f"dist/field-map.html  {out.stat().st_size // 1024} KB")
    return out


def check(path: Path) -> None:
    html = path.read_text()
    fails = []

    # The app must not fetch anything at load. Tiles are runtime-only and
    # deliberate; a <script src> or <link href> would break offline boot.
    for tag in re.findall(r'<(?:script|link)[^>]*\s(?:src|href)="(https?://[^"]+)"', html):
        fails.append(f"external load-time dependency: {tag}")

    app = re.findall(r'<script id="appsrc" type="text/plain">(.*?)</script>', html, re.S)
    if not app:
        fails.append("appsrc payload missing")
    else:
        Path("/tmp/_app.js").write_text(app[0])
        if subprocess.run(["node", "--check", "/tmp/_app.js"], capture_output=True).returncode:
            fails.append("app.js does not parse")

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
