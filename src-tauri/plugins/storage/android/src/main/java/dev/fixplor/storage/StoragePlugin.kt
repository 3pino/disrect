package dev.fixplor.storage

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * 全ファイルへのアクセス。Android 11 以上は「すべてのファイルへのアクセス」の許可（設定画面で与える）。
 * Android 10 以下は、実行時の読み取りの許可（この PoC では設定画面の案内のみ。読み取りの要求は後の段階）。
 */
@TauriPlugin
class StoragePlugin(private val activity: Activity) : Plugin(activity) {
  private fun granted(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      Environment.isExternalStorageManager()
    } else {
      ContextCompat.checkSelfPermission(activity, android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
    }

  @Command
  fun check(invoke: Invoke) {
    val ret = JSObject()
    ret.put("granted", granted())
    invoke.resolve(ret)
  }

  @Command
  fun request(invoke: Invoke) {
    val intent =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${activity.packageName}"))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}"))
      }
    try {
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: ActivityNotFoundException) {
      invoke.reject("この端末では設定画面を開けません")
    }
  }
}
