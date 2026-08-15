#!/usr/bin/env python3
"""
Fetch every map tile the parcel needs, once, so the APK can carry them.

    python3 scripts/tilepack.py                 # fetch into native/tiles/
    python3 scripts/tilepack.py --only sat,ct_5 # just those caches
    python3 scripts/tilepack.py --report        # what is already there

Why this exists
---------------
Tiles live in IndexedDB on the device, so a fresh install starts blank and an
uninstall wipes them -- and until the APK has a stable signing key, every update
IS an uninstall. Worse, eleven of the sixteen layers come from gis.maine.gov,
which renders each tile on demand and answers with a 500 "Application Error"
page whenever it is busy. That page carries no CORS headers, so from inside the
browser a bad afternoon is indistinguishable from having no signal. It has been
down for over an hour while this was written.

Bundling moves those bytes from a flaky state server onto GitHub's CDN. The
total is the same; the reliability is not.

Resumable on purpose
--------------------
Existing files are skipped, so a run against a half-fetched pack only fetches
what is missing. That matters because the Maine host will fail some of the time
no matter how politely it is asked: CI caches the directory and later runs fill
the gaps rather than starting over.

Politeness
----------
Two connections to gis.maine.gov and six to the pre-rendered services, matching
HOST_LIMITS in app.js. Flooding that host is what makes it fail; going faster
would get fewer tiles, not more.

The cache ids MUST match getCacheId() in app.js exactly -- they are the path the
app looks under. manifest.json records what was fetched, and the app only tries
the pack for ids it lists, so a mismatch degrades to "fetch from the network"
rather than breaking anything.
"""
import argparse
import concurrent.futures as futures
import json
import math
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
PARCEL = HERE / "data/parcel.geojson"
OUT = HERE / "native/tiles"

MARGIN_FT = 600
ZOOM_LO, ZOOM_HI = 15, 19

ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"
USGS = "https://basemap.nationalmap.gov/arcgis/rest/services"
MAINE = "https://gis.maine.gov/image/rest/services"
DEM = f"{MAINE}/DEM/Maine_Elevation_DEM_Statewide/ImageServer/exportImage"

# Defaults from app.js: hsOpt {az:45, alt:25, z:3} and ctOpt {ft:5}. The cache id
# carries them, so a pack built at one exaggeration is not found at another.
HS_ALT, HS_Z, CT_FT = 25, 3, 5

R_MERC = 20037508.342789244


def xyz(base):
    """Pre-rendered pyramid, ArcGIS order z/y/x."""
    return lambda z, x, y: f"{base}/tile/{z}/{y}/{x}"


def export(service, rule=None):
    """ImageServer exportImage, rendered per tile. Same bbox maths as app.js."""
    def build(z, x, y):
        n = 2 ** z
        x0 = x / n * 2 * R_MERC - R_MERC
        x1 = (x + 1) / n * 2 * R_MERC - R_MERC
        y0 = R_MERC - (y + 1) / n * 2 * R_MERC
        y1 = R_MERC - y / n * 2 * R_MERC
        u = (f"{service}?bbox={x0},{y0},{x1},{y1}&bboxSR=3857&imageSR=3857"
             f"&size=256,256&format=png&f=image")
        if rule:
            u += "&renderingRule=" + urllib.parse.quote(json.dumps(rule, separators=(",", ":")))
        return u
    return build


def hill(az):
    return {"rasterFunction": "Hillshade",
            "rasterFunctionArguments": {"Azimuth": az, "Altitude": HS_ALT, "ZFactor": HS_Z}}


HIST = [
    ("hist_1910",     "Topo/topoUsgs24k1910",                       17),
    ("hist_1945",     "Topo/topoUsgs24k1945",                       17),
    ("hist_1996DOQ",  "Regional/orthoRegionalDoq1996_1998",         17),
    ("hist_1998city", "Municipal/orthoMunicipalAuburn1998",         19),
    ("hist_2006city", "Municipal/orthoMunicipalLewistonAuburn2006", 19),
    ("hist_2013NAIP", "NAIP/orthoNaip2013",                         18),
    ("hist_2014topo", "Topo/topoUsgs24k2014",                       17),
    ("hist_2018NAIP", "NAIP/orthoNaip2018",                         18),
    ("hist_2018city", "Municipal/orthoMunicipalLewistonAuburn2018", 19),
]

