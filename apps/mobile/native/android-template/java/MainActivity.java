package com.erve.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeThemeBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
