import Darwin
import Foundation
import SupatermCLIShared

private nonisolated struct AgentTranscriptFileIdentity: Equatable, Sendable {
  let device: UInt64
  let inode: UInt64

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.device == rhs.device && lhs.inode == rhs.inode
  }
}

nonisolated struct AgentTranscriptTailCursor: Equatable, Sendable {
  var offset: UInt64
  fileprivate var readOffset: UInt64
  fileprivate var fileIdentity: AgentTranscriptFileIdentity?
  fileprivate var incompleteLineChunks: [Data]
  fileprivate var incompleteLineByteCount: UInt64
  fileprivate var isSkippingOversizedLine: Bool
  fileprivate var checkpoint: Data

  fileprivate init(
    offset: UInt64,
    readOffset: UInt64,
    fileIdentity: AgentTranscriptFileIdentity,
    incompleteLineChunks: [Data],
    incompleteLineByteCount: UInt64,
    isSkippingOversizedLine: Bool,
    checkpoint: Data
  ) {
    self.offset = offset
    self.readOffset = readOffset
    self.fileIdentity = fileIdentity
    self.incompleteLineChunks = incompleteLineChunks
    self.incompleteLineByteCount = incompleteLineByteCount
    self.isSkippingOversizedLine = isSkippingOversizedLine
    self.checkpoint = checkpoint
  }
}

