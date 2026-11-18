package dev.fixplor.updater

import java.io.File

/** 入れてよい APK の場所（純粋な部分。JVM で試験する） */
object UpdatePaths {
  const val UPDATE_DIR = "update"

  /** file が dir の中にあるか（シンボリックリンク・.. を正規化して比べる。dir 自身は含まない） */
  fun isInside(file: File, dir: File): Boolean {
    val base = dir.canonicalFile
    val target = file.canonicalFile
    return target.path.startsWith(base.path + File.separator)
  }
}
