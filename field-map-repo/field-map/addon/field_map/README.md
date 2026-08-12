# Field Map — Home Assistant add-on

Serves the parcel field map and stores your marks, behind Home Assistant's own
login.

## Why ingress and not `/config/www/`

Files in `www/` are served at `/local/` with **no authentication** — including
over Nabu Casa. Add-on ingress is different: Home Assistant authenticates every
request before it reaches this container.

That is also why there is no `ports:` entry in `config.yaml`. This add-on is not
reachable except through Home Assistant.

## Install

1. Copy the `field_map` folder into your `/addons` share (Samba, or the
   File Editor / Studio Code Server add-on).
2. Settings → Add-ons → **Add-on Store** → ⋮ → **Check for updates**.
3. "Field Map" appears under *Local add-ons*. Install, Start.
4. Enable **Show in sidebar**.

Works over Nabu Casa with no port forwarding and no extra tunnel.

## Setup

There isn't any. The app detects the add-on via `GET api/health` and switches
itself to this backend — no token, no passphrase, no CORS.

## Data

`/data/marks.json`, written atomically with the last 20 revisions kept in
`/data/backups/`. `/data` is part of the add-on's persistent volume, so your
marks are included in Home Assistant backups.

## Merge

`PUT /api/marks` merges server-side rather than overwriting: newest edit wins
per mark, and a delete only wins if it is newer than that mark's last edit.
A phone that has been offline for a week cannot clobber newer work by pushing
a stale snapshot.

## Endpoints

| | |
|---|---|
| `GET /` | the app |
| `GET /api/health` | backend probe |
| `GET /api/marks` | current state |
| `PUT /api/marks` | merge and persist, returns merged state |
