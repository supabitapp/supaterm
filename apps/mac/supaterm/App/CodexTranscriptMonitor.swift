import Foundation

enum CodexTranscriptTurnStatus: Equatable {
  case started(String?)
  case completed(String?)
  case aborted(String?)
  case failed(String?)

  var startsNewTurn: Bool {
    switch self {
    case .started:
      true
    case .completed, .aborted, .failed:
      false
    }
  }

  var isFinal: Bool {
    switch self {
    case .started:
      false
    case .completed, .aborted, .failed:
      true
    }
  }
}

enum CodexTranscriptJSONValue: Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([Self])
  case object([String: Self])

  init?(_ value: Any) {
    switch value {
    case is NSNull:
      self = .null
    case let value as Bool:
      self = .bool(value)
    case let value as NSNumber:
      self = .number(value.doubleValue)
    case let value as String:
      self = .string(value)
    case let value as [Any]:
      self = .array(value.compactMap(Self.init))
    case let value as [String: Any]:
      self = .object(value.compactMapValues(Self.init))
    default:
      return nil
    }
  }

  var objectValue: [String: Self]? {
    guard case .object(let value) = self else { return nil }
    return value
  }

  var arrayValue: [Self]? {
    guard case .array(let value) = self else { return nil }
    return value
  }

  var stringValue: String? {
    guard case .string(let value) = self else { return nil }
    return value
  }

  var intValue: Int? {
    guard case .number(let value) = self else { return nil }
    return Int(exactly: value)
  }
}

typealias CodexTranscriptJSONObject = [String: CodexTranscriptJSONValue]

enum CodexRolloutRecord: Equatable {
  case sessionMeta(CodexTranscriptJSONObject)
  case turnContext(CodexTranscriptJSONObject)
  case eventMessage(type: String, payload: CodexTranscriptJSONObject)
  case responseItem(type: String, payload: CodexTranscriptJSONObject)
  case compacted(CodexTranscriptJSONObject)
  case unknown(type: String, payload: CodexTranscriptJSONValue)
}

enum CodexConversationTurnState: Equatable {
  case inProgress
  case completed
  case aborted
  case failed

  var isFinal: Bool {
    switch self {
    case .inProgress:
      false
    case .completed, .aborted, .failed:
      true
    }
  }
}

struct CodexConversationMessage: Equatable {
  let role: String
  let text: String
  let phase: String?
}

struct CodexConversationReasoning: Equatable {
  var summary: [String]
  var content: [String]
}

enum CodexConversationItem: Equatable {
  case message(CodexConversationMessage)
  case reasoning(CodexConversationReasoning)
  case operation(type: String, payload: CodexTranscriptJSONObject)
  case event(type: String, payload: CodexTranscriptJSONObject)
  case compaction(CodexTranscriptJSONObject)
}

struct CodexConversationTurn: Equatable {
  let id: String
  var status: CodexConversationTurnState
  var error: String?
  var items: [CodexConversationItem]
  var startedAt: String?
  var completedAt: String?
  var durationMs: Int?
  var lastAssistantDetail: String?
  var hoverMessages: [String] = []
}

struct CodexSidebarSnapshot: Equatable {
  var status: CodexTranscriptTurnStatus?
  var detail: String?
  var hoverMessages: [String]
}

struct CodexConversationState: Equatable {
  var sessionID: String?
  var records: [CodexRolloutRecord]
  var turns: [CodexConversationTurn]

  private var nextImplicitTurnIndex: Int
  private var turnIndexByID: [String: Int]
  private var activeTurnIndex: Int?

  init(
    sessionID: String? = nil,
    records: [CodexRolloutRecord] = [],
    turns: [CodexConversationTurn] = []
  ) {
    let turns = turns.map(Self.withDerivedMessageState)
    self.sessionID = sessionID
    self.records = records
    self.turns = turns
    nextImplicitTurnIndex = turns.count + 1
    turnIndexByID = Dictionary(uniqueKeysWithValues: turns.enumerated().map { ($1.id, $0) })
    activeTurnIndex = turns.lastIndex(where: { !$0.status.isFinal })
  }

