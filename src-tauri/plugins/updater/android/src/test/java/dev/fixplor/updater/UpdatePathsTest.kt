package dev.fixplor.updater

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class UpdatePathsTest {
  @get:Rule
  val tmp = TemporaryFolder()

  @Test
  fun a_file_inside_the_update_dir_is_accepted() {
    val dir = tmp.newFolder("update")
    assertTrue(UpdatePaths.isInside(File(dir, "fixplor.apk"), dir))
  }

  @Test
  fun the_dir_itself_and_outside_files_are_refused() {
    val dir = tmp.newFolder("update")
    assertFalse(UpdatePaths.isInside(dir, dir))
    assertFalse(UpdatePaths.isInside(File(tmp.root, "secret.db"), dir))
  }

  @Test
  fun dot_dot_escapes_are_refused() {
    val dir = tmp.newFolder("update")
    assertFalse(UpdatePaths.isInside(File(dir, "../secret.db"), dir))
  }

  @Test
  fun a_sibling_with_the_same_prefix_is_refused() {
    val dir = tmp.newFolder("update")
    val sibling = tmp.newFolder("update-evil")
    assertFalse(UpdatePaths.isInside(File(sibling, "x.apk"), dir))
  }
}
