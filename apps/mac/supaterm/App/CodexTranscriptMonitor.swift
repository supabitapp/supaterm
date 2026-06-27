import Foundation
import SupatermCLIShared

enum AgentTurnStatus: Equatable {
  case started(String?)
  case completed(String?)
  case aborted(String?)
  case failed(String?)

  var isFinal: Bool {
    switch self {
    case .started:
      false
    case .completed, .aborted, .failed:
      true
    }
  }
}

enum CodexRolloutRecord: Equatable {
  case sessionMeta(JSONObject)
  case turnContext(JSONObject)
  case eventMessage(type: String, payload: JSONObject)
  case responseItem(type: String, payload: JSONObject)
  case compacted(JSONObject)
  case unknown(type: String, payload: JSONValue)
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
  case operation(type: String, payload: JSONObject)
  case event(type: String, payload: JSONObject)
  case compaction(JSONObject)
}

struct CodexConversationTurn: Equatable {
  let id: String
  var status: CodexConversationTurnState
  var error: String?
  var items: [CodexConversationItem]
  var durationMs: Int?
  var lastAssistantDetail: String?
  var hoverMessages: [String] = []
  var progressRows: [PaneAgentProgressRow] = []
  var goalRow: PaneAgentProgressRow?
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

  var activityStatus: AgentTurnStatus? {
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

  var progressRows: [PaneAgentProgressRow] {
    (activeTurn ?? latestTurn)?.displayedProgressRows(fallbackGoalRow: activeGoalRow) ?? []
  }

  var conversationTimeline: [PaneAgentConversationTimelineItem] {
    Self.conversationTimelineItems(from: turns)
  }

  private var activeGoalRow: PaneAgentProgressRow? {
    guard let row = turns.reversed().compactMap(\.goalRow).first else { return nil }
    return row.status == .completed ? nil : row
  }

  var sidebarSnapshot: AgentMonitorSnapshot {
    AgentMonitorSnapshot(
      status: activityStatus,
      detail: detail,
      hoverMessages: hoverMessages,
      progressRows: progressRows,
      conversationTimeline: conversationTimeline
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
    payload: JSONObject
  ) {
    let preferredTurnID = payload["turn_id"]?.stringValue ?? payload["turnId"]?.stringValue
    switch type {
    case "task_started", "turn_started":
      applyTurnStarted(payload: payload, preferredTurnID: preferredTurnID)
    case "task_complete", "turn_complete":
      applyTurnCompleted(payload: payload, preferredTurnID: preferredTurnID)
    case "turn_aborted":
      applyTurnAborted(payload: payload, preferredTurnID: preferredTurnID)
    case "error":
      applyErrorEvent(payload: payload, preferredTurnID: preferredTurnID)
    case "thread_goal_updated":
      applyGoalUpdated(payload: payload, preferredTurnID: preferredTurnID)
    default:
      applyContentEvent(type: type, payload: payload, preferredTurnID: preferredTurnID)
    }
  }

  private mutating func applyTurnStarted(
    payload: JSONObject,
    preferredTurnID: String?
  ) {
    let turnID = preferredTurnID ?? makeImplicitTurnID()
    let index = ensureTurn(id: turnID)
    turns[index].status = .inProgress
    turns[index].error = nil
    turns[index].durationMs = payload["duration_ms"]?.intValue
    activeTurnIndex = index
  }

  private mutating func applyTurnCompleted(
    payload: JSONObject,
    preferredTurnID: String?
  ) {
    guard let index = turnIndex(preferredTurnID: preferredTurnID) else {
      return
    }
    turns[index].status = turns[index].status == .failed ? .failed : .completed
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
    payload: JSONObject,
    preferredTurnID: String?
  ) {
    guard let index = turnIndex(preferredTurnID: preferredTurnID) else {
      return
    }
    turns[index].status = .aborted
    turns[index].durationMs = payload["duration_ms"]?.intValue ?? turns[index].durationMs
    clearActiveTurnIfMatching(index: index)
  }

  private mutating func applyErrorEvent(
    payload: JSONObject,
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

  private mutating func applyGoalUpdated(
    payload: JSONObject,
    preferredTurnID: String?
  ) {
    guard let row = Self.goalProgressRow(from: payload["goal"]?.objectValue) else {
      appendItem(.event(type: "thread_goal_updated", payload: payload), preferredTurnID: preferredTurnID)
      return
    }
    let index = ensureTurnForItem(preferredTurnID: preferredTurnID)
    turns[index].items.append(.event(type: "thread_goal_updated", payload: payload))
    turns[index].goalRow = row
  }

  private mutating func applyContentEvent(
    type: String,
    payload: JSONObject,
    preferredTurnID: String?
  ) {
    switch type {
    case "user_message":
      if let message = normalizedMessage(payload["message"]?.stringValue) {
        appendItem(
          .message(CodexConversationMessage(role: "user", text: message, phase: nil)),
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
    payload: JSONObject
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
        appendItem(
          .message(CodexConversationMessage(role: role, text: text, phase: payload["phase"]?.stringValue)),
          preferredTurnID: preferredTurnID
        )
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
      appendOperation(type: type, payload: payload, preferredTurnID: preferredTurnID)
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
      .reasoning(CodexConversationReasoning(summary: normalizedSummary, content: normalizedContent))
    )
  }

  private mutating func appendItem(
    _ item: CodexConversationItem,
    preferredTurnID: String?
  ) {
    let index = ensureTurnForItem(preferredTurnID: preferredTurnID)
    turns[index].items.append(item)
    updateGoalState(forAppended: item, at: index)
  }

  private mutating func appendOperation(
    type: String,
    payload: JSONObject,
    preferredTurnID: String?
  ) {
    let index = ensureTurnForItem(preferredTurnID: preferredTurnID)
    let operation = CodexConversationItem.operation(type: type, payload: payload)
    turns[index].items.append(operation)
    updateStructuredPanelState(forAppended: operation, at: index)
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
      CodexConversationTurn(
        id: id,
        status: .inProgress,
        error: nil,
        items: [],
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
    turns[index].progressRows = Self.structuredProgressRows(from: turns[index].items)
    turns[index].goalRow = Self.structuredGoalRow(from: turns[index].items)
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
    turn.progressRows = structuredProgressRows(from: turn.items)
    turn.goalRow = structuredGoalRow(from: turn.items)
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

  private static func conversationTimelineItems(
    from turns: [CodexConversationTurn]
  ) -> [PaneAgentConversationTimelineItem] {
    var occurrences: [String: Int] = [:]
    var items: [PaneAgentConversationTimelineItem] = []
    for turn in turns {
      for (index, item) in turn.items.enumerated() {
        guard case .message(let message) = item,
          let role = PaneAgentConversationTimelineRole(rawValue: message.role),
          !message.text.contains("<codex_internal_context"),
          let needle = PaneAgentConversationTimelineItem.matchNeedle(message.text)
        else {
          continue
        }
        let occurrence = occurrences[needle, default: 0]
        occurrences[needle] = occurrence + 1
        if let item = PaneAgentConversationTimelineItem(
          id: "codex:\(turn.id):\(index):\(role.rawValue)",
          role: role,
          text: message.text,
          occurrence: occurrence
        ) {
          items.append(item)
        }
      }
    }
    return items
  }

  private mutating func updateStructuredPanelState(
    forAppended item: CodexConversationItem,
    at index: Int
  ) {
    guard case .operation(let type, let payload) = item,
      let rows = Self.progressRows(operationType: type, payload: payload)
    else {
      return
    }
    turns[index].progressRows = rows
  }

  private mutating func updateGoalState(
    forAppended item: CodexConversationItem,
    at index: Int
  ) {
    guard let row = Self.goalProgressRow(from: item) else { return }
    turns[index].goalRow = row
  }

  private static func structuredProgressRows(
    from items: [CodexConversationItem]
  ) -> [PaneAgentProgressRow] {
    var rows: [PaneAgentProgressRow] = []
    for item in items {
      guard case .operation(let type, let payload) = item,
        let nextRows = progressRows(operationType: type, payload: payload)
      else {
        continue
      }
      rows = nextRows
    }
    return rows
  }

  private static func structuredGoalRow(
    from items: [CodexConversationItem]
  ) -> PaneAgentProgressRow? {
    var row: PaneAgentProgressRow?
    for item in items {
      if let nextRow = goalProgressRow(from: item) {
        row = nextRow
      }
    }
    return row
  }

  static func progressRows(
    operationType: String,
    payload: JSONObject
  ) -> [PaneAgentProgressRow]? {
    guard operationType == "function_call",
      payload["name"]?.stringValue == "update_plan",
      let arguments = payload["arguments"]?.stringValue,
      let object = (try? JSONDecoder().decode(JSONValue.self, from: Data(arguments.utf8)))?
        .objectValue,
      let plan = object["plan"]?.arrayValue
    else {
      return nil
    }
    let rows: [PaneAgentProgressRow] = plan.enumerated().compactMap { index, value in
      guard let item = value.objectValue,
        let title = AgentProgressParsing.normalizedTitle(item["step"]?.stringValue)
      else {
        return nil
      }
      return PaneAgentProgressRow(
        id: "\(index):\(title)",
        title: title,
        status: AgentProgressParsing.status(item["status"]?.stringValue)
      )
    }
    return rows
  }

  static func goalProgressRow(
    from goal: JSONObject?
  ) -> PaneAgentProgressRow? {
    guard let goal,
      let objective = AgentProgressParsing.normalizedTitle(goal["objective"]?.stringValue)
    else {
      return nil
    }
    let statusValue = goal["status"]?.stringValue
    let status = goalStatus(statusValue)
    let title = goalTitle(statusValue: statusValue, objective: objective)
    return PaneAgentProgressRow(
      id: "goal:\(objective)",
      title: title,
      status: status
    )
  }

  private static func goalProgressRow(from item: CodexConversationItem) -> PaneAgentProgressRow? {
    switch item {
    case .event(let type, let payload) where type == "thread_goal_updated":
      return goalProgressRow(from: payload["goal"]?.objectValue)
    case .message(let message) where message.role == "user":
      return goalProgressRow(fromGoalContext: message.text)
    default:
      return nil
    }
  }

  private static func goalProgressRow(fromGoalContext text: String) -> PaneAgentProgressRow? {
    guard text.contains(#"<codex_internal_context source="goal">"#),
      let objective = goalObjective(from: text)
    else {
      return nil
    }
    return PaneAgentProgressRow(
      id: "goal:\(objective)",
      title: "Goal: \(objective)",
      status: .running
    )
  }

  private static func goalObjective(from text: String) -> String? {
    guard let start = text.range(of: "<objective>"),
      let end = text.range(of: "</objective>", range: start.upperBound..<text.endIndex)
    else {
      return nil
    }
    return AgentProgressParsing.normalizedTitle(String(text[start.upperBound..<end.lowerBound]))
  }

  private static func goalStatus(_ rawValue: String?) -> PaneAgentProgressRow.Status {
    switch rawValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "complete", "completed":
      return .completed
    case "active":
      return .running
    default:
      return .pending
    }
  }

  private static func goalTitle(
    statusValue: String?,
    objective: String
  ) -> String {
    switch statusValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "blocked":
      return "Goal blocked: \(objective)"
    case "budgetlimited", "budget_limited", "budget-limited":
      return "Goal budget reached: \(objective)"
    case "usagelimited", "usage_limited", "usage-limited":
      return "Goal usage limited: \(objective)"
    case "paused":
      return "Goal paused: \(objective)"
    default:
      return "Goal: \(objective)"
    }
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
  fileprivate func displayedProgressRows(
    fallbackGoalRow: PaneAgentProgressRow?
  ) -> [PaneAgentProgressRow] {
    switch status {
    case .completed:
      return []
    case .inProgress, .aborted, .failed:
      if let row = goalRow ?? fallbackGoalRow {
        return [row] + progressRows
      }
      return progressRows
    }
  }

  fileprivate var transcriptStatus: AgentTurnStatus {
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

@MainActor
final class CodexPanelMonitor: AgentPanelMonitor {
  private let transcriptPath: String
  private var cursor: AgentTranscriptTailCursor
  private var conversation = CodexConversationState()

  init?(transcriptPath: String) {
    guard let (cursor, batch) = CodexTranscriptMonitor.start(at: transcriptPath) else {
      return nil
    }
    self.transcriptPath = transcriptPath
    self.cursor = cursor
    if let batch {
      conversation.absorb(batch.records)
    }
  }

  func start() -> AgentPanelMonitorTick? {
    let snapshot = conversation.sidebarSnapshot
    guard snapshot.status?.isFinal == false else { return nil }
    return AgentPanelMonitorTick(snapshot: snapshot, isFinal: false)
  }

  func poll() -> AgentPanelMonitorTick? {
    guard let result = CodexTranscriptMonitor.advance(cursor, at: transcriptPath) else {
      return nil
    }
    cursor = result.cursor
    guard let batch = result.batch, !batch.isEmpty else { return nil }
    if result.didReset {
      conversation = CodexConversationState()
    }
    conversation.absorb(batch.records)
    let snapshot = conversation.sidebarSnapshot
    guard let status = snapshot.status else { return nil }
    return AgentPanelMonitorTick(snapshot: snapshot, isFinal: status.isFinal)
  }
}

enum CodexTranscriptMonitor {
  struct Advance {
    let cursor: AgentTranscriptTailCursor
    let batch: CodexTranscriptBatch?
    let didReset: Bool
  }

  static func start(
    at path: String
  ) -> (AgentTranscriptTailCursor, CodexTranscriptBatch?)? {
    guard let tick = AgentTranscriptTailer.start(at: path) else { return nil }
    return (tick.cursor, batch(from: tick.objects))
  }

  static func advance(
    _ cursor: AgentTranscriptTailCursor,
    at path: String
  ) -> Advance? {
    guard let tick = AgentTranscriptTailer.advance(cursor, at: path) else { return nil }
    return Advance(cursor: tick.cursor, batch: batch(from: tick.objects), didReset: tick.didReset)
  }

  private static func batch(from objects: [JSONObject]) -> CodexTranscriptBatch? {
    let records = objects.compactMap(record(from:))
    return records.isEmpty ? nil : CodexTranscriptBatch(records: records)
  }

  private static func record(from object: JSONObject) -> CodexRolloutRecord? {
    guard let lineType = object["type"]?.stringValue else {
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
  from content: [JSONValue]?
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
  in values: [JSONValue]?
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
  AgentProgressParsing.normalizedTitle(text)
}
