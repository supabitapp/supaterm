package expo.modules.supatermterminal

fun main() {
  val buffer = TerminalOutputBuffer()
  buffer.write("one".toByteArray(), reset = false)
  buffer.write("two".toByteArray(), reset = false)
  check(buffer.data.toString(Charsets.UTF_8) == "onetwo")
  buffer.write("reset".toByteArray(), reset = true)
  check(buffer.data.toString(Charsets.UTF_8) == "reset")
  buffer.write(byteArrayOf(), reset = true)
  check(buffer.data.isEmpty())

  val unicode = "😀".repeat(140_000) + "tail"
  buffer.write(unicode.toByteArray(), reset = false)
  check(buffer.data.size <= 512 * 1024)
  check(!buffer.data.toString(Charsets.UTF_8).contains('\uFFFD'))
  check(buffer.data.toString(Charsets.UTF_8).endsWith("tail"))
  repeat(200) { buffer.write("中".repeat(4000).toByteArray(), reset = false) }
  check(buffer.data.size <= 512 * 1024)
  check(!buffer.data.toString(Charsets.UTF_8).contains('\uFFFD'))
  println("Passed terminal append/reset, bounded replay, UTF-8 trimming and compaction")
}
