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
