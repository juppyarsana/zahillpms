package com.zahill.tv

// Same keys as the old tv-screensaver app, so a provisioning script can write
// them the same way.
object Preferences {
    const val KEY_ROOM_ID = "room_id"
    const val KEY_DISPLAY_TOKEN = "display_token"
    const val KEY_BASE_URL = "base_url"
    const val KEY_LANG = "lang"            // "en" or "id" — the EN / ID pill on Home
    const val KEY_LAST_STATE = "last_state" // last /state JSON, so Home draws at boot without network
    const val DEFAULT_BASE_URL = "https://tv.zahill.kdai.cloud"
}
