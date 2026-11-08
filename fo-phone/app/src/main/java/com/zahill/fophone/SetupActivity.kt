package com.zahill.fophone

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/** First start: the hotel PMS address (normally the default). Then the page asks for the pairing code. */
class SetupActivity : AppCompatActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val dp = resources.displayMetrics.density
    val pad = (24 * dp).toInt()
    val url = EditText(this).apply {
      setText(Prefs.server(this@SetupActivity).ifEmpty { Prefs.DEFAULT_SERVER })
      inputType = InputType.TYPE_TEXT_VARIATION_URI
      setSingleLine()
    }
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad); gravity = Gravity.TOP
      addView(TextView(context).apply { text = "Front Desk Phone"; textSize = 26f })
      addView(TextView(context).apply { text = "\nThe hotel PMS address:"; textSize = 16f })
      addView(url)
      addView(Button(context).apply {
        text = "Continue"
        setOnClickListener {
          val v = url.text.toString().trim()
          if (v.startsWith("http://") || v.startsWith("https://")) {
            Prefs.setServer(this@SetupActivity, v)
            startActivity(Intent(this@SetupActivity, MainActivity::class.java)); finish()
          } else url.error = "Starts with https://"
        }
      })
    }
    setContentView(root)
  }
}
