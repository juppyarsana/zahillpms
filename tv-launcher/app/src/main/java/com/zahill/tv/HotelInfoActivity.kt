package com.zahill.tv

import android.app.Activity
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebView

// A hotel info screen (Dining & Menu, Activities, Hotel Guide, Today) — a
// tv-display page full screen. The page handles the arrows and OK; Back goes
// back inside the page first, then returns to Home.
class HotelInfoActivity : Activity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WelcomeWeb.createWebView(this).apply {
            isFocusable = true
            isFocusableInTouchMode = true
            setBackgroundColor(0xFF0A0C10.toInt())
        }
        setContentView(webView)
        window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        val path = intent.getStringExtra(EXTRA_PATH) ?: ""
        WelcomeWeb.load(webView, path, intent.getStringExtra(EXTRA_LANG))
        webView.requestFocus(View.FOCUS_DOWN)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_PATH = "path"
        const val EXTRA_LANG = "lang"
    }
}