  var activeTurn: CodexConversationTurn? {
    guard let activeTurnIndex else { return nil }
    return turns[activeTurnIndex]
  }

  var latestTurn: CodexConversationTurn? {
    turns.last
  }

  var activityStatus: CodexTranscriptTurnStatus? {
    if let activeTurn {
      return .started(activeTurn.id)
    }
    guard let latestTurn else { return nil }
    return latestTurn.transcriptStatus
  }

  var detail: String? {
    activeTurn?.lastAssistantDetail
  }

  var hoverMessages: [String] {
    let sourceTurn = activeTurn ?? latestTurn
    return sourceTurn?.hoverMessages ?? []
  }

  var sidebarSnapshot: CodexSidebarSnapshot {
    .init(
      status: activityStatus,
      detail: detail,
      hoverMessages: hoverMessages
    )
  }

  mutating func absorb(_ records: [CodexRolloutRecord]) {
    guard !records.isEmpty else { return }
    for record in records {
      self.records.append(record)
      apply(record)
    }
  }

  private mutating func apply(_ record: CodexRolloutRecord) {
    switch record {
    case .sessionMeta(let payload):
      if let id = payload["id"]?.stringValue {
        sessionID = id
      }
    case .turnContext(let payload):
      if let turnID = payload["turn_id"]?.stringValue {
        activeTurnIndex = ensureTurn(id: turnID)
      }
    case .eventMessage(let type, let payload):
      applyEvent(type: type, payload: payload)
    case .responseItem(let type, let payload):
      applyResponseItem(type: type, payload: payload)
    case .compacted(let payload):
      appendItem(.compaction(payload), preferredTurnID: nil)
    case .unknown:
      break
    }
  }

  private mutating func applyEvent(
    type: String,
    payload: CodexTranscriptJSONObject
  ) {
    let preferredTurnID = payload["turn_id"]?.stringValue
    switch type {
    case "task_started", "turn_started":
      applyTurnStarted(payload: payload, preferredTurnID: preferredTurnID)
    case "task_complete", "turn_complete":
      applyTurnCompleted(payload: payload, preferredTurnID: preferredTurnID)
    case "turn_aborted":
      applyTurnAborted(payload: payload, preferredTurnID: preferredTurnID)
    case "error":
      applyErrorEvent(payload: payload, preferredTurnID: preferredTurnID)
    default:
      applyContentEvent(type: type, payload: payload, preferredTurnID: preferredTurnID)
    }
  }

  private mutating func applyTurnStarted(
    payload: CodexTranscriptJSONObject,
    preferredTurnID: String?
  ) {
    let turnID = preferredTurnID ?? makeImplicitTurnID()
    let index = ensureTurn(id: turnID)
    turns[index].status = .inProgress
    turns[index].error = nil
    turns[index].startedAt = payload["started_at"]?.stringValue
    turns[index].durationMs = payload["duration_ms"]?.intValue
    activeTurnIndex = index
  }

  private mutating func applyTurnCompleted(
    payload: CodexTranscriptJSONObject,
    preferredTurnID: String?
  ) {
    guard let index = turnIndex(preferredTurnID: preferredTurnID) else {
      return
    }
    turns[index].status = turns[index].status == .failed ? .failed : .completed
    turns[index].completedAt = payload["completed_at"]?.stringValue
    turns[index].durationMs = payload["duration_ms"]?.intValue ?? turns[index].durationMs
    if let message = normalizedMessage(payload["last_agent_message"]?.stringValue) {
      appendAssistantMessage(
        message,
        phase: "final_answer",
        preferredTurnID: turns[index].id,
        replacingLastFinalMessage: true
      )
    }
    clearActiveTurnIfMatching(index: index)
  }

  private mutating func applyTurnAborted(
    payload: CodexTranscriptJSONObject,
    preferredTurnID: String?
  ) {
    guard let index = turnIndex(preferredTurnID: preferredTurnID) else {
      return
    }
    turns[index].status = .aborted
    turns[index].completedAt = payload["completed_at"]?.stringValue
    turns[index].durationMs = payload["duration_ms"]?.intValue ?? turns[index].durationMs
    clearActiveTurnIfMatching(index: index)
  }

