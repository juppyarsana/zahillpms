package com.birdnest.tvscreensaver

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.edit

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val roomInput = findViewById<EditText>(R.id.roomIdInput)
        val tokenInput = findViewById<EditText>(R.id.tokenInput)
        val baseUrlInput = findViewById<EditText>(R.id.baseUrlInput)
        val statusView = findViewById<TextView>(R.id.statusText)
        val saveButton = findViewById<Button>(R.id.saveButton)
        val previewButton = findViewById<Button>(R.id.previewButton)

        val prefs = getSharedPreferences(packageName, MODE_PRIVATE)
        roomInput.setText(prefs.getString(Preferences.KEY_ROOM_ID, ""))
        tokenInput.setText(prefs.getString(Preferences.KEY_DISPLAY_TOKEN, ""))
        baseUrlInput.setText(prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL))

        statusView.text = getString(
            R.string.current_configuration,
            prefs.getString(Preferences.KEY_ROOM_ID, "?"),
            prefs.getString(Preferences.KEY_BASE_URL, Preferences.DEFAULT_BASE_URL)
        )

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
        }

        previewButton.setOnClickListener {
            val roomId = roomInput.text.toString().trim().ifEmpty { return@setOnClickListener }
            val token = tokenInput.text.toString().trim().ifEmpty { return@setOnClickListener }
            val baseUrl = baseUrlInput.text.toString().trim().ifEmpty { Preferences.DEFAULT_BASE_URL }
            val previewUrl = "$baseUrl?room=${Uri.encode(roomId)}&token=${Uri.encode(token)}"
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(previewUrl)))
        }
    }
}
