package com.zahill.fophone

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * The phone's screen: the PMS page /fo-phone in a WebView (missed calls, call
 * a room, the call itself). Opened by IncomingCallActivity's Answer with the
 * call in the extras.
 */
class MainActivity : AppCompatActivity() {
  private lateinit var web: WebView
  private lateinit var offline: TextView
  private var loaded = false

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Prefs.server(this).isEmpty()) {
      startActivity(Intent(this, SetupActivity::class.java)); finish(); return
    }
    web = WebView(this)
    offline = TextView(this).apply {
      text = "Can't reach the hotel PMS — check the Wi-Fi. Tap to try again."
      setPadding(40, 40, 40, 40); textSize = 16f; visibility = View.GONE
      setOnClickListener { visibility = View.GONE; web.reload() }
    }
    setContentView(android.widget.FrameLayout(this).apply { addView(web); addView(offline) })

    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
    }
    web.addJavascriptInterface(PhoneBridge(this), "FoPhoneApp")
    val host = Uri.parse(Prefs.server(this)).host
    web.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) {
        // The microphone, only for the hotel's own PMS page.
        if (request.origin.host == host && request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
          request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        else request.deny()
      }
    }
    web.webViewClient = object : WebViewClient() {
      override fun onPageFinished(view: WebView?, url: String?) { loaded = true }
      override fun onReceivedError(view: WebView?, req: WebResourceRequest?, err: WebResourceError?) {
        if (req?.isForMainFrame == true) offline.visibility = View.VISIBLE
      }
    }
    Bridge.web = web

    val perms = mutableListOf(Manifest.permission.RECORD_AUDIO)
    if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS)
    requestPermissions(perms.toTypedArray(), 1)

    CallService.start(this)
    loadPage(intent)
  }

  private fun loadPage(i: Intent?) {
    val base = Prefs.server(this) + "/fo-phone"
    val callId = i?.getStringExtra("answer")
    if (callId != null) {
      setShowWhenLocked(true)
      val q = "?answer=" + Uri.encode(callId) + "&room=" + Uri.encode(i.getStringExtra("roomId") ?: "") +
        "&unit=" + Uri.encode(i.getStringExtra("unitName") ?: "") + "&guest=" + Uri.encode(i.getStringExtra("guestName") ?: "")
      web.loadUrl(base + q)
    } else web.loadUrl(base)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val callId = intent.getStringExtra("answer") ?: return
    setShowWhenLocked(true)
    if (loaded) {
      val args = listOf(callId, intent.getStringExtra("roomId"), intent.getStringExtra("unitName"), intent.getStringExtra("guestName"))
        .joinToString(",") { JSONObject.quote(it ?: "") }
      web.evaluateJavascript("window.foPhoneAnswer ? window.foPhoneAnswer($args) : location.reload()", null)
    } else loadPage(intent)
  }

  override fun onResume() {
    super.onResume()
    if (::web.isInitialized && loaded) web.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null)
  }

  override fun onDestroy() {
    if (::web.isInitialized && Bridge.web === web) Bridge.web = null
    super.onDestroy()
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    // Back goes to the home screen; the line stays connected.
    moveTaskToBack(true)
  }
}