nonisolated enum AgentTranscriptTailer {
  static let defaultMaxReadSize = 64 * 1024
  static let defaultMaxLineSize = 8 * 1024 * 1024

  private static let checkpointSize = 256

  private struct FileRead {
    let data: Data
    let identity: AgentTranscriptFileIdentity
    let offset: UInt64
    let fileSize: UInt64
    let didReset: Bool
  }

  private struct ParsedRead {
    let objects: [JSONObject]
    let completedByteCount: UInt64
    let incompleteLineChunks: [Data]
    let incompleteLineByteCount: UInt64
    let isSkippingOversizedLine: Bool
  }

  struct Tick: Sendable {
    let cursor: AgentTranscriptTailCursor
    let objects: [JSONObject]
    let didReset: Bool
    let hasUnreadBytes: Bool
  }

  static func start(
    at path: String,
    maxReadSize: Int = defaultMaxReadSize,
    maxLineSize: Int = defaultMaxLineSize
  ) -> Tick? {
    readNext(
      at: path,
      cursor: nil,
      maxReadSize: maxReadSize,
      maxLineSize: maxLineSize
    )
  }

  static func advance(
    _ cursor: AgentTranscriptTailCursor,
    at path: String,
    maxReadSize: Int = defaultMaxReadSize,
    maxLineSize: Int = defaultMaxLineSize
  ) -> Tick? {
    readNext(
      at: path,
      cursor: cursor,
      maxReadSize: maxReadSize,
      maxLineSize: maxLineSize
    )
  }

  private static func readNext(
    at path: String,
    cursor: AgentTranscriptTailCursor?,
    maxReadSize: Int,
    maxLineSize: Int
  ) -> Tick? {
    precondition(maxLineSize > 0)
    guard let read = read(path: path, cursor: cursor, maxReadSize: maxReadSize) else {
      return nil
    }
    let previousCursor = read.didReset ? nil : cursor
    let parsed = parse(
      read.data,
      cursor: previousCursor,
      maxLineSize: maxLineSize
    )
    let previousOffset = previousCursor?.offset ?? 0
    let readOffset = read.offset + UInt64(read.data.count)
    let nextCursor = AgentTranscriptTailCursor(
      offset: previousOffset + parsed.completedByteCount,
      readOffset: readOffset,
      fileIdentity: read.identity,
      incompleteLineChunks: parsed.incompleteLineChunks,
      incompleteLineByteCount: parsed.incompleteLineByteCount,
      isSkippingOversizedLine: parsed.isSkippingOversizedLine,
      checkpoint: checkpoint(
        previous: previousCursor?.checkpoint ?? Data(),
        appending: read.data
      )
    )
    return Tick(
      cursor: nextCursor,
      objects: parsed.objects,
      didReset: read.didReset,
      hasUnreadBytes: readOffset < read.fileSize
    )
  }

  private static func read(
    path: String,
    cursor: AgentTranscriptTailCursor?,
    maxReadSize: Int
  ) -> FileRead? {
    precondition(maxReadSize > 0)
    do {
      let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
      defer { try? handle.close() }
      var metadata = stat()
      guard fstat(handle.fileDescriptor, &metadata) == 0, metadata.st_size >= 0 else {
        return nil
      }
      let identity = AgentTranscriptFileIdentity(
        device: UInt64(metadata.st_dev),
        inode: UInt64(metadata.st_ino)
      )
      let didReset = try shouldReset(
        cursor,
        identity: identity,
        fileSize: UInt64(metadata.st_size),
        handle: handle
      )
      let offset = didReset ? 0 : cursor?.readOffset ?? 0
      try handle.seek(toOffset: offset)
      let data = try handle.read(upToCount: maxReadSize) ?? Data()
      guard fstat(handle.fileDescriptor, &metadata) == 0, metadata.st_size >= 0 else {
        return nil
      }
      return FileRead(
        data: data,
        identity: identity,
        offset: offset,
        fileSize: UInt64(metadata.st_size),
        didReset: didReset
      )
    } catch {
      return nil
    }
  }

  private static func shouldReset(
    _ cursor: AgentTranscriptTailCursor?,
    identity: AgentTranscriptFileIdentity,
    fileSize: UInt64,
    handle: FileHandle
  ) throws -> Bool {
    guard let cursor else { return false }
    if fileSize < cursor.readOffset {
      return true
    }
    if let fileIdentity = cursor.fileIdentity, fileIdentity != identity {
      return true
    }
    guard !cursor.checkpoint.isEmpty else { return false }
    let checkpointSize = UInt64(cursor.checkpoint.count)
    guard cursor.readOffset >= checkpointSize else { return true }
    try handle.seek(toOffset: cursor.readOffset - checkpointSize)
    return try handle.read(upToCount: cursor.checkpoint.count) != cursor.checkpoint
  }

  private static func checkpoint(previous: Data, appending data: Data) -> Data {
    if data.count >= checkpointSize {
      return Data(data.suffix(checkpointSize))
    }
    var checkpoint = previous
    checkpoint.append(data)
    if checkpoint.count > checkpointSize {
      checkpoint.removeFirst(checkpoint.count - checkpointSize)
    }
    return checkpoint
  }

  private static func parse(
    _ data: Data,
    cursor: AgentTranscriptTailCursor?,
    maxLineSize: Int
  ) -> ParsedRead {
    var objects: [JSONObject] = []
    var completedByteCount: UInt64 = 0
    var chunks = cursor?.incompleteLineChunks ?? []
    var byteCount = cursor?.incompleteLineByteCount ?? 0
    var isSkipping = cursor?.isSkippingOversizedLine ?? false
    var lineStart = data.startIndex

    while lineStart < data.endIndex,
      let newlineIndex = data[lineStart...].firstIndex(of: 0x0A)
    {
      let segment = data[lineStart..<newlineIndex]
      byteCount += UInt64(segment.count)
      if !isSkipping {
        if byteCount <= UInt64(maxLineSize) {
          if !segment.isEmpty {
            chunks.append(Data(segment))
          }
          if let object = decode(chunks, byteCount: byteCount) {
            objects.append(object)
          }
        } else {
          isSkipping = true
        }
      }
      completedByteCount += byteCount + 1
      chunks.removeAll(keepingCapacity: true)
      byteCount = 0
      isSkipping = false
      lineStart = data.index(after: newlineIndex)
    }

    let remainder = data[lineStart...]
    byteCount += UInt64(remainder.count)
    if !isSkipping {
      if byteCount <= UInt64(maxLineSize) {
        if !remainder.isEmpty {
          chunks.append(Data(remainder))
        }
      } else {
        chunks.removeAll(keepingCapacity: false)
        isSkipping = true
      }
    }

    return ParsedRead(
      objects: objects,
      completedByteCount: completedByteCount,
      incompleteLineChunks: chunks,
      incompleteLineByteCount: byteCount,
      isSkippingOversizedLine: isSkipping
    )
  }

  private static func decode(_ chunks: [Data], byteCount: UInt64) -> JSONObject? {
    guard byteCount <= UInt64(Int.max) else { return nil }
    var line = Data()
    line.reserveCapacity(Int(byteCount))
    for chunk in chunks {
      line.append(chunk)
    }
    return (try? JSONDecoder().decode(JSONValue.self, from: line))?.objectValue
  }
}