LAYERS = {
    "sat":       (xyz(f"{ESRI}/World_Imagery/MapServer"), 19),
    "topo":      (xyz(f"{ESRI}/World_Topo_Map/MapServer"), 19),
    "ustopo":    (xyz(f"{USGS}/USGSTopo/MapServer"), 16),
    "usimtopo":  (xyz(f"{USGS}/USGSImageryTopo/MapServer"), 16),
    "osm":       (lambda z, x, y: f"https://tile.openstreetmap.org/{z}/{x}/{y}.png", 19),
    f"ct_{CT_FT}": (export(DEM, {"rasterFunction": "Contour",
                                 "rasterFunctionArguments": {"ContourInterval": round(CT_FT * 0.3048, 6)}}), 18),
    f"hs_multi_{HS_Z}": (export(DEM, {"rasterFunction": "Hillshade",
                                      "rasterFunctionArguments": {"HillshadeType": 1, "ZFactor": HS_Z}}), 18),
    f"hs_slope_{HS_Z}": (export(DEM, {"rasterFunction": "Slope",
                                      "rasterFunctionArguments": {"ZFactor": HS_Z}}), 18),
}
for _az in (45, 135, 315, 270):
    LAYERS[f"hs_hill_{_az}_{HS_ALT}_{HS_Z}"] = (export(DEM, hill(_az)), 18)
for _cid, _path, _nz in HIST:
    LAYERS[_cid] = (export(f"{MAINE}/{_path}/ImageServer/exportImage"), _nz)


def parcel_bounds():
    """South, west, north, east of the parcel plus MARGIN_FT, in degrees."""
    g = json.loads(PARCEL.read_text(encoding="utf-8"))
    ring = next(f["geometry"]["coordinates"][0] for f in g["features"]
                if f.get("properties", {}).get("style") == "p1")
    lons = [c[0] for c in ring]
    lats = [c[1] for c in ring]
    d_lat = MARGIN_FT / 364000
    mid = (min(lats) + max(lats)) / 2
    d_lon = d_lat / max(math.cos(math.radians(mid)), 0.1)
    return min(lats) - d_lat, min(lons) - d_lon, max(lats) + d_lat, max(lons) + d_lon


def tiles_for(nz, s, w, n_, e):
    out = []
    for z in range(min(ZOOM_LO, nz), min(ZOOM_HI, nz) + 1):
        n = 2 ** z
        x1 = int((w + 180) / 360 * n)
        x2 = int((e + 180) / 360 * n)

        def yof(lat):
            r = math.radians(lat)
            return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)

        for x in range(x1, x2 + 1):
            for y in range(yof(n_), yof(s) + 1):
                out.append((z, x, y))
    return out


def host_of(url):
    return urllib.parse.urlparse(url).netloc


def limit_for(host):
    return 2 if "gis.maine.gov" in host else 6


_lock = threading.Lock()
_stat = {"got": 0, "had": 0, "failed": 0, "bytes": 0, "skipped": 0}
# A host that is down stays down for the length of a run. Nine hundred tiles x
# three tries x two backoffs is most of an hour spent proving the same thing over
# and over, and CI does not need to learn it that thoroughly. Give up on a host
# after this many consecutive failures; the next run resumes from the cache.
DEAD_AFTER = 12
_streak = {}
_dead = set()


def fetch(url, tries=2):
    """Bytes and content-type, or (None, None). 5xx and timeouts are retried;
    a 404 is not going to improve by asking again."""
    wait = 1.0
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "field-map-tilepack/1"})
            with urllib.request.urlopen(req, timeout=20) as r:
                ct = r.headers.get("Content-Type", "")
                if not ct.startswith("image/"):
                    return None, None
                return r.read(), ct
        except urllib.error.HTTPError as e:
            if e.code < 500 and e.code != 429:
                return None, None
        except Exception:
            pass
        if i < tries - 1:
            time.sleep(wait)
            wait *= 3
    return None, None


def ext_for(ct):
    return ".jpg" if "jpeg" in ct else ".png"


