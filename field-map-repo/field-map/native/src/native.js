/* ══════════════════════════════════════════════════════════════════════
   NATIVE GEOLOCATION SHIM

   The whole reason the APK exists: Android suspends the WebView when the
   screen sleeps, so a recorded track stops. A foreground service keeps the
   fixes coming.

   app.js asks for position in exactly one place -- one watchPosition call in
   section 7 -- so replacing navigator.geolocation before app.js runs is
   enough. app.js is not modified and does not know this file exists, which is
   what keeps the web build and the APK the same program.

   Two pieces of ordering matter here:

   1. loader.js calls runApp() synchronously while the body is parsing, so
      app.js calls watchPosition before DOMContentLoaded. The replacement has
      to be installed from <head>, synchronously, or it is already too late.
   2. At that moment the Capacitor bridge may not have injected window.Capacitor
      yet. So the plugin is resolved lazily, at call time, and anything we
      cannot serve natively is delegated to the geolocation object we replaced.
      In a plain browser that delegation is the whole behaviour, which is why
      www/ can still be opened in Chrome and behave exactly like the web build.

   Loaded from a <script src> rather than inlined: inside an APK every asset is
   local, so the single-file rule that governs the web build does not apply.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var orig = navigator.geolocation;          // may be undefined; guarded below

  function plugin() {
    var cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    return (cap.Plugins && cap.Plugins.BackgroundGeolocation) || null;
  }

  /* The plugin reports bearing/time; the W3C shape app.js reads is
     coords.heading/timestamp. app.js already gates heading on speed. */
  function toPosition(l) {
    return {
      coords: {
        latitude: l.latitude, longitude: l.longitude, accuracy: l.accuracy,
        altitude: (l.altitude == null ? null : l.altitude),
        altitudeAccuracy: (l.altitudeAccuracy == null ? null : l.altitudeAccuracy),
        speed: (l.speed == null ? null : l.speed),
        heading: (l.bearing == null ? null : l.bearing)
      },
      timestamp: (l.time == null ? Date.now() : l.time)
    };
  }

  /* onErr() switches on e.code: 1 denied, 2 unavailable, 3 timeout. */
  function toError(err) {
    var s = String((err && (err.code || err.message)) || '').toUpperCase();
    var code = 2;
    if (s.indexOf('AUTHOR') >= 0 || s.indexOf('DENIED') >= 0 || s.indexOf('PERMISSION') >= 0) code = 1;
    else if (s.indexOf('TIMEOUT') >= 0) code = 3;
    return { code: code, message: (err && err.message) || s || 'location unavailable',
             PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
  }

  var watchers = {};      // our id -> entry
  var nextId = 1;

  function start(entry, background) {
    var BG = plugin();
    if (!BG) return false;
    var opts = { requestPermissions: true, stale: false, distanceFilter: 0 };
    if (background) {
      // Supplying these is what promotes the watcher to a foreground service.
      opts.backgroundTitle = 'Field Map';
      opts.backgroundMessage = 'Recording your track.';
    }
    entry.background = background;
    BG.addWatcher(opts, function (location, error) {
      if (error) { if (entry.error) entry.error(toError(error)); return; }
      if (location && entry.success) entry.success(toPosition(location));
    }).then(function (id) {
      if (entry.dead) BG.removeWatcher({ id: id });   // cleared before the promise resolved
      else entry.id = id;
    }).catch(function (e) {
      if (entry.error) entry.error(toError(e));
    });
    return true;
  }

  function stop(entry) {
    var BG = plugin();
    entry.dead = true;
    if (entry.id && BG) { BG.removeWatcher({ id: entry.id }); }
    entry.id = null;
  }

  var geo = {
    watchPosition: function (success, error, options) {
      var entry = { dead: false, id: null, success: success, error: error, background: false };
      if (!start(entry, false)) {
        return orig ? orig.watchPosition(success, error, options) : undefined;
      }
      var key = nextId++;
      entry.native = true;
      watchers[key] = entry;
      return key;
    },
    clearWatch: function (key) {
      var entry = watchers[key];
      if (entry) { stop(entry); delete watchers[key]; }
      else if (orig) orig.clearWatch(key);
    },
    getCurrentPosition: function (success, error, options) {
      var entry = { dead: false, id: null, background: false };
      entry.success = function (pos) { stop(entry); if (success) success(pos); };
      entry.error = function (e) { stop(entry); if (error) error(e); };
      if (!start(entry, false) && orig) orig.getCurrentPosition(success, error, options);
    }
  };

  // navigator.geolocation is a prototype getter; an own property shadows it.
  try {
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true, writable: true });
  } catch (e) {
    console.warn('[native] could not replace navigator.geolocation:', e);
    return;
  }

  /* ── Promote to background only while a track is recording ──────────────
     A foreground service means a permanent notification and a real battery
     cost, so it should not run just because the map is open. app.js puts the
     class "rec" on #bTrk while recording, which is the only signal available
     without editing it. #bTrk is static markup in index.html, but this file
     runs from <head>, so the body is not parsed yet -- hence the wait.

     If that element ever goes missing the fallback is to stay in background
     permanently: noisy, but it never silently loses the track the APK exists
     to record. */
  function rebind(background) {
    Object.keys(watchers).forEach(function (key) {
      var entry = watchers[key];
      if (entry.dead || entry.background === background) return;
      var success = entry.success, error = entry.error;
      stop(entry);
      var fresh = { dead: false, id: null, success: success, error: error, native: true };
      watchers[key] = fresh;
      start(fresh, background);
    });
  }

  function armTrackFollow() {
    if (!plugin()) return;                       // browser: nothing to promote
    var btn = document.getElementById('bTrk');
    if (!btn) {
      console.warn('[native] #bTrk not found; staying in background so tracks are never lost');
      rebind(true);
      return;
    }
    var recording = btn.classList.contains('rec');
    if (recording) rebind(true);
    new MutationObserver(function () {
      var now = btn.classList.contains('rec');
      if (now !== recording) { recording = now; rebind(now); }
    }).observe(btn, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', armTrackFollow);
  else armTrackFollow();
})();
