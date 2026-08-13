# Field Map

Single-file offline field map for the Hobart Road parcel, Auburn, Maine.
Runs in a phone browser with no signal, or as a sideloaded Android app.

- Survey parcel from the recorded deed, drawn over satellite, USGS topo, or
  Maine statewide LiDAR hillshade with adjustable sun angle
- GPS marking with accuracy-weighted averaging and outlier rejection
- Inside/outside the parcel, distance to the nearest boundary, nearest corner
- Navigate to a mark or corner; walk a deed line with live cross-track error
- **Stake a point** — type a deed call (`N 34 35 30 E`, `598.29`) and project it
  from a corner you can find, to stand where a lost one should be
- **Measure between** any two of your position, a plan corner, or a mark
- Fit the parcel to a found monument — one shift moves everything
- Coordinates in decimal degrees, DMS, Maine West State Plane ftUS, UTM, MGRS
- Offline tile caching, track recording, photos, daylight remaining
- Syncs through a Home Assistant add-on or the GitHub Contents API

## Build

```bash
python3 scripts/build.py --check
```

Output: `dist/field-map.html`, `dist/sw.js`, and the PWA sidecars
(`manifest.webmanifest`, `icon-192.png`, `icon-512.png`). All must be served
from the same folder.

## Run it

**Phone, browser** — <https://jamesccupps.github.io/GPS/>. Published by
`.github/workflows/pages.yml` on every push to `main`, with the parcel encrypted
into the file, because a Pages site is public even from a private repo. Unlock
once, then **Add to Home Screen** — there is a manifest, so that is a real
install and the browser is far less likely to evict your marks.

**Phone, app** — <https://github.com/jamesccupps/GPS/releases/latest/download/field-map.apk>.
Sideload it. Adds the things a browser has no API for: background location that
survives the screen sleeping, a barometer, GNSS satellite quality, compass
calibration state, and storage the browser cannot evict. See `native/README.md`.

**Home Assistant add-on** — copy `addon/field_map` to your `/addons` share,
install from the Add-on Store, start, enable the sidebar. Zero configuration;
ingress puts it behind HA's login and data lands in HA backups.

Whichever you use: **cache tiles on wifi before you go** (Map → Cache this
view), once per basemap. Without them the parcel still draws, over nothing.

## Working on it

Read `CLAUDE.md` first — it covers the domain constraints that are not obvious
from the code. `docs/STATE.md` is where things currently stand and what is
waiting on a decision. `docs/AUDIT.md` lists bugs already found and fixed, and
why they were worth writing down.

```bash
cd dist && python3 -m http.server 8777    # localhost is a secure context, so GPS prompts
```

Note that `gradle` cannot run on the current dev machine — the APK is built in
CI. `docs/STATE.md` explains why.
