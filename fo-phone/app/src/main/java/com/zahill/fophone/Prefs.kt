package com.zahill.fophone

import android.content.Context

/** What the app keeps on the phone: the PMS address and this phone's key. */
object Prefs {
  const val DEFAULT_SERVER = "https://pms.zahill.kdai.cloud"

  private fun sp(c: Context) = c.getSharedPreferences("fophone", Context.MODE_PRIVATE)

  fun server(c: Context): String = sp(c).getString("server", "") ?: ""
  fun setServer(c: Context, v: String) = sp(c).edit().putString("server", v.trim().trimEnd('/')).apply()

  fun key(c: Context): String = sp(c).getString("key", "") ?: ""
  fun setKey(c: Context, v: String) = sp(c).edit().putString("key", v.trim()).apply()
  fun clearKey(c: Context) = sp(c).edit().remove("key").apply()

  /** The phone-maker's own battery / autostart settings can't be read back, so the user ticks them. */
  fun makerDone(c: Context): Boolean = sp(c).getBoolean("makerDone", false)
  fun setMakerDone(c: Context, v: Boolean) = sp(c).edit().putBoolean("makerDone", v).apply()
}
