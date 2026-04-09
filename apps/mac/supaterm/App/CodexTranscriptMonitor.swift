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
  var messages: [String]
  var replacesMessages: Bool

  init(
    status: CodexTranscriptTurnStatus? = nil,
    detail: String? = nil,
    messages: [String] = [],
    replacesMessages: Bool = false
  ) {
    self.status = status
    self.detail = detail
    self.messages = messages
    self.replacesMessages = replacesMessages
  }

  var hasChanges: Bool {
    status != nil || detail != nil || !messages.isEmpty
  }

  mutating func absorb(_ update: Self) {
    if let status = update.status {
      self.status = status
    }
    if let detail = update.detail {
      self.detail = detail
    }
    if update.replacesMessages {
      messages = update.messages
      replacesMessages = true
    } else if !update.messages.isEmpty {
      messages.append(contentsOf: update.messages)
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
      let messages = normalizedMessageList(string(in: eventPayload, key: "last_agent_message"))
      return .init(
        status: .completed(string(in: eventPayload, key: "turn_id")),
        messages: messages,
        replacesMessages: !messages.isEmpty
      )
    case "turn_aborted":
      return .init(status: .aborted(string(in: eventPayload, key: "turn_id")))
    case "agent_message":
      let phase = string(in: eventPayload, key: "phase") ?? string(in: payload, key: "phase")
      if phase == "final_answer" {
        return finalMessageUpdate(
          string(in: eventPayload, key: "message") ?? string(in: payload, key: "message")
        )
      }
      return liveMessageUpdate(string(in: eventPayload, key: "message") ?? string(in: payload, key: "message"))
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
    let content = array(in: payload, key: "content")
    let text = normalizedMessage(
      content?
        .compactMap { dictionaryValue in
          string(in: dictionaryValue, key: "text")
        }
        .joined(separator: " ")
    )
    if string(in: payload, key: "phase") == "final_answer" {
      return finalMessageUpdate(text)
    }
    return liveMessageUpdate(text)
  }

  private static func liveMessageUpdate(
    _ message: String?
  ) -> CodexTranscriptUpdate? {
    guard
      let message = normalizedMessage(message),
      let detail = normalizedDetail(message)
    else {
      return nil
    }
    return .init(detail: detail, messages: [message])
  }

  private static func finalMessageUpdate(
    _ message: String?
  ) -> CodexTranscriptUpdate? {
    let messages = normalizedMessageList(message)
    guard !messages.isEmpty else { return nil }
    return .init(messages: messages, replacesMessages: true)
  }

  private static func normalizedMessageList(
    _ message: String?
  ) -> [String] {
    normalizedMessage(message).map { [$0] } ?? []
  }

  private static func normalizedDetail(_ text: String?) -> String? {
    guard let normalized = normalizedMessage(text) else { return nil }
    if normalized.count <= 160 {
      return normalized
    }
    return String(normalized.prefix(157)) + "..."
  }

  private static func normalizedMessage(_ text: String?) -> String? {
    guard let text else { return nil }
    let normalized =
      text
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    guard !normalized.isEmpty else { return nil }
    return normalized
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
