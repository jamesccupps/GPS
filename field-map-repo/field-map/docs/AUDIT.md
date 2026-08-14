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

---

# Second pass — the multi-agent audit

61 confirmed findings from eight parallel audits, each adversarially re-checked,
plus 10 a completeness pass found that all eight had missed. Every
high-severity item below is fixed. Same rule as above: kept because the reasoning
is worth having.

## "Cache this view" stored real tiles of the wrong place
The worst one, and no dimension caught it. `L.TileLayer.getTileUrl()` fills `{z}`
from the *layer's current* zoom, not the coords handed to it. On screen those
always agree, so it was invisible — but the pre-cache loop walks z0..z0+3 while
the map sits at z0. A z17 job fetched `tile/16/47659/39972` and filed it under
`sat/17/…`, the exact key the app reads offline at z17. z18 and z19 asked for
indices past the z0 grid, failed, and read as a flaky server. The zooms you
actually work at were never stored. Existing caches could not be salvaged — a
poisoned tile is indistinguishable from a good one — so `fm_tilez` drops the
store once on upgrade.

## Applying a Fit did not move the navigation target
`navT` and `navLine` hold absolute lat/lon resolved at the moment navigation
started. Nothing re-resolved them. Find the pipe mid-walk, average, Apply: the
polygon and corner dots jump, the arrow keeps steering to the pre-shift position.
You walk until the distance zeroes, get the within-12-ft buzz, and dig a
shift-length — 10–20 ft, exactly the range where you blame yourself — from the
corner the app is drawing. Walk-a-line was worse, reporting "0.0 ft off line"
while you stood a full shift off it.

## The track lived only in RAM
`trk.pts[0]` *is* "Back to start". Android suspends the page when the screen
sleeps and a suspend can become a discard. Now persisted to IndexedDB on a 15 s
ceiling and recovered on boot if younger than 18 hours. Pressing "Record track"
after a stop also used to wipe the morning silently and strand its polyline with
no way to clear it short of a reload.

## Twenty minutes standing still recorded 12,584 ft
`trk.push()` gated on a flat 3 ft move with no reference to accuracy. Under
canopy at 50 ft accuracy with 1 Hz fixes wandering 5–15 ft, every sample cleared
it and `dt=1` counted all of it as moving. Measured over 1,200 synthetic fixes:
12,584 ft and twenty minutes "moving" for a walk that never happened. Now 0 ft,
while a real 645 ft walk still measures 645. Separately, the first fix after a
ten-minute gap was hundreds of feet away and its distance was *added* — a
straight line through the swamp you walked around.

The other half of that gate has a field consequence worth knowing: fixes
reporting worse than 65 ft accuracy are dropped outright, so under heavy enough
canopy the track can record **nothing** — and "Back to start" is `trk.pts[0]`.
It toasts once when it starts skipping, which is the only warning you get.

## The averaging window was closed by a timer, not by the data
`push()` had no upper bound; only a `setTimeout` chain ended collection. Chrome
throttles timers in a hidden page to ~1/min while `watchPosition` keeps
delivering. Switch apps mid-average, pocket the phone, walk to the truck, and
every fix along the way landed in the mean — the mean `applyFit()` reads to
translate the entire parcel. Now closed by each sample's own timestamp.

## The crosshair was 138 ft off in landscape
`#xh` has no positioned ancestor, so `left:50%` resolved against the viewport
while the wide layout moves the map to `left:392px`. The wide-layout block
patched it vertically only. A 412×915 phone *in landscape* is 915 px wide, so
this fired on the phone, not just a desktop.

## Symbols never scaled with zoom
Leaflet stroke weight and `circleMarker` radius are screen-space constants. At
the zoom the app opens at, the boundary drew 20 ft wide and a plan corner 62 ft
across; two steps out, 248 ft. A monument located to hundredths was an 85 ft
blob. Now sub-linear and clamped about a z18 reference.

## Rotation tore down the canvas on every raw input event
leaflet-rotate binds `rotate: this._update` on every renderer; for canvas that
reallocates and repaints every path synchronously, once per touchmove and once
per magnetometer sample. `_update` also writes `this._zoom` from the *fractional*
pinch zoom, so the cheap CSS scale that lets canvas vectors track a pinch never
applied. Coalesced to one rebuild per frame.

