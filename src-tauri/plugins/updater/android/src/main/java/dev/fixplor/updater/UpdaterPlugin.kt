package dev.fixplor.updater

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallArgs {
  lateinit var path: String
}

/** APK の取得は Rust（download_apk）。ここは「入れる許可」「設定画面」「インストーラーを開く」だけ */
@TauriPlugin
class UpdaterPlugin(private val activity: Activity) : Plugin(activity) {
  private fun canInstallPackages(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()

  @Command
  fun canInstall(invoke: Invoke) {
    val ret = JSObject()
    ret.put("granted", canInstallPackages())
    invoke.resolve(ret)
  }

  @Command
  fun openInstallSettings(invoke: Invoke) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
      }
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject("設定画面を開けません")
    }
  }

  /** 取った APK（キャッシュの update/ の中だけ）を、パッケージインストーラーへ渡す */
  @Command
  fun installApk(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallArgs::class.java)
      val file = File(args.path)
      val dir = File(activity.cacheDir, UpdatePaths.UPDATE_DIR)
      if (!UpdatePaths.isInside(file, dir) || !file.isFile) {
        invoke.reject("入れる APK が見つかりません")
        return
      }
      val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.updater", file)
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      invoke.resolve()
    } catch (ex: ActivityNotFoundException) {
      invoke.reject("インストーラーを開けません")
    } catch (ex: Exception) {
      invoke.reject("APK を渡せませんでした")
    }
  }
}
