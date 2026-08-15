#!/usr/bin/env python3
"""
Assemble native/www/ from the web build, for Capacitor to package.

    python3 scripts/assemble.py          # expects ../dist/field-map.html to exist
    python3 scripts/assemble.py --build  # run ../scripts/build.py first

The APK ships the UNLOCKED build on purpose. The lock exists because a Pages
site is public; an APK you sideloaded onto your own phone is not, and a
passphrase gate on every launch in the woods is a cost with nothing on the
other side of it.

Two changes are made to the built HTML, both one line each:

  * <script src="native.js"> in <head>, early enough that it replaces
    navigator.geolocation before loader.js runs app.js.
  * the service worker registration is neutered. Inside an APK every asset is
    already local, so the worker buys nothing and its cache-first shell would
    happily serve a stale app across an update.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent      # native/
WEB = HERE.parent                                  # field-map/
WWW = HERE / "www"

# The flag is set before the shim so native.js knows for certain that it is
# running inside the APK. It cannot infer that from window.Capacitor at
# body-parse time, because the bridge may not have injected itself yet -- and
# the answer decides whether a missing plugin means "fall back to the browser's
# geolocation" or "wait, because the WebView's own geolocation has no
# permission plumbing on Android".
NL = chr(10)


def build_id() -> str:
    """Short identity for the payload, reported by the status line.

    The APK cannot be updated in place until it has a stable signing key, so a
    refused install leaves the previous build on the handset looking exactly
    like the new one. Without this, "it still does not work" and "the fix never
    reached the phone" are indistinguishable, and both cost a round trip.

    Derived from the commit, not the clock, so two builds of the same clean tree
    still produce byte-identical output.
    """
    sha = os.environ.get("GITHUB_SHA", "")
    if not sha:
        try:
            sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(WEB),
                                 capture_output=True, text=True, check=True).stdout.strip()
        except Exception:
            sha = ""
    return sha[:7] or "local"


def pack_manifest() -> str:
    """The bundled tile manifest, inlined rather than fetched.

    A fetch would race the first tiles: the map starts requesting them while the
    manifest is still in flight, so the opening screen would come off the network
    -- from the one server this pack exists to stop depending on. Inlining costs
    a couple of hundred bytes and removes the race entirely.
    """
    m = HERE / "tiles/manifest.json"
    if not m.exists():
        return "null"
    return m.read_text(encoding="utf-8").strip()


def tag() -> str:
    return ("<script>window.__FIELDMAP_NATIVE__=1;"
            "window.__FIELDMAP_BUILD__=" + repr(build_id()) + ";"
            "window.__FIELDMAP_PACK__=" + pack_manifest() + ";</script>" + NL +
            '<script src="native.js"></script>' + NL)


def assemble(run_build: bool) -> None:
    if run_build:
        subprocess.run([sys.executable, str(WEB / "scripts/build.py")], check=True)

    src = WEB / "dist/field-map.html"
    if not src.exists():
        sys.exit(f"{src} not found - run python3 ../scripts/build.py first")

    html = src.read_text(encoding="utf-8")

    # Ahead of everything, so the shim is installed before app.js asks for a fix.
    anchor = '<meta charset="utf-8">\n'
    if anchor not in html:
        sys.exit("could not find the charset meta to anchor the shim to")
    html = html.replace(anchor, anchor + tag(), 1)

    # 'sw.js' -> '' makes register() reject, and loader.js already swallows that.
    html, n = re.subn(r"navigator\.serviceWorker\.register\('sw\.js'\)",
                      "Promise.reject(new Error('no service worker in the APK'))", html)
    if n != 1:
        sys.exit(f"expected exactly 1 service worker registration, found {n}")

    WWW.mkdir(parents=True, exist_ok=True)
    (WWW / "index.html").write_text(html, encoding="utf-8", newline="\n")
    shutil.copyfile(HERE / "src/native.js", WWW / "native.js")

    # Deliberately no sw.js: see the module docstring.
    stale = WWW / "sw.js"
    if stale.exists():
        stale.unlink()

    # The bundled tiles, if scripts/tilepack.py has been run. Copied rather than
    # symlinked because Capacitor's sync copies www/ into the APK assets.
    src_tiles = HERE / "tiles"
    dst_tiles = WWW / "tiles"
    if src_tiles.exists():
        if dst_tiles.exists():
            shutil.rmtree(dst_tiles)
        shutil.copytree(src_tiles, dst_tiles)
        n = sum(1 for _ in dst_tiles.rglob("*") if _.is_file())
        mb = sum(f.stat().st_size for f in dst_tiles.rglob("*") if f.is_file()) / 1048576
        print(f"www/tiles  {n} files  {mb:.1f} MB")

    kb = (WWW / "index.html").stat().st_size // 1024
    print(f"www/index.html  {kb} KB  (unlocked, shim injected, no service worker)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true", help="run ../scripts/build.py first")
    assemble(ap.parse_args().build)
