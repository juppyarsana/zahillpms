package com.zahill.fophone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart or an app update: connect the line again without opening the app. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    CallService.start(context)
  }
}
