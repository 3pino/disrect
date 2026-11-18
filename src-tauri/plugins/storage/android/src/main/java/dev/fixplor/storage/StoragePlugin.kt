package dev.fixplor.storage

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

@InvokeArg
class SecretArgs {
  lateinit var id: String
  var value: String? = null
}

/**
 * 全ファイルへのアクセス（check・request）と、資格情報の箱（secretGet・secretSet・secretDelete）。
 * 資格情報は、Rust（OsStore）からだけ呼ぶ。WebView の JS へは権限を出さない（default.toml に入れない）。
 *
 * 全ファイルへのアクセス: Android 11 以上は「すべてのファイルへのアクセス」の許可（設定画面で与える）。
 * Android 10 以下は、読み取りの許可の状態を見るだけ（要求は設定画面を開く。この PoC の対象外）。
 */
@TauriPlugin
class StoragePlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    private const val KEY_ALIAS = "fixplor-secrets"
    private const val SECRET_DIR = "secrets"
  }

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

  /** Android Keystore の鍵（無ければ作る）。鍵は端末の外へ出ない（エクスポートできない） */
  private fun boxKey(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }

  private fun secretDir(): File = File(activity.filesDir, SECRET_DIR).apply { mkdirs() }

  private fun secretFile(id: String): File = File(secretDir(), SecretBox.fileName(id))

  @Command
  fun secretGet(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SecretArgs::class.java)
      val file = secretFile(args.id)
      val ret = JSObject()
      if (!file.exists()) {
        ret.put("found", false)
      } else {
        ret.put("found", true)
        ret.put("value", SecretBox(boxKey()).open(args.id, file.readBytes()))
      }
      invoke.resolve(ret)
    } catch (e: Exception) {
      invoke.reject("資格情報を読めません")
    }
  }

  @Command
  fun secretSet(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SecretArgs::class.java)
      val value = args.value ?: throw IllegalArgumentException("値がありません")
      val blob = SecretBox(boxKey()).seal(args.id, value)
      // 書きかけを残さない: 一時の名前へ書いてから付け替える
      val file = secretFile(args.id)
      val tmp = File(file.parentFile, file.name + ".tmp")
      tmp.writeBytes(blob)
      if (!tmp.renameTo(file)) {
        tmp.delete()
        throw IllegalStateException("保存できません")
      }
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("資格情報を保存できません")
    }
  }

  @Command
  fun secretDelete(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SecretArgs::class.java)
      secretFile(args.id).delete()
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("資格情報を消せません")
    }
  }
}
