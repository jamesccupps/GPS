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

The workflow publishes `_site/index.html` (the locked build), `_site/sw.js`, and
the PWA sidecars — `manifest.webmanifest`, `icon-192.png`, `icon-512.png`. The
manifest has to be a real fetchable URL for Chrome to treat the site as
installable, and an install is what makes `navigator.storage.persist()` likely
to be granted. It never publishes `dist/field-map.html`, which is unlocked. If the secret is
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
`window.__PARCEL__` is undefined at the gate.

`src/app.js` used to open the map on a hardcoded `setView([44.0016,-70.2115])`,
which shipped in the clear and gave up the location to about 30 ft no matter
how well the geometry was encrypted. `homeView()` now derives the opening
centre from the `p1` polygon after unlock, so nothing parcel-specific survives.
The only coordinates left in a locked file are `lat0` and `lon0` in the
projection — the Maine West State Plane origin and central meridian, which are
public constants for a zone covering most of western Maine.

`lock.py` enforces this rather than leaving it to a scan: it refuses to write a
file containing any `TELLTALES` string. That list originally held the deed book,
the abutter and the corner names but **not the road or the town** — so a comment
in `app.js` reading `GEOID18 at Hobart Road` shipped in the clear inside a
"locked" file, and nothing caught it. Both are on the list now, and the scan
below is the belt to that braces:

```bash
grep -nE "(4[34]\.[0-9]{3,}|-7[01]\.[0-9]{3,})" _site/index.html
```

Locking the Pages build also only helps if the repo itself is not carrying the
same data in the open. `data/parcel-source.kml` and `data/parcel.geojson` are
committed unencrypted, so on a public repo the lock protects the published URL
and nothing else.

For sync, create a fine-grained token scoped to that one repo with
**Contents: read and write** and an expiry. The app reads owner and repo from
its own URL and writes to a `data` branch Pages does not publish.

## Android APK

Automated by `.github/workflows/apk.yml` on push to `main`, published to a
rolling `apk-latest` release so the phone has one permanent link:

**<https://github.com/jamesccupps/GPS/releases/latest/download/field-map.apk>**

Built in CI because Gradle cannot run on the dev machine at all — see
`docs/STATE.md`. The workflow parses every Android XML before Gradle starts,
because the build log needs a sign-in to read and a malformed resource otherwise
surfaces only as "exit code 1".

Unlike the Pages copy this ships the parcel **unlocked**, deliberately: the lock
exists because a Pages site is public, and a sideloaded APK on your own phone is
not. The release notes say so.

Two things are not yet done and are documented in `docs/STATE.md`: the APK is
signed with a throwaway debug key that CI regenerates every run, so **updates
cannot install over each other and require an uninstall that wipes all marks**;
and `versionCode` is pinned at 1. Fix them together.

## Offline

`sw.js` caches the app shell — Pages sends `max-age=600`, so without it the app
is gone ten minutes after the last load.

Map tiles are separate and deliberate: **Map → Cache this view**, on wifi, once
per basemap. LiDAR is cached per lighting setup.
