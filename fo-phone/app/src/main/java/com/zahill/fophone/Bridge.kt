package com.zahill.fophone

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/**
 * window.FoPhoneApp in the /fo-phone page. The page runs the call (WebRTC);
 * this side keeps the key, the audio mode, the speaker, and the phone's
 * setup checklist.
 */
object Bridge {
  @Volatile var inCall = false
  @Volatile var web: WebView? = null

  /** An event from CallService's stream, handed to the open page too. */
  fun forward(e: JSONObject) {
    val w = web ?: return
    w.post { try { w.evaluateJavascript("window.foPhoneEvent && window.foPhoneEvent(${e})", null) } catch (_: Exception) {} }
  }
}

class PhoneBridge(private val activity: MainActivity) {
  private val ctx: Context get() = activity.applicationContext
  private var proximity: PowerManager.WakeLock? = null

  @JavascriptInterface fun getKey(): String = Prefs.key(ctx)
  @JavascriptInterface fun version(): String = BuildConfig.VERSION_NAME

  @JavascriptInterface fun saveKey(key: String) {
    Prefs.setKey(ctx, key)
    CallService.start(ctx)
  }

  @JavascriptInterface fun clearKey() {
    Prefs.clearKey(ctx)
    ctx.stopService(Intent(ctx, CallService::class.java))
  }

  @JavascriptInterface fun takeSignals(callId: String): String = CallService.takeSignals(callId)
  @JavascriptInterface fun stopRinging() = CallService.stopRinging()

  /** calling / connecting / connected / ended / failed / idle */
  @JavascriptInterface fun callState(status: String) {
    val on = status == "calling" || status == "connecting" || status == "connected"
    Bridge.inCall = on
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    activity.runOnUiThread {
      try {
        if (on) {
          am.mode = AudioManager.MODE_IN_COMMUNICATION
          if (proximity == null) {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
            proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "fophone:ear").apply { acquire(60 * 60 * 1000L) }
          }
        } else {
          @Suppress("DEPRECATION") am.isSpeakerphoneOn = false
          am.mode = AudioManager.MODE_NORMAL
          proximity?.let { if (it.isHeld) it.release() }
          proximity = null
          activity.setShowWhenLocked(false)
        }
      } catch (_: Exception) {}
    }
  }

  @JavascriptInterface fun setSpeaker(on: Boolean) {
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    activity.runOnUiThread { try { @Suppress("DEPRECATION") am.isSpeakerphoneOn = on } catch (_: Exception) {} }
  }

  /** What still needs setting on this phone, for the page's "Finish setting up" card. */
  @JavascriptInterface fun checks(): String {
    val a = JSONArray()
    fun add(id: String, label: String, ok: Boolean) = a.put(JSONObject().put("id", id).put("label", label).put("ok", ok))
    add("mic", "Allow the microphone", ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
    if (Build.VERSION.SDK_INT >= 33)
      add("notifications", "Allow notifications", ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    if (Build.VERSION.SDK_INT >= 34)
      add("fullscreen", "Allow full-screen calls on the lock screen", (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent())
    add("battery", "Let the app run in the background (battery: no restrictions)",
      (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(ctx.packageName))
    add("maker", "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }}: allow Autostart and background activity, then lock the app in Recents", Prefs.makerDone(ctx))
    return a.toString()
  }

  @JavascriptInterface fun fix(id: String) {
    activity.runOnUiThread {
      try {
        when (id) {
          "mic" -> activity.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 10)
          "notifications" -> if (Build.VERSION.SDK_INT >= 33) activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 11)
          "fullscreen" -> if (Build.VERSION.SDK_INT >= 34)
            activity.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}")))
          "battery" -> activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")))
          "maker" -> { openMakerSettings(activity); Prefs.setMakerDone(ctx, true) }
        }
      } catch (_: Exception) {
        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
      }
    }
  }

  /** Vivo / iQOO / Xiaomi / Oppo keep their autostart switch in their own app; else the app's settings page. */
  private fun openMakerSettings(a: Activity) {
    val candidates = listOf(
      ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
      ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
      ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity"),
      ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
      ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
    )
    for (c in candidates) {
      try { a.startActivity(Intent().setComponent(c).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return } catch (_: Exception) {}
    }
    a.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${a.packageName}")))
  }
}
