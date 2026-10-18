package com.zahill.tvscreensaver

import android.content.Context
import android.net.Uri
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout

// The welcome page in a WebView — shared by the screensaver (ZahillDreamService)
// and the "Zahill Welcome" icon (WelcomeActivity), so both show the same thing.
object WelcomeWeb {
    fun createWebView(context: Context): WebView = WebView(context).apply {
        layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        webChromeClient = WebChromeClient()
    }

    // null when the TV has no Room ID / token yet.
    fun launchUrl(context: Context): String? {
        val prefs = context.getSharedPreferences(context.packageName, Context.MODE_PRIVATE)
        val roomId = prefs.getString(Preferences.KEY_ROOM_ID, null)
        val token = prefs.getString(Preferences.KEY_DISPLAY_TOKEN, null)
        val baseUrl = prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL)
        if (roomId.isNullOrBlank() || token.isNullOrBlank()) return null
        return "$baseUrl?room=${Uri.encode(roomId)}&token=${Uri.encode(token)}"
    }

    fun load(webView: WebView) {
        val url = launchUrl(webView.context)
        if (url != null) {
            webView.loadUrl(url)
        } else {
            val html = "<html><body style='color:white;display:flex;justify-content:center;align-items:center;height:100vh;background:#05070a;margin:0;font-family:sans-serif;'><div><h1>TV screensaver is not configured</h1><p>Open Zahill Welcome and hold OK for 3 seconds to set the room ID + token.</p></div></body></html>"
            webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        }
    }
}