  private mutating func applyErrorEvent(
    payload: CodexTranscriptJSONObject,
    preferredTurnID: String?
  ) {
    if let index = turnIndex(preferredTurnID: preferredTurnID) {
      turns[index].status = .failed
      turns[index].error = payload["message"]?.stringValue ?? turns[index].error
      if activeTurnIndex == index {
        activeTurnIndex = nil
      }
    }
    appendItem(.event(type: "error", payload: payload), preferredTurnID: preferredTurnID)
  }

  private mutating func applyContentEvent(
    type: String,
    payload: CodexTranscriptJSONObject,
    preferredTurnID: String?
  ) {
    switch type {
    case "user_message":
      if let message = normalizedMessage(payload["message"]?.stringValue) {
        appendItem(
          .message(.init(role: "user", text: message, phase: nil)),
          preferredTurnID: preferredTurnID
        )
      }
    case "agent_message":
      if let message = normalizedMessage(payload["message"]?.stringValue) {
        appendAssistantMessage(
          message,
          phase: payload["phase"]?.stringValue,
          preferredTurnID: preferredTurnID,
          replacingLastFinalMessage: false
        )
      }
    case "agent_reasoning":
      if let text = normalizedMessage(payload["text"]?.stringValue) {
        appendReasoning(
          summary: [text],
          content: [],
          preferredTurnID: preferredTurnID
        )
      }
    case "agent_reasoning_raw_content":
      if let text = normalizedMessage(payload["text"]?.stringValue) {
        appendReasoning(
          summary: [],
          content: [text],
          preferredTurnID: preferredTurnID
        )
      }
    default:
      appendItem(.event(type: type, payload: payload), preferredTurnID: preferredTurnID)
    }
  }

  private mutating func applyResponseItem(
    type: String,
    payload: CodexTranscriptJSONObject
  ) {
    let preferredTurnID = payload["turn_id"]?.stringValue
    switch type {
    case "message":
      let role = payload["role"]?.stringValue ?? "assistant"
      let text = messageText(from: payload["content"]?.arrayValue)
      guard let text else { return }
      if role == "assistant" {
        appendAssistantMessage(
          text,
          phase: payload["phase"]?.stringValue,
          preferredTurnID: preferredTurnID,
          replacingLastFinalMessage: false
        )
      } else {
        let item = CodexConversationItem.message(
          .init(role: role, text: text, phase: payload["phase"]?.stringValue)
        )
        appendItem(item, preferredTurnID: preferredTurnID)
      }
    case "reasoning":
      appendReasoning(
        summary: textArray(in: payload["summary"]?.arrayValue),
        content: textArray(in: payload["content"]?.arrayValue),
        preferredTurnID: preferredTurnID
      )
    case "compaction":
      appendItem(.compaction(payload), preferredTurnID: preferredTurnID)
    default:
      appendItem(.operation(type: type, payload: payload), preferredTurnID: preferredTurnID)
    }
  }

  private mutating func appendAssistantMessage(
    _ text: String,
    phase: String?,
    preferredTurnID: String?,
    replacingLastFinalMessage: Bool
  ) {
    guard let text = normalizedMessage(text) else { return }
    let index = ensureTurnForItem(preferredTurnID: preferredTurnID)
    if replacingLastFinalMessage,
      case .message(let existing)? = turns[index].items.last,
      existing.role == "assistant",
      existing.phase == "final_answer"
    {
      turns[index].items.removeLast()
      refreshDerivedMessageState(for: index)
    }
    let message = CodexConversationMessage(role: "assistant", text: text, phase: phase)
    turns[index].items.append(.message(message))
    updateDerivedMessageState(forAppended: message, at: index)
  }

  private mutating func appendReasoning(
    summary: [String],
    content: [String],
    preferredTurnID: String?
  ) {
    let normalizedSummary = summary.compactMap(normalizedMessage)
    let normalizedContent = content.compactMap(normalizedMessage)
    guard !normalizedSummary.isEmpty || !normalizedContent.isEmpty else { return }
    let index = ensureTurnForItem(preferredTurnID: preferredTurnID)
    if case .reasoning(var reasoning)? = turns[index].items.last {
      reasoning.summary.append(contentsOf: normalizedSummary)
      reasoning.content.append(contentsOf: normalizedContent)
      turns[index].items[turns[index].items.count - 1] = .reasoning(reasoning)
      return
    }
    turns[index].items.append(
      .reasoning(.init(summary: normalizedSummary, content: normalizedContent))
    )
  }