def run(only, dry):
    s, w, n_, e = parcel_bounds()
    print(f"parcel + {MARGIN_FT} ft: {s:.5f},{w:.5f} .. {n_:.5f},{e:.5f}")
    OUT.mkdir(parents=True, exist_ok=True)

    jobs_by_host = {}
    total = 0
    for cid, (build, nz) in LAYERS.items():
        if only and cid not in only:
            continue
        for (z, x, y) in tiles_for(nz, s, w, n_, e):
            url = build(z, x, y)
            total += 1
            jobs_by_host.setdefault(host_of(url), []).append((cid, z, x, y, url))
    print(f"{total} tiles across {len(LAYERS if not only else only)} caches, "
          f"{len(jobs_by_host)} hosts")
    if dry:
        return 0

    def work(job):
        cid, z, x, y, url = job
        host = host_of(url)
        d = OUT / cid / str(z) / str(x)
        for ext in (".png", ".jpg"):
            if (d / f"{y}{ext}").exists():
                with _lock:
                    _stat["had"] += 1
                return
        with _lock:
            if host in _dead:
                _stat["skipped"] += 1
                return
        body, ct = fetch(url)
        if not body:
            with _lock:
                _stat["failed"] += 1
                _streak[host] = _streak.get(host, 0) + 1
                if _streak[host] >= DEAD_AFTER and host not in _dead:
                    _dead.add(host)
                    print(f"  giving up on {host} after {DEAD_AFTER} consecutive "
                          f"failures - rerun later to fill it in", flush=True)
            return
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{y}{ext_for(ct)}").write_bytes(body)
        with _lock:
            _streak[host] = 0
            _stat["got"] += 1
            _stat["bytes"] += len(body)
            done = _stat["got"] + _stat["had"] + _stat["failed"]
            if done % 100 == 0:
                print(f"  {done}/{total}  {_stat['bytes']/1048576:.1f} MB", flush=True)

    pools = []
    with futures.ThreadPoolExecutor(max_workers=sum(limit_for(h) for h in jobs_by_host)) as ex:
        for host, jobs in jobs_by_host.items():
            sub = futures.ThreadPoolExecutor(max_workers=limit_for(host))
            pools.append(sub)
            ex.submit(lambda j=jobs, p=sub: list(p.map(work, j)))
    for p in pools:
        p.shutdown(wait=True)

    write_manifest()
    print(f"got {_stat['got']}, already had {_stat['had']}, failed {_stat['failed']}, "
          f"skipped {_stat['skipped']}, {_stat['bytes']/1048576:.1f} MB fetched")
    if _dead:
        print(f"unreachable this run: {', '.join(sorted(_dead))}")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a", encoding="utf-8") as f:
            f.write(f"fetched={_stat['got']}\n")
            f.write(f"failed={_stat['failed']}\n")
    # Never fail the build. A partial pack is strictly better than none, and the
    # layers this misses are the ones whose server is unreliable by nature -- the
    # app falls back to the network for anything absent.
    return 0


def write_manifest():
    """What the app may look for locally. Only ids listed here are tried, so a
    partial pack costs a network fetch rather than a broken tile."""
    packs = {}
    for cid in sorted(p.name for p in OUT.iterdir() if p.is_dir()):
        zs, count, size, ext = [], 0, 0, ".png"
        for zd in (OUT / cid).iterdir():
            if not zd.is_dir():
                continue
            zs.append(int(zd.name))
            for xd in zd.iterdir():
                for f in xd.iterdir():
                    count += 1
                    size += f.stat().st_size
                    ext = f.suffix
        if count:
            packs[cid] = {"zMin": min(zs), "zMax": max(zs), "tiles": count,
                          "bytes": size, "ext": ext}
    (OUT / "manifest.json").write_text(
        json.dumps({"packs": packs}, indent=1), encoding="utf-8", newline="\n")
    tot = sum(p["bytes"] for p in packs.values())
    print(f"manifest: {len(packs)} caches, {sum(p['tiles'] for p in packs.values())} tiles, "
          f"{tot/1048576:.1f} MB")


def report():
    if not (OUT / "manifest.json").exists():
        print("no pack yet")
        return 0
    m = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    for cid, p in sorted(m["packs"].items()):
        print(f"  {cid:22} z{p['zMin']}-{p['zMax']}  {p['tiles']:5} tiles  {p['bytes']/1048576:7.1f} MB")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated cache ids")
    ap.add_argument("--dry", action="store_true", help="count tiles, fetch nothing")
    ap.add_argument("--report", action="store_true", help="summarise the existing pack")
    a = ap.parse_args()
    if a.report:
        sys.exit(report())
    sys.exit(run(set(a.only.split(",")) if a.only else None, a.dry))
