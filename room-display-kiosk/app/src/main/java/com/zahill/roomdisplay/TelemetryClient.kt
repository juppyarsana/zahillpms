package com.zahill.roomdisplay

import android.net.Uri
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL

/**
 * POSTs one telemetry snapshot to
 *   {baseUrl}/api/display/room/{roomId}/telemetry
 * with the per-property display token as a bearer credential — the same
 * auth the PWA uses (authDisplay middleware).
 *
 * Blocking; only ever called from TelemetryScheduler's single worker thread.
 */
object TelemetryClient {

    private const val TAG = "Telemetry"

    fun post(baseUrl: String, roomId: String, token: String, jsonBody: String): Boolean {
        val target = try {
            URL(URL(baseUrl.trimEnd('/') + "/"), "api/display/room/${Uri.encode(roomId)}/telemetry")
        } catch (e: Exception) {
            Log.w(TAG, "bad base URL: ${e.message}")
            return false
        }

        var conn: HttpURLConnection? = null
        return try {
            conn = (target.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 15_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Authorization", "Bearer $token")
            }
            conn.outputStream.use { it.write(jsonBody.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code !in 200..299) {
                Log.w(TAG, "POST $target -> HTTP $code")
            }
            code in 200..299
        } catch (e: Exception) {
            Log.w(TAG, "POST failed: ${e.message}")
            false
        } finally {
            conn?.disconnect()
        }
    }
}
