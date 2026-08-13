# Where things stand

Written at the end of the session that landed commits `322d550..1d345ed` (30 of
them; `git log --oneline 322d550..HEAD`). `CLAUDE.md` is still the doc to read first; this one covers what is
*decided*, what is *open*, and what is waiting on James rather than on code.

---

## Live right now

| | |
|---|---|
| Pages (locked) | https://jamesccupps.github.io/GPS/ |
| APK (unlocked) | https://github.com/jamesccupps/GPS/releases/latest/download/field-map.apk |

Both rebuild on pushes to `main`, but on **different path filters**: Pages on
anything under `field-map-repo/field-map/`, the APK on `native/`, `src/`,
`data/`, `scripts/` and `vendor/`. The last two are in that list because
`assemble.py` runs `build.py`, which concatenates `vendor/` — they were missing
at first, so a Leaflet bump or a `build.py` change would have shipped to Pages
and left the APK silently stale.

The Pages copy is encrypted with the
`FIELDMAP_PASSPHRASE` secret; the APK is not, deliberately, because a passphrase
gate on every launch in the woods costs something and buys nothing on a phone you
sideloaded yourself.

---

## Blocked on James

### 1. Stable signing key — the one that costs data today

CI signs each build with a fresh runner-generated debug key, so Android refuses
every in-place update (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, surfacing as a bare
"App not installed"). The only route is uninstall, **which wipes every mark**.
Export before you do it; `allowBackup` does not survive a user-initiated
uninstall.

Generate once, locally, and back the file up offline — lose it and you are back
to uninstall-to-update permanently:

```
keytool -genkeypair -v -keystore fieldmap-release.jks -storetype PKCS12 \
  -alias fieldmap -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Field Map, O=jamesccupps, C=US"
```

PKCS12 requires the store and key passwords to be identical. Then base64 it and
add four repo secrets: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (`fieldmap`), `ANDROID_KEY_PASSWORD`. Claude wires the Gradle
`signingConfig` and the workflow; the key and the passwords stay yours.

**Bump `versionCode` in the same change** (`github.run_number`, not `run_id` —
that overflows the 2.1e9 ceiling). It is hardcoded at
`native/android/app/build.gradle:11` with no override hook, so wiring it means
editing that line as well as passing the value from `apk.yml`. Capacitor clears
its persisted web-content path when versionCode **or versionName** changes
(`Bridge.isNewBinary`), so a stable key without a version bump would let a stale
downloaded bundle outrank a freshly installed APK. They are one task.

Moving to `assembleRelease` also drops `android:debuggable=true` — injected by
AGP into debug builds, so grepping the manifest for it finds nothing — which
today lets any authorised USB host `run-as` the package and read your tracks off
the phone. Not a two-line change: `build.gradle` has no `signingConfigs` block
at all, and `apk.yml` refers to the debug APK path in several places.

### 2. Two decisions before content OTA

- **Publishing the unlocked web assets.** OTA needs `native/www/index.html` on
  the release. Strictly that leaks nothing new — the published APK already
  contains the unlocked parcel and its release notes say so — but it drops the
  effort from "unzip an APK" to "click a link". Decide it knowingly.
- **Token circularity.** The app stores a `contents: write` PAT in plaintext
  `localStorage`, scoped to *this* repo — the same repo it would update from, and
  fine-grained `Contents: write` covers release assets. Add OTA and a hostile
  bundle could read the token from the origin it runs in and publish the next
  "update" to itself. Fix by putting marks sync in a **different repo** from the
  update source. Cheaper than it sounds: the sync panel already takes an explicit
  owner/repo (`src/index.html:294-295`, applied at `src/app.js:1625-1626`) and
  `detectRepo()` only supplies the default — so this is configuration plus a
  second fine-grained token, not new UI.

### 3. First-run report from the phone

The native sensors are compile-verified by CI and browser-verified for the
no-plugin path, but **no sensor here has run on a real handset**. The APK carries
an on-screen status line under the top bar: fix count and age, and on tap the
bridge / plugin / sensor / inset state. Long-press dismisses it. What it reads on
first launch is the fastest way to confirm or kill the remaining diagnosis.

---

## Decided, and why

- **APK ships unlocked, Pages ships locked.** Different threat models.
- **`app.js` is never modified by the native wrapper.** It calls `watchPosition`
  exactly once, so `native/src/native.js` replaces `navigator.geolocation` ahead
  of it and injects its UI at runtime. That is what keeps the two builds one
  program, and it is worth preserving.
- **Content OTA over APK self-install.** `REQUEST_INSTALL_PACKAGES` is not
  recommended: the content path covers nearly everything, and the permission's
  real cost is training yourself to tap Install on a prompt your own app raised.
- **Not `@capgo/capacitor-updater`.** It works and is MPL-2.0, but on Android it
  is the same `setServerBasePath` underneath, wrapped in ~400 KB of channels,
  deltas and a rollback state machine this two-file app does not need.
- **Not `server.url` pointing at Pages.** Needs network every launch, changes the
  origin so `localStorage` and IndexedDB vanish, and Pages serves the *locked*
  build — the APK would become unopenable.
- **No cert pinning.** TLS to github.com does the real work; pinning is an
  outage waiting for a CA rotation, on a tool relied on in the woods.
- **`user-scalable=no` stays.** The type scale fix removed the reason to pinch,
  and accidental UI zoom during a map pinch with gloves has no easy undo.
- **`addon/` is untouched.** Out of scope by instruction. It has at least one
  known issue (a corrupt `/data/marks.json` is treated as empty and the next sync
  overwrites it) that was deliberately not fixed.

---

## Audit status

Per `docs/AUDIT.md`: 61 confirmed findings across eight parallel audits, each
adversarially re-checked, plus 10 from a completeness pass. Every high-severity
item is fixed, along with most mediums. Those counts come from that session and
are **not re-derivable from the repo** — treat them as provenance, not as a
claim to verify.

Deliberately still open, all low or judgement-dependent: cached tiles carry no
age stamp; photos are decoded twice on capture; edit-sheet Save loses an edit if
the mark synced away underneath it; `lockFile`'s "pristine" re-fetch can be
answered by the service worker cache.

---

## Environment traps

- **Gradle cannot run on the dev machine.** `Selector.open()` fails —
  `sun.nio.ch.PipeImpl`'s AF_UNIX self-connection returns `EINVAL`. Not the temp
  directory, not IPv6, not the selector provider; all were tested. Any Java tool
  that opens a selector is affected. CI is the feedback loop, so cheap pre-checks
  in the workflow earn their keep.
- **Windows encoding.** `build.py` pins utf-8 and LF explicitly. cp1252 cannot
  decode the section banners in `app.js`.
- **`core.autocrlf=true`** with a scoped `.gitattributes` for `gradlew`. The exec
  bit on `gradlew` had to be set with `git update-index --chmod=+x`.
- **Re-cache tiles after any tile-cache change.** The zoom fix wiped the store
  once (`fm_tilez`), because a poisoned tile is indistinguishable from a good one.
