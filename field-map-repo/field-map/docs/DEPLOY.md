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

Automated by `.github/workflows/pages.yml` on push to `main`: build, lock,
deploy. Two things have to be set up once, in the repo settings:

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → `FIELDMAP_PASSPHRASE`**

The workflow publishes `_site/index.html` (the locked build) and `_site/sw.js`.
It never publishes `dist/field-map.html`, which is unlocked. If the secret is
missing, `scripts/lock.py` exits non-zero and the deploy fails rather than
putting the parcel on a public URL.

To lock a copy by hand instead — for a one-off, or to check the CI output —
either **Map → Backup & privacy → Lock a copy with a passphrase** in the app, or:

```bash
FIELDMAP_PASSPHRASE=... python3 scripts/lock.py dist/field-map.html     -o _site/index.html --verify
```

Both produce the same format: AES-256-GCM, PBKDF2-SHA256 at 310,000 iterations,
16-byte salt, 12-byte IV. `--verify` decrypts the result and compares it against
`data/parcel.geojson`, which is what catches the two implementations drifting
apart.

**What locking does and does not hide.** The parcel geometry, corner and
monument names, deed references and the abutter's name are all encrypted, and
the app does not execute before unlock — `PARCEL_RAW` is `null` and
`window.__PARCEL__` is undefined at the gate. But `src/app.js` opens the map on
a hardcoded `setView([44.0016,-70.2115], 16)`, and that line ships in the clear.
A stranger who views source on the locked file gets the parcel's location to
about 30 ft. They do not get the boundary, the corners, or anything from the
deed.

Locking the Pages build also only helps if the repo itself is not carrying the
same data in the open. `data/parcel-source.kml` and `data/parcel.geojson` are
committed unencrypted, so on a public repo the lock protects the published URL
and nothing else.

For sync, create a fine-grained token scoped to that one repo with
**Contents: read and write** and an expiry. The app reads owner and repo from
its own URL and writes to a `data` branch Pages does not publish.

## Offline

`sw.js` caches the app shell — Pages sends `max-age=600`, so without it the app
is gone ten minutes after the last load.

Map tiles are separate and deliberate: **Map → Cache this view**, on wifi, once
per basemap. LiDAR is cached per lighting setup.
