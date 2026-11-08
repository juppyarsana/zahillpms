package com.zahill.fophone

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.lang.ref.WeakReference

/** Full-screen "Room 104 is calling" over the lock screen, with Answer / Not now. */
class IncomingCallActivity : AppCompatActivity() {
  companion object {
    private var current: WeakReference<IncomingCallActivity>? = null
    fun closeAll() { current?.get()?.let { a -> a.runOnUiThread { a.finish() } } }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    current = WeakReference(this)
    setShowWhenLocked(true)
    setTurnScreenOn(true)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val call = CallService.ringingCall
    if (call == null) { finish(); return }

    val dp = resources.displayMetrics.density
    fun text(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
      text = s; textSize = size; setTextColor(color); gravity = Gravity.CENTER
      if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    fun round(label: String, color: Int, onClick: () -> Unit) = Button(this).apply {
      text = label; setTextColor(Color.WHITE); textSize = 16f; isAllCaps = false
      background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(color) }
      layoutParams = LinearLayout.LayoutParams((96 * dp).toInt(), (96 * dp).toInt()).apply { setMargins((24 * dp).toInt(), 0, (24 * dp).toInt(), 0) }
      setOnClickListener { onClick() }
    }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#1F2937"))
      setPadding(0, 0, 0, (40 * dp).toInt())
    }
    val internal = call.optBoolean("internal", false)
    root.addView(text(if (internal) "THE RESTAURANT IS CALLING" else "ROOM CALLING THE FRONT DESK", 14f, Color.parseColor("#FCA5A5"), true))
    root.addView(text(if (internal) call.optString("unitName") else "Room ${call.optString("unitName")}", 48f, Color.WHITE, true))
    val guest = call.optString("guestName")
    if (guest.isNotEmpty()) root.addView(text(guest, 20f, Color.parseColor("#D1D5DB")))
    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
      setPadding(0, (80 * dp).toInt(), 0, 0)
    }
    buttons.addView(round("Not now", Color.parseColor("#DC2626")) { CallService.stopRinging(); finish() })
    buttons.addView(round("Answer", Color.parseColor("#16A34A")) { answer(call) })
    root.addView(buttons)
    root.addView(text("Not now silences this phone only — the PC keeps ringing.", 12f, Color.parseColor("#9CA3AF")).apply { setPadding(0, (24 * dp).toInt(), 0, 0) })
    setContentView(root)
  }

  private fun answer(call: org.json.JSONObject) {
    CallService.stopRinging()
    val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    km.requestDismissKeyguard(this, null)
    startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      .putExtra("answer", call.optString("callId"))
      .putExtra("roomId", call.optString("roomId"))
      .putExtra("unitName", call.optString("unitName"))
      .putExtra("guestName", call.optString("guestName")))
    finish()
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() { /* answer or Not now */ }
}
