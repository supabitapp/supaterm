import Foundation

enum CodexTranscriptTurnStatus: Equatable {
  case started(String?)
  case completed(String?)
  case aborted(String?)

  var isFinal: Bool {
    switch self {
    case .started:
      false
    case .completed, .aborted:
      true
    }
  }
}

enum CodexTranscriptDetailPriority: Int {
  case tool
  case reasoning
  case message
}

struct CodexTranscriptUpdate: Equatable {
  var status: CodexTranscriptTurnStatus?
  var detail: String?
  var detailPriority: CodexTranscriptDetailPriority?

  init(
    status: CodexTranscriptTurnStatus? = nil,
    detail: String? = nil,
    detailPriority: CodexTranscriptDetailPriority? = nil
  ) {
    self.status = status
    self.detail = detail
    self.detailPriority = detailPriority
  }

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.status == rhs.status && lhs.detail == rhs.detail
  }

  var hasChanges: Bool {
    status != nil || detail != nil
  }

  mutating func absorb(_ update: Self) {
    if let status = update.status {
      self.status = status
    }
    if let detail = update.detail {
      let currentPriority = detailPriority ?? .tool
      let incomingPriority = update.detailPriority ?? .tool
      guard self.detail == nil || incomingPriority.rawValue >= currentPriority.rawValue else {
        return
      }
      self.detail = detail
      self.detailPriority = incomingPriority
    }
  }
}

struct CodexTranscriptCursor {
  var offset: UInt64
  var detailPriority: CodexTranscriptDetailPriority?
}

