# Field Map — Android wrapper

A Capacitor shell around the built web app, for one reason: Android suspends
the WebView when the screen sleeps, so a recorded track stops. A foreground
service keeps the fixes coming. Everything else the APK gains — surviving a
browser-data wipe, a launcher icon — is incidental.

`com.jamesccupps.fieldmap`

## How it stays out of the web app's way

`src/app.js` is not modified and knows nothing about this directory. It asks
for position in exactly one place, a single `watchPosition` call in section 7,
so `src/native.js` replaces `navigator.geolocation` before `app.js` runs and
feeds it fixes from the plugin instead. In a plain browser the shim finds no
Capacitor bridge and delegates to the real API, so `www/` behaves exactly like
`dist/`.

Two ordering constraints are load-bearing, both explained in `src/native.js`:
the shim has to be installed synchronously from `<head>` because `loader.js`
runs `app.js` while the body is still parsing, and the plugin has to be looked
up lazily at call time because the bridge may not have injected itself yet.

The foreground service is only started while a track is recording — `app.js`
puts the class `rec` on `#bTrk`, which is the only signal available without
editing it. Otherwise the notification and the battery cost would be permanent.

## The APK ships the unlocked build

The lock exists because a Pages site is public. An APK you sideloaded onto your
own phone is not, and a passphrase gate on every launch in the woods costs
something and buys nothing. `scripts/assemble.py` takes `../dist/field-map.html`
as-is and makes exactly two one-line changes: it injects the shim, and it
neuters the service worker, which inside an APK caches local assets over local
assets and can serve a stale app across an update.

## What the APK adds that a browser cannot

`FieldSensors.java` is a small custom Capacitor plugin covering the things the
web platform has no API for at all. Everything is polled and feature-detected, so
a phone missing any of it reads "none on this phone" rather than failing.

| | Why it needs native |
|---|---|
| **Barometer** | There is no web barometer API. GPS height under canopy is worth little; pressure differences are good to a couple of feet. Zero it on a monument and read the difference — CLAUDE.md lists this as a known gap. |
| **GNSS quality** | The web gives one accuracy number. `GnssStatus` gives satellites used/seen, per-satellite C/N0, and whether L5 is in the fix — the difference between "wait here" and "move out from under this hemlock". |
| **Compass calibration** | Android reports magnetometer accuracy; the web reports nothing, so the app could only ever detect "no compass at all", not "needs a figure-eight". |
| **Partial wake lock** | The web Wake Lock API is screen-on only, which is why averaging costs battery. `PARTIAL_WAKE_LOCK` holds the CPU with the screen off. |
| **App-private storage** | `localStorage` lives in the WebView quota and can be evicted. Marks are mirrored to Capacitor Preferences, which is not, and restored on boot if the WebView copy is gone. |

The readouts are injected into the Go tab at runtime by `src/native.js`. `app.js`
is still not modified and still does not know this file exists.

Not mirrored: photos and tiles. They are IndexedDB blobs and would be tens of
megabytes across the bridge on every save.

Still browser-only, deliberately: live data in the foreground-service
notification (the plugin owns that notification and its text is fixed at watcher
start), and anything needing hardware that is not here yet — external GNSS over
USB or Bluetooth, and a laser rangefinder.

## Install

The build publishes a rolling release, so the phone has one permanent link:

**https://github.com/jamesccupps/GPS/releases/latest/download/field-map.apk**

Tap it on the phone and allow installs from your browser if Android asks. Debug
-signed, so it sideloads without a Play account.

## Build

```bash
python3 scripts/assemble.py --build     # ../dist -> www/
npx cap sync android
cd android && ./gradlew assembleDebug   # gradlew.bat on Windows
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Install with
`adb install -r <apk>`, or copy it to the phone and open it.

`npm run apk` does all three.

## Prerequisites that are not obvious

| | |
|---|---|
| Node | **20 or 22**. Capacitor 8 requires Node 22; this project pins Capacitor 7, which runs on Node 20 so the system Node does not have to move. |
| JDK | **17 or 21**. Gradle 8.11 does not support JDK 24+, so a newer JDK that happens to be on the machine will not work. |
| SDK platform | `compileSdkVersion` in `android/variables.gradle` must be an `android-NN` you actually have installed under `platforms/`. |
| `android/local.properties` | `sdk.dir=` pointing at the SDK. Machine-specific and gitignored, so it does not survive a clone — recreate it. |

## First launch

Android asks for location, and separately for notifications on 13+. Both have
to be allowed or the foreground service cannot show its notification and will
not start. The plugin requests them itself (`requestPermissions: true`).

`ACCESS_BACKGROUND_LOCATION` is deliberately **not** requested. A foreground
service of type `location` started while the app is open does not need it, and
asking for it triggers a much harsher Android permission dialog.
