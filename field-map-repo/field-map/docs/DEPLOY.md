# Deploying

## Home Assistant add-on

Ingress puts the app behind Home Assistant's own login. This matters: files in
`/config/www/` are served at `/local/` with **no authentication at all**,
including over Nabu Casa. There is deliberately no `ports:` entry in
`config.yaml`, so the container is unreachable except through HA.

1. `python3 scripts/build.py` (populates the add-on's static dir)
2. Copy `addon/field_map` to the `/addons` share
3. Settings → Add-ons → Add-on Store → ⋮ → Check for updates
4. Install "Field Map" under *Local add-ons*, start, enable Show in sidebar

Data: `/data/marks.json`, written atomically with the last 20 revisions in
`/data/backups/`. Included in HA backups.

Endpoints: `GET /` (app), `GET /api/health` (backend probe),
`GET|PUT /api/marks` (state; PUT merges server-side).

## GitHub Pages

`dist/field-map.html` and `dist/sw.js` in the same folder.

A Pages site is public even when the repo is private. To publish without
exposing the parcel: **Map → Backup & privacy → Lock a copy with a passphrase**,
then upload the locked file and keep the unlocked one local. AES-256-GCM,
PBKDF2-SHA256 at 310,000 iterations. Verified that no coordinates, names or deed
references survive in the locked file, and the app does not execute before
unlock.

For sync, create a fine-grained token scoped to that one repo with
**Contents: read and write** and an expiry. The app reads owner and repo from
its own URL and writes to a `data` branch Pages does not publish.

## Offline

`sw.js` caches the app shell — Pages sends `max-age=600`, so without it the app
is gone ten minutes after the last load.

Map tiles are separate and deliberate: **Map → Cache this view**, on wifi, once
per basemap. LiDAR is cached per lighting setup.
