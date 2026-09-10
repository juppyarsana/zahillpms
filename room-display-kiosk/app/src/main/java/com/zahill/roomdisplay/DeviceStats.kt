package com.zahill.roomdisplay

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.os.SystemClock
import android.webkit.WebView
import org.json.JSONObject
import java.net.NetworkInterface

/**
 * A point-in-time device-health snapshot. Pure reads only — safe to call
 * from the telemetry scheduler thread AND the @JavascriptInterface binder
 * thread. Never touches the WebView.
 *
 * JSON keys match the backend's TELEMETRY_FIELDS (snake_case) exactly so
 * the POST body maps 1:1.
 */
object DeviceStats {

    fun snapshot(context: Context): String {
        val json = JSONObject()

        readBattery(context, json)
        readNetwork(context, json)
        readStorage(json)

        json.put("uptime_seconds", SystemClock.elapsedRealtime() / 1000)
        json.put("app_version", appVersion(context))
        json.put("webview_version", webViewVersion())
        json.put("android_version", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        json.put("device_model", "${Build.MANUFACTURER} ${Build.MODEL}".take(64))
        json.put("screen_on", isScreenOn(context))

        return json.toString()
    }

    private fun readBattery(context: Context, json: JSONObject) {
        val intent: Intent? = try {
            context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        } catch (_: Exception) {
            null
        } ?: return

        val level = intent!!.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level >= 0 && scale > 0) {
            json.put("battery_level", (level * 100 / scale).coerceIn(0, 100))
        }

        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        json.put(
            "battery_charging",
            status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        )

        val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
        json.put(
            "power_source",
            when (plugged) {
                BatteryManager.BATTERY_PLUGGED_AC -> "ac"
                BatteryManager.BATTERY_PLUGGED_USB -> "usb"
                BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
                else -> "none"
            }
        )

        val tempTenths = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)
        if (tempTenths != Int.MIN_VALUE) {
            json.put("battery_temp_c", tempTenths / 10.0)
        }
    }

    private fun readNetwork(context: Context, json: JSONObject) {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val caps = cm?.activeNetwork?.let { cm.getNetworkCapabilities(it) }

        val type = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "none"
        }
        json.put("network_type", type)
        json.put(
            "internet_ok",
            caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ?: false
        )

        if (type == "wifi") {
            try {
                @Suppress("DEPRECATION")
                val wifi = (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
                    ?.connectionInfo
                if (wifi != null) {
                    val ssid = wifi.ssid?.trim('"')
                    if (!ssid.isNullOrBlank() && ssid != "<unknown ssid>" && ssid != "0x") {
                        json.put("wifi_ssid", ssid.take(64))
                    }
                    val bssid = wifi.bssid
                    if (!bssid.isNullOrBlank() && bssid != "02:00:00:00:00:00") {
                        json.put("wifi_bssid", bssid)
                    }
                    json.put("wifi_rssi", wifi.rssi)
                    if (wifi.linkSpeed >= 0) json.put("wifi_link_speed_mbps", wifi.linkSpeed)
                    if (Build.VERSION.SDK_INT >= 21 && wifi.frequency > 0) {
                        json.put("wifi_frequency_mhz", wifi.frequency)
                    }
                }
            } catch (_: Exception) {
                // location permission not granted / Wi-Fi service unavailable
            }
        }

        firstIpv4()?.let { json.put("ip_address", it) }
    }

    private fun readStorage(json: JSONObject) {
        try {
            val stat = StatFs(Environment.getDataDirectory().path)
            json.put("storage_free_mb", stat.availableBytes / (1024 * 1024))
            json.put("storage_total_mb", stat.totalBytes / (1024 * 1024))
        } catch (_: Exception) {
        }
    }

    private fun firstIpv4(): String? = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { !it.isLoopbackAddress && it.address.size == 4 }
            ?.hostAddress
    } catch (_: Exception) {
        null
    }

    private fun appVersion(context: Context): String = try {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: BuildConfig.VERSION_NAME
    } catch (_: Exception) {
        BuildConfig.VERSION_NAME
    }

    private fun webViewVersion(): String? =
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                WebView.getCurrentWebViewPackage()?.versionName
            } catch (_: Exception) {
                null
            }
        } else {
            null
        }

    private fun isScreenOn(context: Context): Boolean = try {
        (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
    } catch (_: Exception) {
        true
    }
}
