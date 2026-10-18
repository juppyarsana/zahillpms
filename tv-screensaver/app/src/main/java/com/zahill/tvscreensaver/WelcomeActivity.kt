package com.zahill.tvscreensaver

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity

// "Zahill Welcome" on the TV home screen: one press shows the welcome page
// right away — what housekeeping does when a room is made ready, instead of
// waiting for the screensaver to start by itself. Behaves like the
// screensaver: any remote button goes back to the TV (volume keys still work).
// Hold OK for 3 seconds to open the settings (Room ID / token) — the settings
// have no icon of their own, so they can't be opened by mistake.
class WelcomeActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var settingsOpened = false
    private var okPressedHere = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (WelcomeWeb.launchUrl(this) == null) {
            // Not set up yet — go straight to the settings.
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }
        webView = WelcomeWeb.createWebView(this).apply { isFocusable = false }
        setContentView(webView)
        hideSystemBars()
        WelcomeWeb.load(webView)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY)
        }
    }

    private fun isOk(keyCode: Int) = keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
        keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER

    private fun isVolume(keyCode: Int) = keyCode == KeyEvent.KEYCODE_VOLUME_UP ||
        keyCode == KeyEvent.KEYCODE_VOLUME_DOWN || keyCode == KeyEvent.KEYCODE_VOLUME_MUTE

    // Every key comes here first — before the WebView, which would otherwise
    // take the arrows and OK for itself.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        if (isVolume(keyCode)) return super.dispatchKeyEvent(event)
        if (isOk(keyCode)) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> {
                    if (event.repeatCount == 0) okPressedHere = true
                    // A held key repeats; open the settings once it has been held 3 s.
                    if (okPressedHere && !settingsOpened && event.eventTime - event.downTime >= HOLD_FOR_SETTINGS_MS) {
                        settingsOpened = true
                        startActivity(Intent(this, MainActivity::class.java))
                        finish()
                    }
                }
                // Only a press that started here: the OK that opened this screen
                // from the home screen is released here and must not close it.
                KeyEvent.ACTION_UP -> if (okPressedHere && !settingsOpened) finish()
            }
            return true
        }
        if (event.action == KeyEvent.ACTION_DOWN) finish()
        return true
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private const val HOLD_FOR_SETTINGS_MS = 3000L
    }
}
