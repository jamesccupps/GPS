#!/usr/bin/env python3
"""
data/parcel-source.kml -> data/parcel.geojson

Preserves folder, styleUrl and description, because the app keys its layer
styling off `style` and shows `desc` in popups. Coordinates are rounded to 7dp
(~0.04 ft at this latitude), which keeps toSP() reproducing the recorded plan
corners and the deed line table to the hundredth of a foot it is verified to.
6dp was ~0.4 ft and swamped that by an order of magnitude, for 11 KB.

    python3 scripts/kml_to_geojson.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/parcel-source.kml"
OUT = ROOT / "data/parcel.geojson"


def coords(text, r=7):
    out = []
    for tok in text.split():
        p = tok.split(",")
        if len(p) >= 2:
            out.append([round(float(p[0]), r), round(float(p[1]), r)])
    return out


def strip_html(h):
    return re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", " | ", h)).strip()


def main():
    # Pinned for the same reason build.py pins it: the Windows default codec is
    # cp1252, and the KML's degree signs decode as 'A°' under it. A default run
    # here rewrites every bearing in all 21 course and corner descriptions and
    # grows the file 126 bytes, silently, into the locked Pages build.
    s = SRC.read_text(encoding="utf-8")
    feats, folder = [], None

    pat = r"<Folder><name>(.*?)</name>|<Placemark><name>(.*?)</name>(.*?)</Placemark>"
    for m in re.finditer(pat, s, re.S):
        if m.group(1):
            folder = m.group(1)
            continue
        name, body = m.group(2), m.group(3)

        d = re.search(r"<description><!\[CDATA\[(.*?)\]\]></description>", body, re.S)
        style = re.search(r"<styleUrl>#(.*?)</styleUrl>", body)
        c = re.search(r"<coordinates>(.*?)</coordinates>", body, re.S)
        if not c:
            continue
        cc = coords(c.group(1))

        if "<Polygon>" in body:
            if cc[0] != cc[-1]:
                cc.append(cc[0])
            geom = {"type": "Polygon", "coordinates": [cc]}
        elif "<LineString>" in body:
            geom = {"type": "LineString", "coordinates": cc}
        else:
            geom = {"type": "Point", "coordinates": cc[0]}

        feats.append({
            "type": "Feature",
            "properties": {
                "name": name,
                "desc": strip_html(d.group(1)) if d else "",
                "style": style.group(1) if style else "",
                "folder": folder,
            },
            "geometry": geom,
        })

    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                              separators=(",", ":")),
                   encoding="utf-8", newline="\n")
    kinds = {}
    for f in feats:
        kinds[f["geometry"]["type"]] = kinds.get(f["geometry"]["type"], 0) + 1
    print(f"{len(feats)} features -> {OUT.name}  {kinds}")


if __name__ == "__main__":
    main()