## Timestamps trusted a clock that goes wrong in the cold
The merge is last-writer-wins on a client timestamp. A phone that goes flat in
the cold and restarts off a battery pack comes back with whatever the RTC held,
with no signal for NTP. The morning's marks were stamped in the past — older than
any remote copy and older than tombstones, which drops re-created marks outright.
Stamps are now monotonic on every path that writes a mark in normal use —
`addMark`, sheet Save, the delete tombstone, Undo and the sync `PUT`. Import is
deliberately excluded: it preserves the `recorded` date from the file, which is
the point of a restore.

## Four silent data-loss paths in storage
Dismissing the storage-full banner latched the warning off permanently.
`store.get()` preferred a stale `localStorage` over fresher `mem`, so the export
the banner demanded reported the *previous* export. The boot photo sweep treated
an unreadable mark list as proof every photo was orphaned. And
`navigator.storage.persist()` was never called, so the tile cache's own pressure
could evict the marks.

## The lock leaked the road name
A comment reading `GEOID18 at Hobart Road`, added while fixing elevation, shipped
in the clear inside the locked public file — `app.js` is not encrypted, only the
parcel payload is. `TELLTALES` listed the deed book and the abutter but not the
place, so `lock.py` would have refused a file containing "Bk 10912" while happily
publishing one that named the road. Both are on the list now — and the guard was
widened, because it only ever inspected the one HTML file `lock()` writes.
`sw.js`, the manifest and the icons are copied into `_site` beside it and were
never scanned at all; `lock.py --scan` now walks the whole publish tree, and the
deploy runs it.

## Injection sinks `esc()` never covered
`renderList()` interpolated `m.id` and `m.photos[0]` into HTML attributes
unescaped, reachable via sync. Marks arriving over sync bypassed every check the
import path applies. CSV export did not neutralise a leading `= + - @`, which
Excel evaluates. KML put notes raw inside CDATA, which `]]>` closes.

## Restoring your own export duplicated every mark
The importer minted a fresh id per feature and pushed blind, then handed the
duplicates to sync where they cannot be de-duplicated. It also discarded the
`recorded` date and the accuracy that `bundle()` had just written.

## Photos were destroyed behind Cancel
Deleting a mark purged its blobs one line before offering Undo. Removing a photo
in the sheet called `idbDel` immediately, so a fat-fingered X plus Cancel lost it
anyway. The delete X overlapped the thumbnail and won hit-testing. And the auto
heading note was written to the live mark, so Save — assigning from a textarea
populated before the photo — wiped it, while Cancel kept it.

## Android-specific, found on the device
The bottom tray took no touches at all: `targetSdk 35` means Android 15 lays the
window out behind the system bars, putting the panel's lower ~48dp under the
gesture strip where the system consumes touches. And GPS never fired, because the
shim delegated to the WebView's own geolocation when the Capacitor bridge was not
yet up — and that has no permission plumbing on Android, so the watcher was
created and never fired. A build-time `__FIELDMAP_NATIVE__` marker now
distinguishes "APK without a bridge yet" from "ordinary browser".

## Second Android pass, found on the device

Both of these survived the first device fix and looked like the same bug
reported again, which is why they are worth writing down separately.

**Every tap on the tray was cancelled by the tray's own drag handler.** The tab
buttons sit inside `#head`, and `#head` began a sheet drag on `touchstart`. The
first `touchmove` — a finger always produces one — then called
`preventDefault()`, and cancelling `touchmove` suppresses the click the tabs are
wired to. The grip still lit up from `#head:active` and the map still panned,
because the map is outside `#head`, so the tray looked alive and took nothing.
It passed on the desk every single time: a mouse never sends `touchmove`. The
fix is a 6 px threshold before the drag claims the gesture.

