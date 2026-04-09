import Foundation

enum CodexTranscriptTurnStatus: Equatable {
  case started(String?)
  case completed(String?)
  case aborted(String?)

  var startsNewTurn: Bool {
    switch self {
    case .started:
      true
    case .completed, .aborted:
      false
    }
  }

  var isFinal: Bool {
    switch self {
    case .started:
      false
    case .completed, .aborted:
      true
    }
  }
}

struct CodexTranscriptUpdate: Equatable {
  var status: CodexTranscriptTurnStatus?
  var detail: String?

  init(
    status: CodexTranscriptTurnStatus? = nil,
    detail: String? = nil
  ) {
    self.status = status
    self.detail = detail
  }

  var hasChanges: Bool {
    status != nil || detail != nil
  }

  mutating func absorb(_ update: Self) {
    if let status = update.status {
      self.status = status
    }
    if let detail = update.detail {
      self.detail = detail
    }
  }
}

struct CodexTranscriptCursor {
  var offset: UInt64
}

enum CodexTranscriptMonitor {
  static func start(
    at path: String
  ) -> (CodexTranscriptCursor, CodexTranscriptUpdate?)? {
    guard let data = read(path: path, from: 0) else { return nil }
    let (consumedBytes, latestUpdate) = parse(data)
    let cursor = CodexTranscriptCursor(offset: UInt64(consumedBytes))
    guard let latestUpdate else { return (cursor, nil) }
    if latestUpdate.status?.isFinal == true {
      return (cursor, nil)
    }
    return (cursor, latestUpdate)
  }

  static func advance(
    _ cursor: CodexTranscriptCursor,
    at path: String
  ) -> (CodexTranscriptCursor, CodexTranscriptUpdate?)? {
    let fileURL = URL(fileURLWithPath: path)
    guard
      let values = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
      let fileSize = values.fileSize
    else {
      return nil
    }
    if UInt64(fileSize) < cursor.offset {
      return start(at: path)
    }
    guard let data = read(path: path, from: cursor.offset) else { return nil }
    let (consumedBytes, latestUpdate) = parse(data)
    var updatedCursor = cursor
    updatedCursor.offset += UInt64(consumedBytes)
    return (updatedCursor, latestUpdate)
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

  private static func parse(_ data: Data) -> (Int, CodexTranscriptUpdate?) {
    guard let newlineIndex = data.lastIndex(of: 0x0A) else {
      return (0, nil)
    }
    let completeData = data.prefix(through: newlineIndex)
    var latestUpdate = CodexTranscriptUpdate()
    for line in completeData.split(separator: 0x0A) {
      guard let update = update(in: Data(line)) else { continue }
      if update.status?.startsNewTurn == true {
        latestUpdate = CodexTranscriptUpdate()
      }
      latestUpdate.absorb(update)
    }
    return (completeData.count, latestUpdate.hasChanges ? latestUpdate : nil)
  }

  private static func update(in line: Data) -> CodexTranscriptUpdate? {
    guard
      let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
      let lineType = string(in: object, key: "type"),
      let payload = dictionary(in: object, key: "payload")
    else {
      return nil
    }
    switch lineType {
    case "event_msg":
      return eventUpdate(payload)
    case "response_item":
      return responseItemUpdate(payload)
    default:
      return nil
    }
  }

  private static func eventUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard let eventType = string(in: payload, key: "type") else { return nil }
    let eventPayload = dictionary(in: payload, key: "payload") ?? payload
    switch eventType {
    case "task_started", "turn_started":
      return .init(status: .started(string(in: eventPayload, key: "turn_id")))
    case "task_complete", "turn_complete":
      return .init(status: .completed(string(in: eventPayload, key: "turn_id")))
    case "turn_aborted":
      return .init(status: .aborted(string(in: eventPayload, key: "turn_id")))
    case "agent_message":
      let phase = string(in: eventPayload, key: "phase") ?? string(in: payload, key: "phase")
      guard phase != "final_answer" else { return nil }
      return detailUpdate(string(in: eventPayload, key: "message") ?? string(in: payload, key: "message"))
    default:
      return nil
    }
  }

  private static func responseItemUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard let itemType = string(in: payload, key: "type") else { return nil }
    switch itemType {
    case "message":
      return messageUpdate(payload)
    default:
      return nil
    }
  }

  private static func messageUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard string(in: payload, key: "role") == "assistant" else { return nil }
    guard string(in: payload, key: "phase") != "final_answer" else { return nil }
    let content = array(in: payload, key: "content")
    let text = normalizedDetail(
      content?
        .compactMap { dictionaryValue in
          string(in: dictionaryValue, key: "text")
        }
        .joined(separator: " ")
    )
    return detailUpdate(text)
  }

  private static func detailUpdate(
    _ detail: String?
  ) -> CodexTranscriptUpdate? {
    guard let detail = normalizedDetail(detail) else { return nil }
    return .init(detail: detail)
  }

  private static func normalizedDetail(_ text: String?) -> String? {
    guard let text else { return nil }
    let normalized =
      text
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    guard !normalized.isEmpty else { return nil }
    if normalized.count <= 160 {
      return normalized
    }
    return String(normalized.prefix(157)) + "..."
  }

  private static func dictionary(
    in object: [String: Any]?,
    key: String
  ) -> [String: Any]? {
    object?[key] as? [String: Any]
  }

  private static func array(
    in object: [String: Any]?,
    key: String
  ) -> [[String: Any]]? {
    (object?[key] as? [Any])?.compactMap { $0 as? [String: Any] }
  }

  private static func string(
    in object: [String: Any]?,
    key: String
  ) -> String? {
    object?[key] as? String
  }
}
