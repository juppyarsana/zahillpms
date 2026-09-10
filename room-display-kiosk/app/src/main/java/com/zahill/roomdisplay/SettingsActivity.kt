package com.zahill.roomdisplay

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit

/**
 * Kiosk config: Room ID, display token, PWA URL. Ported from
 * tv-screensaver's MainActivity, minus the screensaver setup. Not the
 * launcher activity — reached from MainActivity's 5-tap corner or when no
 * config exists yet.
 */
class SettingsActivity : AppCompatActivity() {

    private companion object {
        const val REQ_LOCATION = 1
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val roomInput = findViewById<EditText>(R.id.roomIdInput)
        val tokenInput = findViewById<EditText>(R.id.tokenInput)
        val baseUrlInput = findViewById<EditText>(R.id.baseUrlInput)
        val statusView = findViewById<TextView>(R.id.statusText)
        val locationView = findViewById<TextView>(R.id.locationStatusText)
        val saveButton = findViewById<Button>(R.id.saveButton)
        val previewButton = findViewById<Button>(R.id.previewButton)
        val grantLocationButton = findViewById<Button>(R.id.grantLocationButton)

        val prefs = Preferences.of(this)
        roomInput.setText(prefs.getString(Preferences.KEY_ROOM_ID, ""))
        tokenInput.setText(prefs.getString(Preferences.KEY_DISPLAY_TOKEN, ""))
        baseUrlInput.setText(prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL))
        statusView.text = getString(
            R.string.current_configuration,
            prefs.getString(Preferences.KEY_ROOM_ID, "?"),
            Preferences.baseUrl(this)
        )

        refreshLocationStatus(locationView, grantLocationButton)

        saveButton.setOnClickListener {
            val roomId = roomInput.text.toString().trim()
            val token = tokenInput.text.toString().trim()
            val baseUrl = baseUrlInput.text.toString().trim().ifEmpty { Preferences.DEFAULT_BASE_URL }

            if (roomId.isEmpty() || token.isEmpty()) {
                Toast.makeText(this, R.string.validation_error, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit {
                putString(Preferences.KEY_ROOM_ID, roomId)
                putString(Preferences.KEY_DISPLAY_TOKEN, token)
                putString(Preferences.KEY_BASE_URL, baseUrl)
            }
            statusView.text = getString(R.string.current_configuration, roomId, baseUrl)
            Toast.makeText(this, R.string.saved_message, Toast.LENGTH_SHORT).show()
            finish()
        }

        previewButton.setOnClickListener {
            val roomId = roomInput.text.toString().trim().ifEmpty { return@setOnClickListener }
            val token = tokenInput.text.toString().trim().ifEmpty { return@setOnClickListener }
            val baseUrl = baseUrlInput.text.toString().trim().ifEmpty { Preferences.DEFAULT_BASE_URL }
            val url = "${baseUrl.trimEnd('/')}?room=${Uri.encode(roomId)}&token=${Uri.encode(token)}"
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }

        grantLocationButton.setOnClickListener {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), REQ_LOCATION
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_LOCATION) {
            refreshLocationStatus(
                findViewById(R.id.locationStatusText),
                findViewById(R.id.grantLocationButton)
            )
        }
    }

    private fun refreshLocationStatus(view: TextView, button: Button) {
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        view.text = getString(
            if (granted) R.string.location_granted else R.string.location_hint
        )
        view.setTextColor(if (granted) 0xFF4CAF50.toInt() else getColor(android.R.color.darker_gray))
        button.visibility = if (granted) Button.GONE else Button.VISIBLE
    }
}
