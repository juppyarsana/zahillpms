package com.zahill.roomdisplay

import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Exposed to the PWA as `window.AndroidKiosk`. String / primitive returns
 * only. Methods run on a WebView binder thread, so everything here must be
 * main-thread-free (DeviceStats.snapshot is).
 *
 * Deliberately exposes no destructive action and not the display token —
 * the PWA gets the token from the launch URL instead.
 */
class KioskBridge(private val ctx: Context) {

    @JavascriptInterface
    fun isKiosk(): Boolean = true

    @JavascriptInterface
    fun getConfig(): String = JSONObject().apply {
        put("roomId", Preferences.roomId(ctx))
        put("baseUrl", Preferences.baseUrl(ctx))
        put("appVersion", BuildConfig.VERSION_NAME)
        put("platform", "android-kiosk")
    }.toString()

    @JavascriptInterface
    fun getDeviceStats(): String = DeviceStats.snapshot(ctx)

    @JavascriptInterface
    fun openSettings() {
        ctx.startActivity(
            Intent(ctx, SettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }
}