**`onPos` was throwing on every fix while the counter climbed.** The status line
read `fixes 8` beside three dashes. `native.js` increments before invoking the
app's callback, which pinned the fault inside `onPos`: `L.circle()` throws
`Circle radius cannot be NaN` one line before `paintPos()` writes anything.
Worse than the crash, a NaN accuracy also reaches `avg.push()`'s
inverse-variance weight, so an averaged mark would come out quietly NaN — so the
fix refuses the position rather than inventing an accuracy the receiver never
reported. The check is `typeof`-based because `isFinite(null)` is true.

The exception was invisible because it unwound into the plugin's callback, which
swallows it. `native.js` now catches and displays it. **The general lesson: a
callback boundary owned by someone else's plugin is a place exceptions go to
die, and a liveness counter on one side of that boundary proves nothing about
the other side.**

## The one that mattered: a plugin proxy that throws

Found only because the status line reported `app threw: Cannot access 'avg'
before initialization` from the handset. A `let` is in its temporal dead zone
*permanently* only if its declaration never executed, which located the fault
without a debugger: app.js had stopped running partway down.

Capacitor hands back a proxy for a plugin the bridge has not registered yet. The
object is truthy and `typeof x.addWatcher` is `"function"`; calling it throws
synchronously. app.js calls `watchPosition` once, at the top level, while the
body is still parsing -- so the exception did not fail the GPS, it **aborted the
remaining two thirds of app.js**. The tab wiring and the tray drag handlers were
never reached, `avg` never initialised, and `adoptFallbacks()` later started the
watcher anyway, feeding fixes into an `onPos` whose file had stopped loading.

Three symptoms, one cause, and each one sent the previous session somewhere
useless: a tray taking clicks and doing nothing, dashes above a climbing fix
counter, and a drag that would not drag.

It cannot reproduce in a browser. With no `window.Capacitor`, `plugin()` returns
null and `start()` returns false before touching anything -- every desk test
passed while the handset was dead. `native/scripts/bridge_harness.py` supplies
the missing condition: a bridge that is present and hostile, harsher than
reality, where every method of every plugin throws. Under it, app.js now runs to
completion and the tray works.

**The rule this leaves behind: nothing in native.js may throw into app.js.** The
shim is called during body parse, so an exception escaping it is not a failed
feature, it is a truncated program. Every bridge lookup goes through
`pluginNamed()` and every call site is wrapped.

## Second Android review, after the app first worked in the field

**Every export did nothing.** A WebView ignores `<a download>` unless the host
installs a `DownloadListener`, and Capacitor installs none -- there is no
`setDownloadListener` anywhere in its Android source. GeoJSON, CSV, KML, the
recorded track and the photo zip each built a blob URL, clicked an anchor, and
produced no file and no error. `markExported()` then recorded a successful
backup, so the Map tab said the marks were safe. This was the export the user is
told to run before the uninstall an unsigned build forces on them, which made it
the only path whose failure could actually lose data. Now written natively
through MediaStore, with `dl()` resolving true only when the bytes are on disk.

**The foreground service had no notification.** The geolocation plugin declares
`POST_NOTIFICATIONS` and never requests it; from Android 13 the declaration
grants nothing. Tracking continued with the screen off with nothing on screen
saying so. Requested when a track starts.

**The status line covered the compass.** It was positioned over the same band
`--topH` reserves for the compass, target bar, fit bar and permission banner.
Growing that variable moves all of them.

**"OUT 125531 ft".** True, and 23.8 miles. Feet below a mile, miles above it.

**"LOCATION PERMISSION DENIED" on first launch, before Android asked.** The
plugin reports a permission error the instant `addWatcher` runs, during body
parse. Held until `ensurePermission()` is actually refused -- and the copy told
the user to open Chrome's site settings, in an APK, which has none.

Checked and found sound, so recorded here to stop the next session re-checking:
all six basemaps -- Esri imagery and topo, both USGS layers, OSM, and the Maine
statewide LiDAR hillshade `exportImage` -- answer a cross-origin `fetch` with
usable CORS headers, so offline tile caching genuinely works in the APK.
Capacitor's `BridgeWebChromeClient` implements `onShowFileChooser`, so the photo
capture input works. The plugin manifest supplies `FOREGROUND_SERVICE_LOCATION`
and `foregroundServiceType="location"`, which targetSdk 35 requires.
