import Foundation

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
  precondition(condition(), message)
}

let buffer = TerminalOutputBuffer()
buffer.write(Data("one".utf8), reset: false)
buffer.write(Data("two".utf8), reset: false)
check(String(data: buffer.data, encoding: .utf8) == "onetwo", "appends retain earlier output")
buffer.write(Data("reset".utf8), reset: true)
check(String(data: buffer.data, encoding: .utf8) == "reset", "reset replaces earlier output")
buffer.write(Data(), reset: true)
check(buffer.data.isEmpty, "empty reset clears replay")

let unicode = String(repeating: "😀", count: 140_000) + "tail"
buffer.write(Data(unicode.utf8), reset: false)
check(buffer.data.count <= 512 * 1024, "replay remains bounded")
check(String(data: buffer.data, encoding: .utf8) != nil, "trimming preserves UTF-8 boundaries")
check(String(data: buffer.data, encoding: .utf8)?.hasSuffix("tail") == true, "trimming retains newest output")
for _ in 0..<200 {
  buffer.write(Data(String(repeating: "中", count: 4000).utf8), reset: false)
}
check(buffer.data.count <= 512 * 1024, "compacted replay remains bounded")
check(String(data: buffer.data, encoding: .utf8) != nil, "compaction preserves UTF-8 boundaries")
print("Passed terminal append/reset, bounded replay, UTF-8 trimming and compaction")
