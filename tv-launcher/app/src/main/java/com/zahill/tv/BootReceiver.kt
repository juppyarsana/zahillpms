package com.zahill.tv

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper

// On the Sharp TVs the Live TV app (com.mediatek.wwtv.tvcenter) opens itself a few seconds after
// the TV boots, on top of Home. A hotel TV should start on Zahill TV, so bring Home back to the
// front a little after boot (twice: the tuner can take a while). Android only allows a start
// from the background because provision.ps1 grants SYSTEM_ALERT_WINDOW (appops) to the app.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext
        val home = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .setClass(app, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val handler = Handler(Looper.getMainLooper())
        for (delay in longArrayOf(8_000, 20_000)) {
            handler.postDelayed({ runCatching { app.startActivity(home) } }, delay)
        }
    }
}
