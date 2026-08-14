#!/usr/bin/env python3
"""
Build a copy of www/index.html whose Capacitor bridge throws on everything.

    python3 scripts/bridge_harness.py        # -> www/test-throwing-bridge.html
    cd www && python3 -m http.server 8778

This exists because of a bug that survived two device round-trips.

Capacitor hands back a *proxy* for a plugin the native bridge has not registered
yet. The object is truthy, `typeof x.addWatcher` is "function", and calling it
throws synchronously. app.js calls `navigator.geolocation.watchPosition` once,
at the top level, while the body is still parsing -- so that exception did not
fail the GPS, it aborted the remaining two thirds of app.js. The tab wiring and
the tray drag handlers were never reached, and `avg` was left in its temporal
dead zone permanently, so every later fix reported "Cannot access 'avg' before
initialization" from a file that had stopped loading.

None of that reproduces in a browser: with no `window.Capacitor`, the shim's
`plugin()` returns null and `start()` returns false before touching anything, so
every desk test passed while the handset was dead. This harness supplies the one
condition the browser cannot -- a bridge that is present and hostile -- and it is
deliberately harsher than reality: every method of every plugin throws, not just
the unregistered ones.

What to assert after loading it (see docs/AUDIT.md):

  * `[...document.querySelectorAll('#tabs button')].every(b => b.onclick)` -- the
    wiring at the end of app.js was reached
  * `typeof avg`, `PEEK`, `typeof buzz`, `typeof SY` -- no TDZ, so the file ran
    to completion rather than dying partway down
  * the status line carries no `uncaught:` -- native.js swallowed the bridge
  * against the sync shape, mode 1 of the status line reads `watch 1/1`: one live
    watcher whose id we hold. `0/1` means one is running that nothing can ever
    stop, which breaks promoting to background when a track starts.

The output is written into www/, which is gitignored and rebuilt by
assemble.py, so it never reaches a shipped APK.
"""
import sys
from pathlib import Path

WWW = Path(__file__).resolve().parent.parent / "www"
ANCHOR = '<script src="native.js"></script>'

# Every property access returns a function that throws, at every depth, which is
# what an unregistered Capacitor plugin behaves like from JS.
THROWING = """<script>
window.Capacitor = { isNativePlatform: function () { return true; },
  Plugins: new Proxy({}, { get: function (t, k) {
    return new Proxy({}, { get: function () {
      return function () { throw new Error('"' + String(k) + '" plugin is not implemented on android'); };
    }});
  }})};
</script>
"""

# The shape a REGISTERED plugin actually has when reached through
# Capacitor.Plugins rather than through the package's own wrapper: a method
# taking a callback returns its callback id synchronously, as a string, not the
# Promise<string> its typings advertise. An emulator on API 36 reported
# "BG.addWatcher(...).then is not a function" from exactly this, while fixes kept
# arriving -- the callback registers either way and only the id was lost, and the
# id is what removeWatcher() needs to ever stop the watcher. window.__cb is left
# exposed so a fix can be pushed through by hand.
SYNC_ID = """<script>
window.__cb = null;
window.Capacitor = { isNativePlatform: function () { return true; }, Plugins: {
  BackgroundGeolocation: {
    addWatcher: function (o, cb) { window.__cb = cb; return 'cbid-42'; },
    removeWatcher: function (o) { window.__removed = o.id; return Promise.resolve(); },
    checkPermissions: function () { return Promise.resolve({location: 'granted'}); }
  },
  FieldSensors: {
    saveDownload: function () { return Promise.resolve({saved: true, where: 'Downloads/x'}); },
    pressure: function () { return Promise.resolve({available: false}); },
    gnss: function () { return Promise.resolve({available: false}); },
    compassAccuracy: function () { return Promise.resolve({available: false}); },
    notificationPermission: function () { return Promise.resolve({granted: true}); },
    keepAwake: function () { return Promise.resolve({held: false}); }
  },
  Preferences: { keys: function () { return Promise.resolve({keys: []}); },
                 get: function () { return Promise.resolve({value: null}); },
                 set: function () { return Promise.resolve(); } }
}};
</script>
"""

SHAPES = {"throwing": ("test-throwing-bridge.html", THROWING),
          "sync": ("test-sync-id.html", SYNC_ID)}


def main() -> None:
    src = WWW / "index.html"
    if not src.exists():
        sys.exit(f"{src} not found - run python3 scripts/assemble.py --build first")

    html = src.read_text(encoding="utf-8")
    if ANCHOR not in html:
        sys.exit("could not find the native.js tag to inject the stub ahead of")

    # Ahead of native.js, so the shim sees the bridge from its very first line.
    for shape, (name, stub) in SHAPES.items():
        out = WWW / name
        out.write_text(html.replace(ANCHOR, stub + ANCHOR, 1), encoding="utf-8", newline="\n")
        print(f"{out.name}  {out.stat().st_size // 1024} KB  ({shape})")


if __name__ == "__main__":
    main()
