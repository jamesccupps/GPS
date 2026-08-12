# Bugs found and fixed

Kept because several were subtle, and the reasoning is worth having if similar
code gets written again.

## Silent data loss
`store.set()` caught storage exceptions and discarded them. Once localStorage hit
quota — photos and a few hundred marks will do it — every save failed silently.
Marks looked fine all day and were gone on reload.
Now the write returns a status, a banner tells the user to export immediately,
and it clears when storage recovers.

## Compass was 14.5° off
Magnetometer reads magnetic north; everything else in the app is grid. No
declination was applied. 128 ft of error over 500 ft. `declination()` now
applies WMM-2025 (−14.552°, +0.0897°/yr) with the current-date value shown.

## Two navigation modes at once
Following a line and navigating to a mark could both be active, each writing the
same readout every fix. `setNav()` and the line handler now clear each other.

## Orphaned photo blobs
Deleting a mark left its images in IndexedDB forever — unreachable and
unclearable. Deletes now clean up, and a boot sweep reclaims anything stranded
by earlier versions.

## Import accepted garbage
No validation: `NaN` coordinates, points at 999°, and raw HTML in names all went
straight into marks. A `NaN` corrupts the Leaflet layer. Now range-checked and
markup-stripped, with a count of skipped features.

## XSS via tooltips
Mark names went into Leaflet tooltips as HTML. An imported name could execute.
Escaped now.

## Object URL leak
Every list render minted blob URLs and never released them; the search box
re-renders per keystroke. Now revoked on re-render.

## 400 ms per GPS fix
`paintMarks()` rebuilt the entire list DOM on every position update just to
refresh distances — 400 ms at 250 marks, once per second. Split into a DOM
rebuild (only when marks change) and an in-place text patch (throttled, skipped
when the tab is hidden). Now 4.4 ms at 250 marks.

## Crosshair misaligned
Sat 28 px above the map's true centre, so tap-to-mark placed points north of
where the crosshair pointed. The offset assumed a status-bar height it should
have measured.

## "Moving time" was elapsed time
36 ft over an hour displayed as "60 min," implying walking. Now sums only
contiguous motion and shows moving/elapsed separately.

## Wake lock released early
Finished averaging released the lock even if a track was still recording.

## Fragile popup buttons
"Navigate here" built a JS call inside an HTML attribute. Two monument names
contain a double quote (`1" iron pipe found`). Worked by luck. Now a delegated
handler reading a data attribute.

## Locked copy leaked the parcel
`lockFile()` serialised the live DOM, which had already been populated with
runtime state — dropdown options carried feature names straight into the
"locked" file, and the injected app script shipped with it. Now re-fetches its
own pristine source.

## Stack overflow on large payloads
`b64e` spread a 138 KB Uint8Array as function arguments. Chunked now.

## Service worker never registered
Bound to the `load` event, which had already fired. Checks `readyState` first.

## GitHub Pages served a 10-minute app
`Cache-Control: max-age=600` means that without a service worker the app
disappears ten minutes after the last load — the exact failure you would hit
cold-starting in the woods. This is why `sw.js` is not optional.
