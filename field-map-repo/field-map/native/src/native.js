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
  var fixCount = 0, lastFixAt = 0, lastGeoErr = '', lastAppErr = '';   // surfaced by the status line

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
      /* An exception thrown by app.js in here is otherwise invisible: it unwinds
         into the plugin's callback, which swallows it, and the next fix arrives
         as if nothing happened. The counter climbs while every readout stays
         blank -- which is precisely what "the GPS isn't working" looked like on
         the first handset, and it cost a build round-trip to find. Catch it and
         put it on the screen. */
      var counted = function (pos) {
        fixCount++; lastFixAt = Date.now();
        if (!success) return;
        try { success(pos); }
        catch (e) { lastAppErr = 'app threw: ' + ((e && e.message) || e); }
      };
      var failed  = function (e) { lastGeoErr = 'error ' + (e && e.code); if (error) error(e); };
      var entry = { dead: false, id: null, success: counted, error: failed, background: false };
      var key = nextId++;
      watchers[key] = entry;

      if (start(entry, false)) { entry.native = true; return key; }

      /* The bridge is not up yet. In a browser that means delegate. In the APK it
         does NOT: the WebView's own geolocation has no permission plumbing here,
         so delegating produces a watcher that never fires and looks exactly like
         a broken GPS -- which is what the first build did. Wait for the plugin
         instead; adoptFallbacks() starts it the moment it appears. */
      if (window.__FIELDMAP_NATIVE__) entry.pendingNative = true;
      else entry.fallbackId = orig ? orig.watchPosition(counted, failed, options) : null;
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
      if (entry.dead) return;
      if (entry.fallbackId == null && !entry.pendingNative) return;   // already native
      if (entry.fallbackId != null && orig) { try { orig.clearWatch(entry.fallbackId); } catch (e) {} }
      entry.fallbackId = null;
      entry.pendingNative = false;
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
        if (++tries >= 40) {                      /* 20 s: a cold start on a big page */
          clearInterval(poll);
          lastGeoErr = 'geolocation plugin missing';
          if (window.__FIELDMAP_NATIVE__)
            console.error('[native] BackgroundGeolocation never appeared; this APK cannot record position');
        }
      }, 500);
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
    injectDiag();                             // APK only; tells us what is actually wrong
    watchTray();                              // APK only; counts what the tray receives
    if (window.__FIELDMAP_NATIVE__) {
      ensurePermission().then(function (st) {
        if (st !== 'granted') lastGeoErr = 'location ' + st;
        adoptFallbacks();                     // permission may unblock the watcher
      });
    }
    if (!FS() && !PREFS()) return;            // browser: nothing further to add
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

  /* ══════════════════════════════════════════════════════════════════════
     NATIVE STATUS LINE

     The first APK looked alive and did nothing: the tray took no touches and no
     fix ever arrived, with no way to tell which of half a dozen causes it was.
     This is a one-line readout pinned under the status bar in the APK only, so
     the answer is on the screen instead of behind a USB cable. Tap it to cycle
     detail, long-press to hide for the session.
     ══════════════════════════════════════════════════════════════════════ */
  var IN_APK = !!window.__FIELDMAP_NATIVE__;
  var diagEl = null, diagMode = 0;

  /* Tray telemetry. "The tray does nothing" has three very different causes and
     they are indistinguishable by eye: the touches never arrive, or they arrive
     and the gesture is cancelled before a click can be synthesised, or a click
     fires and the handler does nothing. Counting them on #panel separates the
     three in one glance, and records what was actually under the finger --
     hit-testing landing somewhere other than where the button is drawn looks
     identical to a dead button. */
  var tray = { s: 0, m: 0, e: 0, c: 0, k: 0, hit: '' };
  function watchTray() {
    var panel = document.getElementById('panel');
    if (!IN_APK || !panel) return;
    var kinds = { touchstart: 's', touchmove: 'm', touchend: 'e', touchcancel: 'c', click: 'k' };
    Object.keys(kinds).forEach(function (type) {
      panel.addEventListener(type, function (e) {
        tray[kinds[type]]++;
        if (type === 'touchstart' || type === 'click') {
          var t = e.target || {};
          tray.hit = String(t.tagName || '?').toLowerCase()
                   + (t.id ? '#' + t.id : '')
                   + (t.className && t.className.baseVal === undefined
                      ? '.' + String(t.className).trim().split(/\s+/).join('.') : '');
          if (tray.hit.length > 28) tray.hit = tray.hit.slice(0, 28);
        }
      }, true);
    });
  }

  function diagText() {
    var cap = window.Capacitor;
    var bridge = cap ? (cap.isNativePlatform && cap.isNativePlatform() ? 'native' : 'web') : 'none';
    var bg = (cap && cap.Plugins && cap.Plugins.BackgroundGeolocation) ? 'yes' : 'NO';
    var fs = FS() ? 'yes' : 'no';
    var age = lastFixAt ? Math.round((Date.now() - lastFixAt) / 1000) + 's' : 'never';
    if (diagMode === 0) {
      return 'GPS ' + (fixCount ? fixCount + ' fixes, ' + age : 'no fix yet')
           + (lastGeoErr ? ' · ' + lastGeoErr : '')
           + (lastAppErr ? ' · ' + lastAppErr : '');
    }
    if (diagMode === 1) {
      return 'bridge ' + bridge + ' · geo plugin ' + bg + ' · sensors ' + fs
           + ' · fixes ' + fixCount + ' · inset ' + insetBottom() + 'px'
           + ' · build ' + (window.__FIELDMAP_BUILD__ || '?');
    }
    /* down/move/up/cancel/click, then what was under the finger */
    return 'tray  down ' + tray.s + ' · move ' + tray.m + ' · up ' + tray.e
         + ' · cancel ' + tray.c + ' · CLICK ' + tray.k
         + (tray.hit ? ' · ' + tray.hit : '');
  }
  function insetBottom() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--sab').trim();
    var n = parseFloat(v);
    return isFinite(n) ? Math.round(n) : 0;
  }
  function paintDiag() { if (diagEl) diagEl.textContent = diagText(); }
  function injectDiag() {
    if (!IN_APK || diagEl || !document.body) return;
    diagEl = document.createElement('div');
    diagEl.id = 'nvDiag';
    diagEl.style.cssText = 'position:absolute;left:0;right:0;z-index:1000;'
      + 'top:calc(env(safe-area-inset-top,0px) + 54px);'
      + 'background:rgba(14,17,22,.92);color:#78859A;font:12px/1.5 ui-monospace,monospace;'
      + 'padding:4px 10px;text-align:center;border-bottom:1px solid #2A3240';
    var press = 0;
    diagEl.addEventListener('touchstart', function () { press = Date.now(); }, { passive: true });
    diagEl.addEventListener('click', function () {
      /* press stays 0 until a touch sets it, and 0 makes every click look like a
         56-year long-press -- so any click arriving without one hid the line. */
      if (press && Date.now() - press > 600) { diagEl.remove(); diagEl = null; return; }
      diagMode = (diagMode + 1) % 3; paintDiag();
    });
    document.body.appendChild(diagEl);
    paintDiag();
    setInterval(paintDiag, 1000);
  }

  /* ── permission, requested when the Activity can actually show a dialog ──
     The plugin asks as part of addWatcher, but that call happens during body
     parse, which is far too early for a permission dialog. Ask again once the
     document is ready and report what came back, so "no fix" can be told apart
     from "never asked" and from "denied". */
  function ensurePermission() {
    var BG = plugin();
    if (!BG || !BG.checkPermissions) return Promise.resolve('unknown');
    return BG.checkPermissions().then(function (p) {
      var st = (p && (p.location || p.display)) || 'unknown';
      if (st === 'granted') return st;
      if (!BG.requestPermissions) return st;
      return BG.requestPermissions().then(function (r) {
        return (r && (r.location || r.display)) || 'denied';
      });
    }).catch(function () { return 'unknown'; });
  }

  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', startNative);
  else startNative();
})();

