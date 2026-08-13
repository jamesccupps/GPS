package com.jamesccupps.fieldmap;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.GnssStatus;
import android.location.LocationManager;
import android.os.Build;
import android.os.PowerManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The sensors a browser cannot reach.
 *
 * Everything here exists because the web platform has no equivalent, not because
 * native is tidier:
 *
 *   pressure   - there is no web barometer API at all, and GPS altitude on a
 *                wooded parcel is worth roughly nothing.
 *   GNSS       - the web gives one accuracy number. This gives satellite count,
 *                per-satellite C/N0 and whether L5 is in the fix, which is the
 *                difference between "wait" and "move out from under this tree".
 *   compass    - Android reports magnetometer calibration state; the web reports
 *                nothing, so the app could only detect "no compass at all".
 *   wake lock  - the web Wake Lock API is screen-on only, which is why averaging
 *                and tracking cost battery. PARTIAL keeps the CPU with the screen
 *                off.
 *
 * Everything is polled by the JS side rather than pushed, so a sensor that does
 * not exist reads as absent instead of throwing, and the same code runs on a
 * phone that has none of them.
 */
@CapacitorPlugin(name = "FieldSensors")
public class FieldSensors extends Plugin implements SensorEventListener {

    private SensorManager sensors;
    private Sensor pressure;
    private Sensor magnetic;

    private Float lastPressure = null;      // hPa
    private long lastPressureAt = 0;
    private int magAccuracy = -1;           // SensorManager.SENSOR_STATUS_*

    private LocationManager locations;
    private GnssStatus.Callback gnssCallback;
    private int satsTotal = 0, satsUsed = 0, satsL5 = 0;
    private float bestCn0 = 0f, medianCn0 = 0f;
    private long lastGnssAt = 0;

    private PowerManager.WakeLock wakeLock;

    @Override
    public void load() {
        Context ctx = getContext();
        sensors = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        if (sensors != null) {
            pressure = sensors.getDefaultSensor(Sensor.TYPE_PRESSURE);
            magnetic = sensors.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
            if (pressure != null) sensors.registerListener(this, pressure, SensorManager.SENSOR_DELAY_NORMAL);
            if (magnetic != null) sensors.registerListener(this, magnetic, SensorManager.SENSOR_DELAY_NORMAL);
        }
        locations = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        startGnss();
    }

    // ── barometer + magnetometer calibration ────────────────────────────────

    @Override
    public void onSensorChanged(SensorEvent e) {
        if (e.sensor.getType() == Sensor.TYPE_PRESSURE) {
            lastPressure = e.values[0];
            lastPressureAt = System.currentTimeMillis();
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        if (sensor != null && sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) magAccuracy = accuracy;
    }

    /**
     * Raw station pressure in hPa plus the ISA altitude it implies. The absolute
     * number is meaningless without a sea-level reference, which is why the JS
     * side calibrates it against a known elevation and only ever uses the
     * DIFFERENCE. That difference is good to a couple of feet, where GPS
     * altitude under canopy is not good to thirty.
     */
    @PluginMethod
    public void pressure(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", pressure != null);
        if (lastPressure != null) {
            r.put("hPa", lastPressure.floatValue());
            r.put("at", lastPressureAt);
            // ISA, relative to the 1013.25 hPa standard datum
            double m = 44330.0 * (1.0 - Math.pow(lastPressure / 1013.25, 0.1902949));
            r.put("isaMetres", m);
        }
        call.resolve(r);
    }

    /** -1 unknown, 0 unreliable, 1 low, 2 medium, 3 high. */
    @PluginMethod
    public void compassAccuracy(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", magnetic != null);
        r.put("accuracy", magAccuracy);
        call.resolve(r);
    }

    // ── GNSS quality ────────────────────────────────────────────────────────

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void startGnss() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        if (locations == null || gnssCallback != null || !hasLocationPermission()) return;
        gnssCallback = new GnssStatus.Callback() {
            @Override
            public void onSatelliteStatusChanged(GnssStatus s) {
                int n = s.getSatelliteCount(), used = 0, l5 = 0, k = 0;
                float best = 0f;
                float[] cn0 = new float[n];
                for (int i = 0; i < n; i++) {
                    float c = s.getCn0DbHz(i);
                    if (s.usedInFix(i)) {
                        used++;
                        cn0[k++] = c;
                        if (c > best) best = c;
                        // L5 / E5a / B2a all sit near 1176 MHz
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && s.hasCarrierFrequencyHz(i)) {
                            float f = s.getCarrierFrequencyHz(i);
                            if (f > 1.16e9f && f < 1.19e9f) l5++;
                        }
                    }
                }
                java.util.Arrays.sort(cn0, 0, k);
                satsTotal = n; satsUsed = used; satsL5 = l5; bestCn0 = best;
                medianCn0 = k > 0 ? cn0[k / 2] : 0f;
                lastGnssAt = System.currentTimeMillis();
            }
        };
        try { locations.registerGnssStatusCallback(gnssCallback, null); }
        catch (SecurityException ex) { gnssCallback = null; }
    }

    @PluginMethod
    public void gnss(PluginCall call) {
        if (gnssCallback == null) startGnss();       // permission may have arrived since load()
        JSObject r = new JSObject();
        r.put("available", gnssCallback != null);
        r.put("total", satsTotal);
        r.put("used", satsUsed);
        r.put("l5", satsL5);
        r.put("bestCn0", bestCn0);
        r.put("medianCn0", medianCn0);
        r.put("at", lastGnssAt);
        call.resolve(r);
    }

    // ── partial wake lock ───────────────────────────────────────────────────

    /**
     * The web Wake Lock API can only hold the SCREEN on. This holds the CPU with
     * the screen off, which is what a 60 second average in a pocket needs.
     * Reference-counted off, and released in handleOnDestroy so a crash mid-hold
     * cannot leave it set.
     */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null) { call.reject("no PowerManager"); return; }
        if (on) {
            if (wakeLock == null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fieldmap:work");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire(4 * 60 * 60 * 1000L);   // hard ceiling, not a promise
        } else if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        JSObject r = new JSObject();
        r.put("held", wakeLock != null && wakeLock.isHeld());
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        if (sensors != null) sensors.unregisterListener(this);
        if (locations != null && gnssCallback != null) {
            try { locations.unregisterGnssStatusCallback(gnssCallback); } catch (Exception ignored) {}
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.handleOnDestroy();
    }
}
