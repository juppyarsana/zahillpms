package com.zahill.roomdisplay

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Fullscreen landscape WebView wrapper around the Room Display PWA.
 * Phase 1: no Device Owner / Lock Task yet — a 5-tap corner still opens
 * SettingsActivity so a test tablet isn't bricked into the kiosk.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var reconnectOverlay: View
    private lateinit var scheduler: TelemetryScheduler

    private val mainHandler = Handler(Looper.getMainLooper())
    private var reloadBackoffMs = 10_000L
    private var pendingReload: Runnable? = null

    private var tapCount = 0
    private var lastTapAt = 0L

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        scheduler = TelemetryScheduler(applicationContext)

        if (!Preferences.isConfigured(this)) {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        applyImmersive()

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false // PWA ringtone / alarm / message chime
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            addJavascriptInterface(KioskBridge(applicationContext), "AndroidKiosk")
            webViewClient = KioskWebViewClient()
        }
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        reconnectOverlay = buildReconnectOverlay()

        val root = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
            )
            addView(webView)
            addView(reconnectOverlay)
            addView(buildSettingsHotCorner())
        }
        setContentView(root)

        loadPwa()
    }

    private fun loadPwa() {
        val roomId = Preferences.roomId(this)
        val token = Preferences.displayToken(this)
        if (roomId.isNullOrBlank() || token.isNullOrBlank()) {
            webView.loadDataWithBaseURL(
                null,
                "<html><body style='background:#0d0709;color:#fff;font-family:sans-serif;" +
                    "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center'>" +
                    "<div><h2>Not configured</h2><p>Tap the bottom-right corner 5 times to open settings.</p></div></body></html>",
                "text/html", "utf-8", null
            )
            return
        }
        val base = Preferences.baseUrl(this).trimEnd('/')
        webView.loadUrl("$base?room=${Uri.encode(roomId)}&token=${Uri.encode(token)}")
    }

    private inner class KioskWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val target = request.url ?: return false
            val base = Uri.parse(Preferences.baseUrl(this@MainActivity))
            // Keep the kiosk (and the JS bridge) pinned to the PWA origin;
            // hand anything else to the system browser.
            return if (target.host != null && target.host == base.host) {
                false
            } else {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, target)) }
                true
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            reconnectOverlay.visibility = View.GONE
            reloadBackoffMs = 10_000L
        }

        override fun onReceivedError(
            view: WebView, request: WebResourceRequest, error: WebResourceError
        ) {
            if (!request.isForMainFrame) return
            showReconnecting()
        }
    }

    private fun showReconnecting() {
        reconnectOverlay.visibility = View.VISIBLE
        pendingReload?.let { mainHandler.removeCallbacks(it) }
        val r = Runnable {
            webView.reload()
            reloadBackoffMs = (reloadBackoffMs * 2).coerceAtMost(120_000L)
        }
        pendingReload = r
        mainHandler.postDelayed(r, reloadBackoffMs)
    }

    private fun buildReconnectOverlay(): View = TextView(this).apply {
        text = getString(R.string.reconnecting)
        setTextColor(0xFFCCCCCC.toInt())
        textSize = 18f
        gravity = android.view.Gravity.CENTER
        setBackgroundColor(0xFF0D0709.toInt())
        visibility = View.GONE
        layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        )
    }

    // Invisible 56dp hot-corner bottom-RIGHT (clear of the PWA's own top-left
    // 5-tap debug logo and its top bar): 5 taps within 3s -> SettingsActivity.
    private fun buildSettingsHotCorner(): View {
        val size = (56 * resources.displayMetrics.density).toInt()
        return View(this).apply {
            layoutParams = FrameLayout.LayoutParams(size, size).apply {
                gravity = android.view.Gravity.BOTTOM or android.view.Gravity.END
            }
            setOnClickListener {
                val now = System.currentTimeMillis()
                tapCount = if (now - lastTapAt < 3_000L) tapCount + 1 else 1
                lastTapAt = now
                if (tapCount >= 5) {
                    tapCount = 0
                    startActivity(Intent(this@MainActivity, SettingsActivity::class.java))
                }
            }
        }
    }

    private fun applyImmersive() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersive()
    }

    override fun onStart() {
        super.onStart()
        scheduler.start()
    }

    override fun onRestart() {
        super.onRestart()
        // Config may have changed in SettingsActivity.
        loadPwa()
    }

    override fun onStop() {
        super.onStop()
        scheduler.stop()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Kiosk: Back must not exit the app or navigate the WebView away.
    }

    override fun onDestroy() {
        pendingReload?.let { mainHandler.removeCallbacks(it) }
        webView.destroy()
        super.onDestroy()
    }
}