  private mutating func appendItem(
    _ item: CodexConversationItem,
    preferredTurnID: String?
  ) {
    let index = ensureTurnForItem(preferredTurnID: preferredTurnID)
    turns[index].items.append(item)
  }

  private mutating func ensureTurnForItem(
    preferredTurnID: String?
  ) -> Int {
    if let preferredTurnID {
      return ensureTurn(id: preferredTurnID)
    }
    if let activeTurnIndex {
      return activeTurnIndex
    }
    if let latestTurnIndex = turns.indices.last {
      return latestTurnIndex
    }
    let index = ensureTurn(id: makeImplicitTurnID())
    activeTurnIndex = index
    return index
  }

  @discardableResult
  private mutating func ensureTurn(
    id: String
  ) -> Int {
    if let index = turnIndexByID[id] {
      return index
    }
    let index = turns.count
    turns.append(
      .init(
        id: id,
        status: .inProgress,
        error: nil,
        items: [],
        startedAt: nil,
        completedAt: nil,
        durationMs: nil
      )
    )
    turnIndexByID[id] = index
    return index
  }

  private mutating func clearActiveTurnIfMatching(index: Int) {
    if activeTurnIndex == index {
      activeTurnIndex = nil
    }
  }

  private func turnIndex(
    preferredTurnID: String?
  ) -> Int? {
    if let preferredTurnID,
      let index = turnIndexByID[preferredTurnID]
    {
      return index
    }
    return activeTurnIndex ?? (turns.isEmpty ? nil : turns.count - 1)
  }

  private mutating func refreshDerivedMessageState(
    for index: Int
  ) {
    let state = Self.assistantMessageState(from: turns[index].items)
    turns[index].lastAssistantDetail = state.lastAssistantDetail
    turns[index].hoverMessages = state.hoverMessages
  }

  private mutating func updateDerivedMessageState(
    forAppended message: CodexConversationMessage,
    at index: Int
  ) {
    var state = AssistantMessageState(
      lastAssistantDetail: turns[index].lastAssistantDetail,
      hoverMessages: turns[index].hoverMessages
    )
    Self.reduceAssistantMessageState(&state, with: message)
    turns[index].lastAssistantDetail = state.lastAssistantDetail
    turns[index].hoverMessages = state.hoverMessages
  }

  private static func withDerivedMessageState(
    _ turn: CodexConversationTurn
  ) -> CodexConversationTurn {
    var turn = turn
    let state = assistantMessageState(from: turn.items)
    turn.lastAssistantDetail = state.lastAssistantDetail
    turn.hoverMessages = state.hoverMessages
    return turn
  }

  private static func assistantMessageState(
    from items: [CodexConversationItem]
  ) -> AssistantMessageState {
    var state = AssistantMessageState()
    for item in items {
      guard case .message(let message) = item, message.role == "assistant" else { continue }
      reduceAssistantMessageState(&state, with: message)
    }
    return state
  }

  private static func reduceAssistantMessageState(
    _ state: inout AssistantMessageState,
    with message: CodexConversationMessage
  ) {
    state.lastAssistantDetail =
      message.phase == "final_answer"
      ? nil
      : normalizedDetail(message.text)
    guard let normalized = normalizedMessage(message.text) else {
      return
    }
    if message.phase == "final_answer" {
      state.hoverMessages = [normalized]
      return
    }
    guard state.hoverMessages.last != normalized else {
      return
    }
    state.hoverMessages.append(normalized)
  }

  private mutating func makeImplicitTurnID() -> String {
    let id = "implicit-turn-\(nextImplicitTurnIndex)"
    nextImplicitTurnIndex += 1
    return id
  }
}

private struct AssistantMessageState: Equatable {
  var lastAssistantDetail: String?
  var hoverMessages: [String] = []
}

