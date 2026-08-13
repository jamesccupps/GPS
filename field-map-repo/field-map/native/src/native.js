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
  /* offset so our ids cannot be mistaken for the platform's, which are also
     small integers -- a delegated watch and a native one could otherwise
     collide in clearWatch */
  var nextId = 900001;

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
      /* If the bridge is not up yet we fall back to the WebView's own
         geolocation -- but the entry is recorded either way. It previously
         returned early, so watchers stayed empty, and both promotion paths
         (rebind and armTrackFollow) key on watchers. A bridge that was merely
         late meant the APK ran on plain web geolocation for the whole session:
         GPS fine, track fine, and then it stops the moment the screen sleeps,
         which is the one thing the APK exists to prevent. Invisible until you
         look at the evening's track and find a straight line across the swamp. */
      if (!start(entry, false)) {
        entry.fallbackId = orig ? orig.watchPosition(success, error, options) : null;
      } else {
        entry.native = true;
      }
      var key = nextId++;
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

  /* Take over any watcher that had to start on the WebView's geolocation. */
  function adoptFallbacks() {
    if (!plugin()) return false;
    Object.keys(watchers).forEach(function (key) {
      var entry = watchers[key];
      if (entry.dead || entry.fallbackId == null) return;
      if (orig) { try { orig.clearWatch(entry.fallbackId); } catch (e) {} }
      entry.fallbackId = null;
      entry.native = true;
      start(entry, entry.background);
    });
    return true;
  }

  function armTrackFollow() {
    if (!plugin()) {
      /* A native build that never resolves the plugin cannot do the one thing
         it was built for, so say so rather than degrading quietly. */
      var tries = 0;
      var poll = setInterval(function () {
        if (adoptFallbacks()) { clearInterval(poll); armTrackFollow(); return; }
        if (++tries >= 10) {
          clearInterval(poll);
          if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
            console.error('[native] BackgroundGeolocation never appeared; this APK cannot record in the background');
        }
      }, 300);
      return;
    }
    adoptFallbacks();
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

  /* ══════════════════════════════════════════════════════════════════════
     THE SENSORS A BROWSER CANNOT REACH

     All of this is additive and feature-detected: app.js is still not modified
     and still does not know this file exists. Readouts are injected into the Go
     tab at runtime, so the web build is unchanged by any of it.
     ══════════════════════════════════════════════════════════════════════ */
  var FS = function () { var c = window.Capacitor; return (c && c.Plugins && c.Plugins.FieldSensors) || null; };
  var PREFS = function () { var c = window.Capacitor; return (c && c.Plugins && c.Plugins.Preferences) || null; };
  var FT_PER_M = 3.280839895;

  /* ── partial wake lock ──────────────────────────────────────────────────
     app.js asks for a SCREEN lock while averaging or recording, which is all the
     web can offer. Wrapping it adds a CPU lock alongside, so pressing the power
     button mid-average no longer ends the average. */
  (function wrapWakeLock() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    var origRequest = navigator.wakeLock.request.bind(navigator.wakeLock);
    navigator.wakeLock.request = function (type) {
      var plugin = FS();
      if (plugin) plugin.keepAwake({ on: true }).catch(function () {});
      return origRequest(type).then(function (sentinel) {
        var origRelease = sentinel.release.bind(sentinel);
        sentinel.release = function () {
          if (plugin) plugin.keepAwake({ on: false }).catch(function () {});
          return origRelease();
        };
        return sentinel;
      });
    };
  })();

  /* ── app-private storage ────────────────────────────────────────────────
     localStorage lives in the WebView's quota and can be evicted, which is the
     root of a whole class of "the marks are gone" failures. Preferences is
     app-private and is not subject to it. Mirror the small fm_ keys both ways:
     write-through on every set, restore on boot for anything the WebView lost.
     Photos and tiles are IndexedDB blobs and are deliberately not mirrored --
     that would be tens of megabytes through the bridge on every save. */
  var MIRROR = /^fm_/;
  function mirrorWrite(k, v) {
    var pr = PREFS(); if (!pr || !MIRROR.test(k)) return;
    pr.set({ key: k, value: String(v) }).catch(function () {});
  }
  function mirrorRemove(k) {
    var pr = PREFS(); if (!pr || !MIRROR.test(k)) return;
    pr.remove({ key: k }).catch(function () {});
  }
  (function wrapStorage() {
    if (!window.localStorage) return;
    try {
      var setItem = localStorage.setItem.bind(localStorage);
      var removeItem = localStorage.removeItem.bind(localStorage);
      localStorage.setItem = function (k, v) { var r = setItem(k, v); mirrorWrite(k, v); return r; };
      localStorage.removeItem = function (k) { var r = removeItem(k); mirrorRemove(k); return r; };
    } catch (e) { console.warn('[native] could not wrap localStorage:', e); }
  })();
  function restoreFromPrefs() {
    var pr = PREFS(); if (!pr) return Promise.resolve(0);
    return pr.keys().then(function (res) {
      var keys = (res && res.keys) || [], n = 0, chain = Promise.resolve();
      keys.filter(function (k) { return MIRROR.test(k); }).forEach(function (k) {
        chain = chain.then(function () {
          if (localStorage.getItem(k) != null) return;   // the WebView copy is the live one
          return pr.get({ key: k }).then(function (r) {
            if (r && r.value != null) { localStorage.setItem(k, r.value); n++; }
          });
        });
      });
      return chain.then(function () { return n; });
    }).catch(function () { return 0; });
  }

  /* ── injected readouts ────────────────────────────────────────────────── */
  var baroRef = null;
  function mk(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function dlRow(label, id) {
    var d = mk('dl', { 'class': 'dl' });
    d.appendChild(mk('dt', null, label));
    d.appendChild(mk('dd', { id: id }, '—'));
    return d;
  }
  function injectPanel() {
    var go = document.getElementById('t-go');
    if (!go || document.getElementById('nvBox')) return;
    var box = mk('div', { 'class': 'dat', id: 'nvBox' });
    box.appendChild(mk('h4', null, 'Phone sensors'));
    box.appendChild(dlRow('Satellites', 'nvSats'));
    box.appendChild(dlRow('Signal C/N0', 'nvCn0'));
    box.appendChild(dlRow('Compass', 'nvMag'));
    box.appendChild(dlRow('Barometer', 'nvBaro'));
    box.appendChild(dlRow('Height vs zero', 'nvRel'));
    var r = mk('div', { 'class': 'row', style: 'margin:9px 0 0' });
    var b = mk('button', { 'class': 'btn sm', id: 'nvZero' }, 'Zero height here');
    r.appendChild(b);
    box.appendChild(r);
    box.appendChild(mk('p', { 'class': 'hint', style: 'margin:9px 2px 0' },
      'GPS height is poor under canopy. Zero the barometer on a monument and the '
      + 'difference where you stand is good to a couple of feet — enough to tell '
      + 'a bank from a bench.'));
    go.appendChild(box);
    b.onclick = function () {
      var p = FS(); if (!p) return;
      p.pressure().then(function (v) {
        if (v && v.hPa != null) {
          baroRef = { hPa: v.hPa, isa: v.isaMetres };
          if (window.toast) window.toast('Height zeroed here');
        } else if (window.toast) window.toast('No barometer on this phone');
      }).catch(function () {});
    };
  }

  function paintSensors() {
    var p = FS(); if (!p) return;
    p.gnss().then(function (g) {
      var s = document.getElementById('nvSats'), c = document.getElementById('nvCn0');
      if (!s || !c) return;
      if (!g || !g.available) { s.textContent = 'needs location permission'; c.textContent = '—'; return; }
      s.textContent = g.used + ' used / ' + g.total + ' seen' + (g.l5 ? '  ·  ' + g.l5 + ' L5' : '');
      c.textContent = g.medianCn0 ? g.medianCn0.toFixed(0) + ' dB-Hz median, ' + g.bestCn0.toFixed(0) + ' best' : '—';
      /* below about 25 dB-Hz you are under canopy and waiting will not help */
      c.style.color = !g.medianCn0 ? '' : g.medianCn0 >= 30 ? 'var(--good)'
                    : g.medianCn0 >= 25 ? 'var(--warn)' : 'var(--bad)';
    }).catch(function () {});
    p.compassAccuracy().then(function (m) {
      var e = document.getElementById('nvMag'); if (!e) return;
      if (!m || !m.available) { e.textContent = 'no magnetometer'; e.style.color = 'var(--muted)'; return; }
      var names = { '-1': 'not reporting yet', '0': 'unreliable — figure-eight it',
                    '1': 'low — figure-eight it', '2': 'usable', '3': 'good' };
      e.textContent = names[String(m.accuracy)] || String(m.accuracy);
      e.style.color = m.accuracy >= 2 ? 'var(--good)' : m.accuracy >= 0 ? 'var(--warn)' : 'var(--muted)';
    }).catch(function () {});
    p.pressure().then(function (b) {
      var e = document.getElementById('nvBaro'), rel = document.getElementById('nvRel');
      if (!e || !rel) return;
      if (!b || !b.available || b.hPa == null) { e.textContent = 'none on this phone'; rel.textContent = '—'; return; }
      e.textContent = b.hPa.toFixed(2) + ' hPa';
      if (baroRef == null) { rel.textContent = 'zero it on a monument first'; rel.style.color = 'var(--muted)'; return; }
      var dFt = (b.isaMetres - baroRef.isa) * FT_PER_M;
      rel.textContent = (dFt >= 0 ? '+' : '') + dFt.toFixed(1) + ' ft';
      rel.style.color = '';
    }).catch(function () {});
  }

  function startNative() {
    if (!FS() && !PREFS()) return;            // browser: nothing to add
    injectPanel();
    restoreFromPrefs().then(function (n) {
      if (n && window.toast) window.toast('Recovered ' + n + ' item(s) from app storage');
    });
    paintSensors();
    setInterval(function () {
      var t = document.getElementById('t-go');   // bridge round-trips: only while visible
      if (t && t.classList.contains('on') && document.visibilityState === 'visible') paintSensors();
    }, 2000);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', startNative);
  else startNative();
})();

