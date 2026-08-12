"""
Field Map add-on — static host + tiny sync store.

Runs behind Home Assistant ingress, so every request has already been
authenticated by HA. That means no token to create, no CORS to configure,
and nothing exposed to the internet except through your existing login.

Marks live in /data, which is the add-on's persistent volume and is included
in Home Assistant backups.
"""
import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

DATA = Path(os.environ.get("FM_DATA", "/data"))
STATIC = Path(__file__).parent / "static"
STORE = DATA / "marks.json"
BACKUPS = DATA / "backups"

app = FastAPI(title="Field Map", docs_url=None, redoc_url=None)


def _read() -> dict:
    if not STORE.exists():
        return {"v": 1, "marks": [], "graveyard": [], "updated": 0, "rev": 0}
    try:
        return json.loads(STORE.read_text())
    except (json.JSONDecodeError, OSError):
        return {"v": 1, "marks": [], "graveyard": [], "updated": 0, "rev": 0}


def _write(payload: dict) -> None:
    """Atomic replace, plus a rolling backup — an SD card or NVMe losing power
    mid-write should never cost you a day of marking."""
    DATA.mkdir(parents=True, exist_ok=True)
    BACKUPS.mkdir(parents=True, exist_ok=True)
    if STORE.exists():
        shutil.copy2(STORE, BACKUPS / f"marks-{int(time.time())}.json")
        keep = sorted(BACKUPS.glob("marks-*.json"))[:-20]
        for old in keep:
            old.unlink(missing_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(DATA), suffix=".tmp")
    with os.fdopen(fd, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, STORE)


def _merge(local: dict, remote: dict) -> dict:
    """Same rule as the browser: newest edit per id wins; a delete only wins if
    it is newer than that mark's own last edit."""
    graves: dict[str, dict] = {}
    for t in (remote.get("graveyard") or []) + (local.get("graveyard") or []):
        cur = graves.get(t["id"])
        if not cur or t.get("updated", 0) > cur.get("updated", 0):
            graves[t["id"]] = t

    marks: dict[str, dict] = {}
    for m in (remote.get("marks") or []) + (local.get("marks") or []):
        cur = marks.get(m["id"])
        if not cur or m.get("updated", m.get("t", 0)) > cur.get("updated", cur.get("t", 0)):
            marks[m["id"]] = m

    out = []
    for m in marks.values():
        t = graves.get(m["id"])
        if t and t.get("updated", 0) >= m.get("updated", m.get("t", 0)):
            continue
        out.append(m)

    cutoff = (time.time() - 90 * 86400) * 1000
    return {
        "v": 1,
        "marks": out,
        "graveyard": [t for t in graves.values() if t.get("updated", 0) > cutoff],
        "updated": int(time.time() * 1000),
    }


@app.get("/api/health")
async def health():
    d = _read()
    return {
        "ok": True,
        "backend": "hass-addon",
        "marks": len(d.get("marks", [])),
        "rev": d.get("rev", 0),
    }


@app.get("/api/marks")
async def get_marks():
    return JSONResponse(_read())


@app.put("/api/marks")
async def put_marks(request: Request):
    """Server-side merge, so two phones syncing at once cannot clobber each
    other even if both send a full snapshot."""
    try:
        incoming = await request.json()
    except Exception:
        return JSONResponse({"error": "bad json"}, status_code=400)

    current = _read()
    merged = _merge(incoming, current)
    merged["rev"] = current.get("rev", 0) + 1
    _write(merged)
    return JSONResponse(merged)


@app.get("/")
async def index():
    return FileResponse(STATIC / "field-map.html")


@app.get("/sw.js")
async def sw():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript")


app.mount("/", StaticFiles(directory=str(STATIC)), name="static")
