package com.zahill.tv

import android.service.dreams.DreamService
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.WebView
import android.widget.FrameLayout

// The screensaver: the tv-display welcome page after the TV has been idle.
class ZahillDreamService : DreamService() {
    private lateinit var webView: WebView

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true

        webView = WelcomeWeb.createWebView(this)
        val container = FrameLayout(this).apply {
            layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
            addView(webView)
        }
        setContentView(container)
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        WelcomeWeb.load(webView)
    }

    override fun onDreamingStopped() {
        super.onDreamingStopped()
        webView.stopLoading()
        webView.destroy()
    }
}
