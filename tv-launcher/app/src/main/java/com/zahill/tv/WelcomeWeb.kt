package com.zahill.tv

import android.content.Context
import android.net.Uri
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout

// The tv-display page in a WebView — used by the screensaver
// (ZahillDreamService) and the hotel info screens (HotelInfoActivity).
object WelcomeWeb {
    fun createWebView(context: Context): WebView = WebView(context).apply {
        layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        // Lobby videos play by themselves WITH sound — nobody presses play on a
        // screensaver. (The page decides per video whether it has sound.)
        settings.mediaPlaybackRequiresUserGesture = false
        webChromeClient = WebChromeClient()
    }

    // null when the TV has no Room ID / token yet. `path` is a tv-display route
    // ("" = the welcome page, "/info/dining" = a hotel info screen).
    fun launchUrl(context: Context, path: String = "", lang: String? = null): String? {
        val prefs = context.getSharedPreferences(context.packageName, Context.MODE_PRIVATE)
        val roomId = prefs.getString(Preferences.KEY_ROOM_ID, null)
        val token = prefs.getString(Preferences.KEY_DISPLAY_TOKEN, null)
        val baseUrl = prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL)!!.trimEnd('/')
        if (roomId.isNullOrBlank() || token.isNullOrBlank()) return null
        val langPart = if (lang != null) "&lang=${Uri.encode(lang)}" else ""
        // &t= makes every start a new address: the server sends the page with no
        // cache rule, so the WebView would otherwise keep showing an old build for
        // days. The page's own files have the build in their names, so they still
        // come from the cache.
        return "$baseUrl$path?room=${Uri.encode(roomId)}&token=${Uri.encode(token)}$langPart&t=${System.currentTimeMillis()}"
    }

    fun load(webView: WebView, path: String = "", lang: String? = null) {
        val url = launchUrl(webView.context, path, lang)
        if (url != null) {
            webView.loadUrl(url)
        } else {
            val html = "<html><body style='color:white;display:flex;justify-content:center;align-items:center;height:100vh;background:#05070a;margin:0;font-family:sans-serif;'><div><h1>This TV is not set up yet</h1><p>On the Home screen, hold OK for 3 seconds to enter the Room ID and display token.</p></div></body></html>"
            webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
        }
    }
}
