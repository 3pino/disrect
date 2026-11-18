package dev.fixplor.storage

import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 資格情報の箱（純粋な部分。鍵は呼び出し側が持つ: 実機では Android Keystore の非公開の鍵、試験では生成した鍵）。
 *
 * 形: 1 件ごとに 1 つのファイル（名前は id の SHA-256）。中身は IV（12 バイト）と AES-GCM の暗号文（認証タグ込み）。
 * 追加の情報（AAD）として id を入れるので、ファイルを別の id の名前へ付け替えても開けない。
 * 平文はディスクに書かない（書くのは暗号文だけ）。
 */
class SecretBox(private val key: SecretKey) {
  companion object {
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    /** id からファイルの名前（16 進の SHA-256）。id そのものは名前に出さない */
    fun fileName(id: String): String =
      MessageDigest.getInstance("SHA-256").digest(id.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) } + ".bin"
  }

  /** 平文を暗号化する。戻り値は IV + 暗号文 */
  fun seal(id: String, plain: String): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key)
    cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    val iv = cipher.iv
    require(iv.size == IV_BYTES) { "IV の長さ" }
    return iv + body
  }

  /** seal の結果を開く。壊れている・id が違う・鍵が違うときは例外（呼び出し側が「使えない」にする） */
  fun open(id: String, blob: ByteArray): String {
    require(blob.size > IV_BYTES) { "短すぎます" }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, blob.copyOfRange(0, IV_BYTES)))
    cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    return String(cipher.doFinal(blob.copyOfRange(IV_BYTES, blob.size)), Charsets.UTF_8)
  }
}
