package com.zahill.roomdisplay

import android.content.Context
import android.content.SharedPreferences

object Preferences {
    const val KEY_ROOM_ID = "room_id"
    const val KEY_DISPLAY_TOKEN = "display_token"
    const val KEY_BASE_URL = "base_url"

    // The Room Display PWA origin. /api is same-origin, so this one value
    // covers both the WebView URL and the telemetry POST target.
    const val DEFAULT_BASE_URL = "https://display.zahill.kdai.cloud"

    fun of(context: Context): SharedPreferences =
        context.getSharedPreferences(context.packageName, Context.MODE_PRIVATE)

    fun roomId(context: Context): String? =
        of(context).getString(KEY_ROOM_ID, null)?.trim()?.ifEmpty { null }

    fun displayToken(context: Context): String? =
        of(context).getString(KEY_DISPLAY_TOKEN, null)?.trim()?.ifEmpty { null }

    fun baseUrl(context: Context): String =
        of(context).getString(KEY_BASE_URL, null)?.trim()?.ifEmpty { null } ?: DEFAULT_BASE_URL

    fun isConfigured(context: Context): Boolean =
        !roomId(context).isNullOrBlank() && !displayToken(context).isNullOrBlank()
}