extension CodexConversationTurn {
  fileprivate var transcriptStatus: CodexTranscriptTurnStatus {
    switch status {
    case .inProgress:
      return .started(id)
    case .completed:
      return .completed(id)
    case .aborted:
      return .aborted(id)
    case .failed:
      return .failed(id)
    }
  }
}

struct CodexTranscriptBatch {
  var records: [CodexRolloutRecord]

  var isEmpty: Bool {
    records.isEmpty
  }
}

struct CodexTranscriptCursor {
  var offset: UInt64
}

enum CodexTranscriptMonitor {
  static func start(
    at path: String
  ) -> (CodexTranscriptCursor, CodexTranscriptBatch?)? {
    guard let data = read(path: path, from: 0) else { return nil }
    let (consumedBytes, batch) = parse(data)
    return (CodexTranscriptCursor(offset: UInt64(consumedBytes)), batch)
  }

  static func advance(
    _ cursor: CodexTranscriptCursor,
    at path: String
  ) -> (CodexTranscriptCursor, CodexTranscriptBatch?)? {
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
    let (consumedBytes, batch) = parse(data)
    var updatedCursor = cursor
    updatedCursor.offset += UInt64(consumedBytes)
    return (updatedCursor, batch)
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

  private static func parse(_ data: Data) -> (Int, CodexTranscriptBatch?) {
    guard let newlineIndex = data.lastIndex(of: 0x0A) else {
      return (0, nil)
    }
    let completeData = data.prefix(through: newlineIndex)
    let records = completeData.split(separator: 0x0A).compactMap { line in
      record(in: Data(line))
    }
    let batch = records.isEmpty ? nil : CodexTranscriptBatch(records: records)
    return (completeData.count, batch)
  }

  private static func record(in line: Data) -> CodexRolloutRecord? {
    guard
      let rawObject = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
      let object = CodexTranscriptJSONValue(rawObject)?.objectValue,
      let lineType = object["type"]?.stringValue
    else {
      return nil
    }
    let payload = object["payload"] ?? .null
    switch lineType {
    case "session_meta":
      guard let payload = payload.objectValue else { return .unknown(type: lineType, payload: payload) }
      return .sessionMeta(payload)
    case "turn_context":
      guard let payload = payload.objectValue else { return .unknown(type: lineType, payload: payload) }
      return .turnContext(payload)
    case "event_msg":
      guard
        let payloadObject = payload.objectValue,
        let eventType = payloadObject["type"]?.stringValue
      else {
        return .unknown(type: lineType, payload: payload)
      }
      let eventPayload = payloadObject["payload"]?.objectValue ?? payloadObject
      return .eventMessage(type: eventType, payload: eventPayload)
    case "response_item":
      guard
        let payloadObject = payload.objectValue,
        let itemType = payloadObject["type"]?.stringValue
      else {
        return .unknown(type: lineType, payload: payload)
      }
      return .responseItem(type: itemType, payload: payloadObject)
    case "compacted":
      guard let payload = payload.objectValue else { return .unknown(type: lineType, payload: payload) }
      return .compacted(payload)
    default:
      return .unknown(type: lineType, payload: payload)
    }
  }
}

private func messageText(
  from content: [CodexTranscriptJSONValue]?
) -> String? {
  guard let content else { return nil }
  return normalizedMessage(
    content
      .compactMap { item in
        item.objectValue?["text"]?.stringValue
      }
      .joined(separator: " ")
  )
}

private func textArray(
  in values: [CodexTranscriptJSONValue]?
) -> [String] {
  guard let values else { return [] }
  return values.compactMap { value in
    if let text = value.objectValue?["text"]?.stringValue {
      return normalizedMessage(text)
    }
    return normalizedMessage(value.stringValue)
  }
}

private func normalizedDetail(_ text: String?) -> String? {
  guard let normalized = normalizedMessage(text) else { return nil }
  if normalized.count <= 160 {
    return normalized
  }
  return String(normalized.prefix(157)) + "..."
}

private func normalizedMessage(_ text: String?) -> String? {
  guard let text else { return nil }
  let normalized =
    text
    .components(separatedBy: .whitespacesAndNewlines)
    .filter { !$0.isEmpty }
    .joined(separator: " ")
  guard !normalized.isEmpty else { return nil }
  return normalized
}
