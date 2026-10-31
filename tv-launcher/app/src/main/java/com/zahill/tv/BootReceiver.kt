package com.zahill.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper

// On some Sharp TVs the Live TV app (com.mediatek.wwtv.tvcenter) opens itself as the TV boots, on
// top of Home. A hotel TV should start on Zahill TV, so bring Home to the front at once and keep
// doing it for a while (the tuner can take a while). Stops as soon as the guest presses a key, so
// the app they just opened isn't closed. Android only allows a start from the background because
// provision.ps1 grants SYSTEM_ALERT_WINDOW (appops) to the app.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_LOCKED_BOOT_COMPLETED) return
        val app = context.applicationContext
        val home = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .setClass(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val handler = Handler(Looper.getMainLooper())
        for (delay in longArrayOf(0, 1_000, 2_000, 3_000, 5_000, 8_000, 12_000, 20_000, 30_000)) {
            handler.postDelayed({
                if (!MainActivity.guestPressedKey) runCatching { app.startActivity(home) }
            }, delay)
        }
    }
}
