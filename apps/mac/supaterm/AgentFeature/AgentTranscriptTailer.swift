import Foundation
import SupatermCLIShared

struct AgentTranscriptTailCursor: Equatable {
  var offset: UInt64
}

enum AgentTranscriptTailer {
  struct Tick {
    let cursor: AgentTranscriptTailCursor
    let objects: [JSONObject]
    let didReset: Bool
  }

  static func start(at path: String) -> Tick? {
    guard let data = read(path: path, from: 0) else { return nil }
    let (consumedBytes, objects) = parse(data)
    return Tick(
      cursor: AgentTranscriptTailCursor(offset: UInt64(consumedBytes)),
      objects: objects,
      didReset: false
    )
  }

  static func advance(
    _ cursor: AgentTranscriptTailCursor,
    at path: String
  ) -> Tick? {
    let fileURL = URL(fileURLWithPath: path)
    guard
      let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
      let fileSize = values.fileSize
    else {
      return nil
    }
    if UInt64(fileSize) < cursor.offset {
      guard let restarted = start(at: path) else { return nil }
      return Tick(cursor: restarted.cursor, objects: restarted.objects, didReset: true)
    }
    guard let data = read(path: path, from: cursor.offset) else { return nil }
    let (consumedBytes, objects) = parse(data)
    var updatedCursor = cursor
    updatedCursor.offset += UInt64(consumedBytes)
    return Tick(cursor: updatedCursor, objects: objects, didReset: false)
  }

  private static func read(path: String, from offset: UInt64) -> Data? {
    do {
      let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
      defer { try? handle.close() }
      try handle.seek(toOffset: offset)
      return try handle.readToEnd() ?? Data()
    } catch {
      return nil
    }
  }

  private static func parse(_ data: Data) -> (Int, [JSONObject]) {
    guard let newlineIndex = data.lastIndex(of: 0x0A) else {
      return (0, [])
    }
    let completeData = data.prefix(through: newlineIndex)
    let decoder = JSONDecoder()
    let objects = completeData.split(separator: 0x0A).compactMap { line in
      (try? decoder.decode(JSONValue.self, from: Data(line)))?.objectValue
    }
    return (completeData.count, objects)
  }
}
