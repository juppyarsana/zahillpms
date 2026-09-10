package com.zahill.roomdisplay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.os.BatteryManager
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Drives the telemetry POSTs while MainActivity is started:
 *   - one immediately (an "app is up" beacon)
 *   - then every 2 minutes (the Dashboard marks a tablet offline after
 *     3 missed = ~6 min)
 *   - plus an immediate flush on a charging-state flip, a low-battery
 *     threshold crossing, or a connectivity change (debounced to >= 10s
 *     apart so a burst of system broadcasts is one POST).
 *
 * No WorkManager / coroutines on purpose — the wrapper runs one foreground
 * Activity on a plugged-in tablet, and telemetry going stale IS the "tablet
 * down" signal, so surviving process death doesn't matter until Phase 2.
 */
class TelemetryScheduler(private val appContext: Context) {

    companion object {
        private const val TAG = "Telemetry"
        private val INTERVAL_MIN = 2L
        private const val FORCE_DEBOUNCE_MS = 10_000L
    }

    private var executor: ScheduledExecutorService? = null
    private var lastForcedFlush = 0L
    private var lastCharging: Boolean? = null
    private var lastBatteryBucket = Int.MAX_VALUE

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            intent ?: return
            val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
            val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            val pct = if (level >= 0 && scale > 0) level * 100 / scale else -1
            val bucket = when {
                pct < 0 -> Int.MAX_VALUE
                pct <= 5 -> 5
                pct <= 10 -> 10
                pct <= 15 -> 15
                pct <= 20 -> 20
                else -> Int.MAX_VALUE
            }
            val chargingFlipped = lastCharging != null && lastCharging != charging
            val crossedDown = bucket < lastBatteryBucket
            lastCharging = charging
            lastBatteryBucket = bucket
            if (chargingFlipped || crossedDown) forceFlush("battery")
        }
    }

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            forceFlush("screen")
        }
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = forceFlush("net-available")
        override fun onLost(network: Network) = forceFlush("net-lost")
    }

    fun start() {
        if (executor != null) return
        executor = Executors.newSingleThreadScheduledExecutor().also {
            it.scheduleWithFixedDelay({ flush("tick") }, 0, INTERVAL_MIN, TimeUnit.MINUTES)
        }
        try {
            appContext.registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            appContext.registerReceiver(screenReceiver, IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            })
            (appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
                ?.registerDefaultNetworkCallback(networkCallback)
        } catch (e: Exception) {
            Log.w(TAG, "receiver registration failed: ${e.message}")
        }
    }

    fun stop() {
        executor?.shutdownNow()
        executor = null
        runCatching { appContext.unregisterReceiver(batteryReceiver) }
        runCatching { appContext.unregisterReceiver(screenReceiver) }
        runCatching {
            (appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)
                ?.unregisterNetworkCallback(networkCallback)
        }
    }

    private fun forceFlush(reason: String) {
        val now = System.currentTimeMillis()
        if (now - lastForcedFlush < FORCE_DEBOUNCE_MS) return
        lastForcedFlush = now
        executor?.execute { flush(reason) }
    }

    private fun flush(reason: String) {
        try {
            val roomId = Preferences.roomId(appContext) ?: return
            val token = Preferences.displayToken(appContext) ?: return
            val baseUrl = Preferences.baseUrl(appContext)
            val body = DeviceStats.snapshot(appContext)
            val ok = TelemetryClient.post(baseUrl, roomId, token, body)
            Log.d(TAG, "flush($reason) -> ${if (ok) "ok" else "failed"}")
        } catch (e: Exception) {
            Log.w(TAG, "flush($reason) threw: ${e.message}")
        }
    }
}
