package com.zahill.tv

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit

// Room ID / display token / TV URL. No icon of its own: hold OK 3 s on Home,
// the screensaver's settings in Android, or adb:
//   adb shell am start -n com.zahill.tv/.SettingsActivity
// A provisioning script can also set everything in one go (saved, then closes):
//   adb shell am start -n com.zahill.tv/.SettingsActivity \
//     --es room_id 101 --es display_token <token> [--es base_url https://...]
class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences(packageName, MODE_PRIVATE)

        val provRoom = intent.getStringExtra(Preferences.KEY_ROOM_ID)?.trim()
        val provToken = intent.getStringExtra(Preferences.KEY_DISPLAY_TOKEN)?.trim()
        if (!provRoom.isNullOrEmpty() && !provToken.isNullOrEmpty()) {
            prefs.edit {
                putString(Preferences.KEY_ROOM_ID, provRoom)
                putString(Preferences.KEY_DISPLAY_TOKEN, provToken)
                intent.getStringExtra(Preferences.KEY_BASE_URL)?.trim()?.takeIf { it.isNotEmpty() }
                    ?.let { putString(Preferences.KEY_BASE_URL, it) }
                remove(Preferences.KEY_LAST_STATE)
            }
            Toast.makeText(this, getString(R.string.current_configuration, provRoom,
                prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL)), Toast.LENGTH_LONG).show()
            finish()
            return
        }

        setContentView(R.layout.activity_settings)

        val roomInput = findViewById<EditText>(R.id.roomIdInput)
        val tokenInput = findViewById<EditText>(R.id.tokenInput)
        val baseUrlInput = findViewById<EditText>(R.id.baseUrlInput)
        val statusView = findViewById<TextView>(R.id.statusText)
        val screensaverStatusView = findViewById<TextView>(R.id.screensaverStatusText)

        roomInput.setText(prefs.getString(Preferences.KEY_ROOM_ID, ""))
        tokenInput.setText(prefs.getString(Preferences.KEY_DISPLAY_TOKEN, ""))
        baseUrlInput.setText(prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL))
        statusView.text = getString(
            R.string.current_configuration,
            prefs.getString(Preferences.KEY_ROOM_ID, "?"),
            prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL)
        )
        updateScreensaverStatus(screensaverStatusView)

        findViewById<Button>(R.id.saveButton).setOnClickListener {
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
                remove(Preferences.KEY_LAST_STATE) // another room: don't show the old guest
            }
            statusView.text = getString(R.string.current_configuration, roomId, baseUrl)
            Toast.makeText(this, R.string.saved_message, Toast.LENGTH_SHORT).show()
        }

        findViewById<Button>(R.id.previewButton).setOnClickListener {
            val roomId = roomInput.text.toString().trim().ifEmpty { return@setOnClickListener }
            val token = tokenInput.text.toString().trim().ifEmpty { return@setOnClickListener }
            val baseUrl = baseUrlInput.text.toString().trim().ifEmpty { Preferences.DEFAULT_BASE_URL }
            startActivity(Intent(Intent.ACTION_VIEW,
                Uri.parse("$baseUrl?room=${Uri.encode(roomId)}&token=${Uri.encode(token)}")))
        }

        findViewById<Button>(R.id.setScreensaverButton).setOnClickListener {
            val hasPermission = checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") ==
                    PackageManager.PERMISSION_GRANTED
            if (!hasPermission) {
                Toast.makeText(this, getString(R.string.screensaver_permission_missing, packageName),
                    Toast.LENGTH_LONG).show()
                return@setOnClickListener
            }
            val component = "$packageName/.ZahillDreamService"
            if (Settings.Secure.getString(contentResolver, "screensaver_components") == component) {
                Toast.makeText(this, R.string.screensaver_already_set, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            Settings.Secure.putString(contentResolver, "screensaver_components", component)
            Settings.Secure.putInt(contentResolver, "screensaver_enabled", 1)
            Settings.Secure.putInt(contentResolver, "screensaver_activate_on_sleep", 1)
            Toast.makeText(this, R.string.screensaver_set_success, Toast.LENGTH_SHORT).show()
            updateScreensaverStatus(screensaverStatusView)
        }

        // Home has no Settings tile for guests; staff reach Android settings (Wi-Fi etc.) here.
        findViewById<Button>(R.id.androidSettingsButton).setOnClickListener {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }

    private fun updateScreensaverStatus(view: TextView) {
        val isActive = Settings.Secure.getString(contentResolver, "screensaver_components") ==
                "$packageName/.ZahillDreamService"
        view.text = getString(if (isActive) R.string.screensaver_status_active else R.string.screensaver_status_inactive)
        view.setTextColor(if (isActive) 0xFF4CAF50.toInt() else getColor(android.R.color.darker_gray))
    }
}
