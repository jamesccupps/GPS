# Field Map

Single-file offline field map for the Hobart Road parcel, Auburn, Maine.
Runs in a phone browser with no signal.

- Survey parcel from the recorded deed, drawn over satellite, USGS topo, or
  Maine statewide LiDAR hillshade with adjustable sun angle
- GPS marking with accuracy-weighted averaging and outlier rejection
- Inside/outside the parcel, distance to the nearest boundary, nearest corner
- Navigate to a mark or corner; walk a deed line with live cross-track error
- Fit the parcel to a found monument — one shift moves everything
- Coordinates in decimal degrees, DMS, Maine West State Plane ftUS, UTM, MGRS
- Offline tile caching, track recording, photos, daylight remaining
- Syncs through a Home Assistant add-on or the GitHub Contents API

## Build

```bash
python3 scripts/build.py --check
```

Output: `dist/field-map.html` and `dist/sw.js`. Both must be served from the
same folder.

## Run it

**Home Assistant add-on** (recommended) — copy `addon/field_map` to your
`/addons` share, install from the Add-on Store, start, enable the sidebar. Zero
configuration; ingress puts it behind HA's login and data lands in HA backups.

**GitHub Pages** — publish `dist/`. Note a Pages site is public even from a
private repo, so use **Map → Backup & privacy → Lock a copy** to encrypt the
parcel into the file before uploading.

Either way: open it on the phone, then **Add to Home Screen**.

## Working on it

Read `CLAUDE.md` first. `docs/AUDIT.md` lists bugs already found and fixed.
