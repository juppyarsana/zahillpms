package com.zahill.fophone

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** The phone's own ringtone, looping, plus vibration — like a normal incoming call. */
class Ringer(private val context: Context) {
  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null

  @Synchronized
  fun start() {
    if (player != null) return
    try {
      val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      player = MediaPlayer().apply {
        setAudioAttributes(AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        setDataSource(context, uri)
        isLooping = true
        prepare()
        start()
      }
    } catch (_: Exception) { player = null }
    try {
      vibrator = if (Build.VERSION.SDK_INT >= 31)
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      else @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 600), 0))
    } catch (_: Exception) {}
  }

  @Synchronized
  fun stop() {
    try { player?.stop() } catch (_: Exception) {}
    try { player?.release() } catch (_: Exception) {}
    player = null
    try { vibrator?.cancel() } catch (_: Exception) {}
    vibrator = null
  }
}
