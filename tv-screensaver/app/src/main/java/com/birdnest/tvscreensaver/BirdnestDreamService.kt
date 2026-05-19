package com.birdnest.tvscreensaver

import android.net.Uri
import android.service.dreams.DreamService
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout

class BirdnestDreamService : DreamService() {
    private lateinit var webView: WebView

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            webChromeClient = WebChromeClient()
        }

        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
            addView(webView)
        }
        setContentView(container)
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        webView.loadUrl(getLaunchUrl())
    }

    override fun onDreamingStopped() {
        super.onDreamingStopped()
        webView.stopLoading()
        webView.destroy()
    }

    private fun getLaunchUrl(): String {
        val prefs = getSharedPreferences(packageName, MODE_PRIVATE)
        val roomId = prefs.getString(Preferences.KEY_ROOM_ID, null)
        val token = prefs.getString(Preferences.KEY_DISPLAY_TOKEN, null)
        val baseUrl = prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL)

        return if (roomId.isNullOrBlank() || token.isNullOrBlank()) {
            val fallbackHtml = "<html><body style='color:white;display:flex;justify-content:center;align-items:center;height:100vh;background:#05070a;margin:0;font-family:sans-serif;'><div><h1>TV screensaver is not configured</h1><p>Open the app and set room ID + token.</p></div></body></html>"
            webView.loadDataWithBaseURL(null, fallbackHtml, "text/html", "utf-8", null)
            "about:blank"
        } else {
            val encodedRoom = Uri.encode(roomId)
            val encodedToken = Uri.encode(token)
            "$baseUrl?room=$encodedRoom&token=$encodedToken"
        }
    }
}