enum CodexTranscriptMonitor {
  static func makeCursor(at path: String) -> CodexTranscriptCursor? {
    guard let data = read(path: path, from: 0) else { return nil }
    let (consumedBytes, _) = parse(data)
    return .init(offset: UInt64(consumedBytes), detailPriority: nil)
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
      guard let resetCursor = makeCursor(at: path) else { return nil }
      return (resetCursor, nil)
    }
    guard let data = read(path: path, from: cursor.offset) else { return nil }
    let (consumedBytes, latestUpdate) = parse(data)
    var updatedCursor = cursor
    updatedCursor.offset += UInt64(consumedBytes)
    let filteredUpdate: CodexTranscriptUpdate?
    if let latestUpdate {
      filteredUpdate = mergedUpdate(latestUpdate, into: &updatedCursor)
    } else {
      filteredUpdate = nil
    }
    return (updatedCursor, filteredUpdate)
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
      if let update = update(in: Data(line)) {
        latestUpdate.absorb(update)
      }
    }
    return (completeData.count, latestUpdate.hasChanges ? latestUpdate : nil)
  }

  private static func mergedUpdate(
    _ update: CodexTranscriptUpdate,
    into cursor: inout CodexTranscriptCursor
  ) -> CodexTranscriptUpdate? {
    var update = update

    if case .started = update.status {
      cursor.detailPriority = nil
    }

    if let detail = update.detail {
      let incomingPriority = update.detailPriority ?? .tool
      if let currentPriority = cursor.detailPriority, incomingPriority.rawValue < currentPriority.rawValue {
        update.detail = nil
      } else if !detail.isEmpty {
        cursor.detailPriority = incomingPriority
      }
    }

    if update.status?.isFinal == true {
      cursor.detailPriority = nil
    }

    return update.hasChanges ? update : nil
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
    case "agent_reasoning":
      return thinkingDetailUpdate(
        string(in: eventPayload, key: "text") ?? string(in: payload, key: "text"),
        priority: .reasoning
      )
    case "agent_message":
      let phase = string(in: eventPayload, key: "phase") ?? string(in: payload, key: "phase")
      guard phase != "final_answer" else { return nil }
      return plainDetailUpdate(
        string(in: eventPayload, key: "message") ?? string(in: payload, key: "message"),
        priority: .message
      )
    default:
      return nil
    }
  }

  private static func responseItemUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard let itemType = string(in: payload, key: "type") else { return nil }
    switch itemType {
    case "message":
      return messageUpdate(payload)
    case "reasoning":
      return reasoningUpdate(payload)
    case "local_shell_call":
      return localShellUpdate(payload)
    case "function_call":
      return functionCallUpdate(payload)
    case "custom_tool_call":
      return customToolCallUpdate(payload)
    case "tool_search_call":
      return toolSearchUpdate(payload)
    case "web_search_call":
      return webSearchUpdate(payload)
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
    guard let text else { return nil }
    return plainDetailUpdate(text, priority: .message)
  }

  private static func reasoningUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    let summary = array(in: payload, key: "summary")?.compactMap { item in
      string(in: item, key: "text")
    }
    let content = array(in: payload, key: "content")?.compactMap { item in
      string(in: item, key: "text")
    }
    return thinkingDetailUpdate(
      summary?.first ?? content?.first,
      priority: .reasoning
    )
  }

  private static func localShellUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard
      let action = dictionary(in: payload, key: "action"),
      string(in: action, key: "type") == "exec"
    else {
      return plainDetailUpdate("Bash")
    }
    return labeledDetailUpdate(
      prefix: "Bash",
      text: commandText(from: arrayOfStrings(in: action, key: "command"))
    ) ?? plainDetailUpdate("Bash")
  }

  private static func functionCallUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard let name = normalizedDetail(string(in: payload, key: "name")) else {
      return plainDetailUpdate("Working...")
    }
    if name == "exec_command" {
      return plainDetailUpdate(execCommandDetail(arguments: string(in: payload, key: "arguments")) ?? "Working...")
    }
    return plainDetailUpdate(executingDetail(name: name) ?? "Working...")
  }

  private static func customToolCallUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard let name = normalizedDetail(string(in: payload, key: "name")) else {
      return plainDetailUpdate("Working...")
    }
    return plainDetailUpdate(executingDetail(name: name) ?? "Working...")
  }

  private static func toolSearchUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    let arguments = dictionary(in: payload, key: "arguments")
    let query = string(in: arguments, key: "query")
    if let query {
      return labeledDetailUpdate(prefix: "Search", text: query)
    }
    if let execution = string(in: payload, key: "execution"), execution != "search" {
      return labeledDetailUpdate(prefix: "Search", text: execution)
    }
    return plainDetailUpdate("Search")
  }

  private static func webSearchUpdate(_ payload: [String: Any]) -> CodexTranscriptUpdate? {
    guard let action = dictionary(in: payload, key: "action") else {
      return plainDetailUpdate("Web")
    }
    let detail: String?
    switch string(in: action, key: "type") {
    case "search":
      detail = string(in: action, key: "query") ?? arrayOfStrings(in: action, key: "queries")?.first
    case "open_page":
      detail = string(in: action, key: "url")
    case "find_in_page":
      let pattern = string(in: action, key: "pattern")
      let url = string(in: action, key: "url")
      detail =
        if let pattern, let url {
          "'\(pattern)' in \(url)"
        } else {
          pattern ?? url
        }
    default:
      detail = nil
    }
    return labeledDetailUpdate(prefix: "Web", text: detail) ?? plainDetailUpdate("Web")
  }

  private static func execCommandDetail(arguments: String?) -> String? {
    guard let argumentsObject = object(fromJSONString: arguments) else { return nil }
    return normalizedDetail(string(in: argumentsObject, key: "cmd"))
  }

  private static func executingDetail(name: String?) -> String? {
    guard let name = normalizedDetail(name) else { return nil }
    return "Executing \(name)"
  }

  private static func labeledDetailUpdate(
    prefix: String,
    text: String?,
    priority: CodexTranscriptDetailPriority = .tool
  ) -> CodexTranscriptUpdate? {
    guard let detail = labeledDetail(prefix: prefix, text: text) else { return nil }
    return .init(detail: detail, detailPriority: priority)
  }

  private static func plainDetailUpdate(
    _ detail: String?,
    priority: CodexTranscriptDetailPriority = .tool
  ) -> CodexTranscriptUpdate? {
    guard let detail = normalizedDetail(detail) else { return nil }
    return .init(detail: detail, detailPriority: priority)
  }

  private static func thinkingDetailUpdate(
    _ text: String?,
    priority: CodexTranscriptDetailPriority = .reasoning
  ) -> CodexTranscriptUpdate? {
    _ = text
    return .init(detail: "Thinking...", detailPriority: priority)
  }

  private static func labeledDetail(
    prefix: String,
    text: String?
  ) -> String? {
    guard let text = normalizedDetail(text) else { return nil }
    return "\(prefix) · \(text)"
  }

  private static func commandText(from command: [String]?) -> String? {
    guard let command, !command.isEmpty else { return nil }
    return normalizedDetail(command.joined(separator: " "))
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

  private static func object(fromJSONString string: String?) -> [String: Any]? {
    guard let string, let data = string.data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
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

  private static func arrayOfStrings(
    in object: [String: Any]?,
    key: String
  ) -> [String]? {
    (object?[key] as? [Any])?.compactMap { $0 as? String }
  }

  private static func string(
    in object: [String: Any]?,
    key: String
  ) -> String? {
    object?[key] as? String
  }
}
