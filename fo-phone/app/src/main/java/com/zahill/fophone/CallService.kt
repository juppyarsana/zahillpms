package com.zahill.fophone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Keeps the front desk line connected (GET /api/phone/stream) while the app is
 * closed, and rings — full screen, even on the lock screen — when a room calls.
 * The call itself is answered in MainActivity's page. Signals that arrive
 * while ringing (the room's offer, ICE) are kept here for the page
 * (takeSignals), because the page may not be open yet.
 */
class CallService : Service() {

  companion object {
    const val CH_SERVICE = "service"
    const val CH_CALLS = "calls_v1"
    const val NOTE_SERVICE = 1
    const val NOTE_CALL = 2
    const val ACTION_STOP_RING = "stop_ring"

    @Volatile var instance: CallService? = null
    @Volatile var connected = false
    @Volatile var ringingCall: JSONObject? = null

    private val signals = ConcurrentHashMap<String, JSONArray>()
    private val signalTimes = ConcurrentHashMap<String, Long>()

    fun start(c: Context) {
      if (Prefs.key(c).isEmpty() || Prefs.server(c).isEmpty()) return
      val i = Intent(c, CallService::class.java)
      if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
    }

    /** The signals received for a call so far, as a JSON array (and forgets them). */
    fun takeSignals(callId: String): String = (signals.remove(callId) ?: JSONArray()).toString()

    fun stopRinging() { instance?.stopRing(null) }
  }

  private val pool = Executors.newScheduledThreadPool(2)
  @Volatile private var running = false
  @Volatile private var lastData = 0L
  @Volatile private var conn: HttpURLConnection? = null
  private lateinit var ringer: Ringer
  private var wifiLock: WifiManager.WifiLock? = null
  private var ringWake: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    ringer = Ringer(this)
    makeChannels()
    val note = serviceNote("Connecting…")
    if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE_SERVICE, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(NOTE_SERVICE, note)
    // Keep Wi-Fi awake with the screen off, or room calls arrive late or not at all.
    try {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "fophone:wifi").apply { setReferenceCounted(false); acquire() }
    } catch (_: Exception) {}
    running = true
    pool.execute { streamLoop() }
    pool.scheduleWithFixedDelay({ watchdog() }, 15, 15, TimeUnit.SECONDS)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP_RING) stopRing(null)
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    try { conn?.disconnect() } catch (_: Exception) {}
    stopRing(null)
    try { wifiLock?.release() } catch (_: Exception) {}
    pool.shutdownNow()
    instance = null
    connected = false
    super.onDestroy()
  }

  // ─── The event stream ────────────────────────────────────────
  private fun streamLoop() {
    var backoff = 2000L
    while (running) {
      val server = Prefs.server(this)
      val key = Prefs.key(this)
      if (key.isEmpty()) { stopSelf(); return }
      try {
        val c = URL("$server/api/phone/stream").openConnection() as HttpURLConnection
        conn = c
        c.setRequestProperty("Authorization", "Bearer $key")   // never in the URL (access logs)
        c.connectTimeout = 15000
        c.readTimeout = 60000          // the server sends a heartbeat every 25 s
        c.setRequestProperty("Accept", "text/event-stream")
        c.setRequestProperty("X-App-Version", BuildConfig.VERSION_NAME)
        if (c.responseCode == 401) {
          setStatus(false, "This phone was removed — pair it again")
          Thread.sleep(60000); continue
        }
        if (c.responseCode != 200) throw Exception("HTTP ${c.responseCode}")
        BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { r ->
          lastData = System.currentTimeMillis()
          setStatus(true, "Ready for calls")
          backoff = 2000L
          val data = StringBuilder()
          while (running) {
            val line = r.readLine() ?: break
            lastData = System.currentTimeMillis()
            if (line.startsWith("data:")) data.append(line.substring(5).trim())
            else if (line.isEmpty() && data.isNotEmpty()) {
              val text = data.toString(); data.setLength(0)
              try { onEvent(JSONObject(text)) } catch (_: Exception) {}
            }
          }
        }
      } catch (_: Exception) {
      } finally {
        try { conn?.disconnect() } catch (_: Exception) {}
        conn = null
      }
      if (!running) return
      setStatus(false, "Not connected — trying again")
      try { Thread.sleep(backoff) } catch (_: InterruptedException) { return }
      backoff = (backoff * 2).coerceAtMost(30000L)
    }
  }

  /** A stream that went quiet (Wi-Fi change) is closed so the loop opens a new one; and a call that came while it was down still rings. */
  private fun watchdog() {
    if (connected && System.currentTimeMillis() - lastData > 45000) {
      try { conn?.disconnect() } catch (_: Exception) {}
    }
    if (ringingCall == null && !Bridge.inCall) checkPending()
    val now = System.currentTimeMillis()
    signalTimes.entries.removeIf { now - it.value > 3 * 60 * 1000 }.also { signals.keys.retainAll(signalTimes.keys) }
  }

  private fun checkPending() {
    try {
      val c = URL(Prefs.server(this) + "/api/phone/pending").openConnection() as HttpURLConnection
      c.connectTimeout = 10000; c.readTimeout = 10000
      c.setRequestProperty("Authorization", "Bearer " + Prefs.key(this))
      if (c.responseCode == 200) {
        val body = c.inputStream.bufferedReader().readText().trim()
        if (body.isNotEmpty() && body != "null") {
          val p = JSONObject(body)
          if (p.optString("callId").isNotEmpty()) startRing(p)
        }
      }
      c.disconnect()
    } catch (_: Exception) {}
  }

  private fun onEvent(e: JSONObject) {
    val type = e.optString("type")
    val callId = e.optString("callId")
    when (type) {
      "incoming_call" -> if (!Bridge.inCall) startRing(e)
      "signal" -> {
        val p = e.optJSONObject("payload") ?: return
        signals.getOrPut(callId) { JSONArray() }.put(p)
        signalTimes[callId] = System.currentTimeMillis()
        Bridge.forward(e)
      }
      "call_taken", "ended", "missed" -> {
        if (ringingCall?.optString("callId") == callId) stopRing(callId)
        Bridge.forward(e)
      }
      else -> Bridge.forward(e)
    }
  }

  // ─── Ringing ─────────────────────────────────────────────────
  @Synchronized
  fun startRing(call: JSONObject) {
    if (ringingCall != null) return
    val c = JSONObject()
      .put("callId", call.optString("callId"))
      .put("roomId", call.optString("roomId"))
      .put("unitName", call.optString("unitName"))
      .put("guestName", if (call.isNull("guestName")) (if (call.isNull("staffName")) "" else call.optString("staffName")) else call.optString("guestName"))
      .put("internal", call.optBoolean("internal", false))
    ringingCall = c
    try {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      @Suppress("DEPRECATION")
      ringWake = pm.newWakeLock(PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE, "fophone:ring")
        .apply { acquire(60_000) }
    } catch (_: Exception) {}
    ringer.start()
    val full = Intent(this, IncomingCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
    val fullPi = PendingIntent.getActivity(this, 1, full, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val stopPi = PendingIntent.getService(this, 2, Intent(this, CallService::class.java).setAction(ACTION_STOP_RING), PendingIntent.FLAG_IMMUTABLE)
    // The restaurant line calling the front desk has no room (server migration 165).
    val title = if (c.optBoolean("internal")) "${c.optString("unitName")} is calling" else "Room ${c.optString("unitName")} is calling"
    val note = Notification.Builder(this, CH_CALLS)
      .setSmallIcon(R.drawable.ic_phone)
      .setContentTitle(title)
      .setContentText(c.optString("guestName").ifEmpty { "Front desk call" })
      .setCategory(Notification.CATEGORY_CALL)
      .setFullScreenIntent(fullPi, true)
      .setContentIntent(fullPi)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, "Answer", fullPi).build())
      .addAction(Notification.Action.Builder(null, "Not now", stopPi).build())
      .build()
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTE_CALL, note)
    // Also open the screen straight away when the app may (screen off / app open).
    try { startActivity(full) } catch (_: Exception) {}
  }

  /** Stops ringing (callId = only if it is that call). */
  @Synchronized
  fun stopRing(callId: String?) {
    if (callId != null && ringingCall?.optString("callId") != callId) return
    val was = ringingCall
    ringingCall = null
    ringer.stop()
    try { ringWake?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    ringWake = null
    (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTE_CALL)
    if (was != null) IncomingCallActivity.closeAll()
  }

  // ─── Notifications ───────────────────────────────────────────
  private fun makeChannels() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.createNotificationChannel(NotificationChannel(CH_SERVICE, "Phone line", NotificationManager.IMPORTANCE_LOW).apply {
      description = "Shows that the front desk line is connected"
      setShowBadge(false)
    })
    nm.createNotificationChannel(NotificationChannel(CH_CALLS, "Room calls", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "A room calling the front desk"
      setSound(null, null)      // the app plays the ringtone itself
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    })
  }

  private fun serviceNote(text: String): Notification {
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    return Notification.Builder(this, CH_SERVICE)
      .setSmallIcon(R.drawable.ic_phone)
      .setContentTitle("Front desk phone")
      .setContentText(text)
      .setContentIntent(open)
      .setOngoing(true)
      .build()
  }

  private fun setStatus(ok: Boolean, text: String) {
    if (connected == ok && ok) return
    connected = ok
    try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTE_SERVICE, serviceNote(text)) } catch (_: Exception) {}
  }
}
