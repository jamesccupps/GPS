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
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent      # native/
WEB = HERE.parent                                  # field-map/
WWW = HERE / "www"

TAG = '<script src="native.js"></script>\n'


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
    html = html.replace(anchor, anchor + TAG, 1)

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

    kb = (WWW / "index.html").stat().st_size // 1024
    print(f"www/index.html  {kb} KB  (unlocked, shim injected, no service worker)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", action="store_true", help="run ../scripts/build.py first")
    assemble(ap.parse_args().build)
