package com.jamesccupps.fieldmap;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // must be registered before the bridge starts, or the JS side sees no plugin
        registerPlugin(FieldSensors.class);
        super.onCreate(savedInstanceState);
    }
}
