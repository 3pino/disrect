package dev.fixplor.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import javax.crypto.KeyGenerator

class SecretBoxTest {
  private fun newBox(): SecretBox {
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    return SecretBox(key)
  }

  @Test
  fun seal_then_open_returns_the_same_text() {
    val box = newBox()
    val blob = box.seal("dav:place-1", "p@ss 日本語")
    assertEquals("p@ss 日本語", box.open("dav:place-1", blob))
  }

  @Test
  fun the_ciphertext_does_not_contain_the_plain_text() {
    val blob = newBox().seal("id", "secret-password")
    assertEquals(false, String(blob, Charsets.ISO_8859_1).contains("secret-password"))
  }

  @Test
  fun a_different_id_cannot_open_the_blob() {
    val box = newBox()
    val blob = box.seal("a", "x")
    assertThrows(Exception::class.java) { box.open("b", blob) }
  }

  @Test
  fun a_tampered_blob_cannot_be_opened() {
    val box = newBox()
    val blob = box.seal("a", "x")
    blob[blob.size - 1] = (blob[blob.size - 1].toInt() xor 1).toByte()
    assertThrows(Exception::class.java) { box.open("a", blob) }
  }

  @Test
  fun another_key_cannot_open_the_blob() {
    val blob = newBox().seal("a", "x")
    assertThrows(Exception::class.java) { newBox().open("a", blob) }
  }

  @Test
  fun each_seal_uses_a_new_iv() {
    val box = newBox()
    assertNotEquals(box.seal("a", "x").toList(), box.seal("a", "x").toList())
  }

  @Test
  fun a_short_blob_is_refused() {
    assertThrows(IllegalArgumentException::class.java) { newBox().open("a", ByteArray(4)) }
  }

  @Test
  fun file_names_hide_the_id_and_are_stable() {
    val name = SecretBox.fileName("dav:place-1")
    assertEquals(name, SecretBox.fileName("dav:place-1"))
    assertEquals(64 + 4, name.length)
    assertEquals(false, name.contains("place"))
    assertNotEquals(name, SecretBox.fileName("dav:place-2"))
  }
}
