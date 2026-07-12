import Foundation
import SupatermCLIShared

enum AgentTurnStatus: Equatable {
  case started(String?)
  case completed(String?)
  case aborted(String?)
  case failed(String?)
}

private enum CodexTranscriptEvent {
  case assistantMessage(turnID: String?, text: String, phase: String?)
  case goalContext(String)
  case goalUpdated(JSONObject)
  case turnAborted(String?)
  case turnCompleted(turnID: String?, message: String?)
  case turnContext(String)
  case turnFailed(String?)
  case turnStarted(String?)
}

private enum CodexTranscriptTurnState {
  case aborted
  case completed
  case failed
  case inProgress
}

private struct CodexTranscriptTurn {
  let id: String
  var status = CodexTranscriptTurnState.inProgress
  var detail: String?
  var hoverMessages: [String] = []

  var transcriptStatus: AgentTurnStatus {
    switch status {
    case .aborted:
      .aborted(id)
    case .completed:
      .completed(id)
    case .failed:
      .failed(id)
    case .inProgress:
      .started(id)
    }
  }
}

private struct CodexTranscriptProjection {
  private static let maximumHoverMessageCount = 8
  private static let maximumHoverMessageLength = 16_000
  private static let maximumTurnCount = 8

  private var activeTurnID: String?
  private var goalRow: PaneAgentProgressRow?
  private var nextImplicitTurnIndex = 1
  private var turns: [CodexTranscriptTurn] = []

  var sidebarSnapshot: AgentMonitorSnapshot {
    AgentMonitorSnapshot(
      status: activityStatus,
      detail: activeTurn?.detail,
      hoverMessages: (activeTurn ?? turns.last)?.hoverMessages ?? [],
      progressRows: progressRows
    )
  }

  mutating func absorb(_ events: [CodexTranscriptEvent]) {
    for event in events {
      apply(event)
    }
  }

  private var activeTurn: CodexTranscriptTurn? {
    guard let activeTurnID else { return nil }
    return turns.first { $0.id == activeTurnID }
  }

  private var activityStatus: AgentTurnStatus? {
    if let activeTurn {
      return .started(activeTurn.id)
    }
    return turns.last?.transcriptStatus
  }

  private var progressRows: [PaneAgentProgressRow] {
    guard let goalRow, goalRow.status != .completed else { return [] }
    return [goalRow]
  }

  private mutating func apply(_ event: CodexTranscriptEvent) {
    switch event {
    case .assistantMessage(let turnID, let text, let phase):
      updateAssistantMessage(text, phase: phase, turnID: turnID)
    case .goalContext(let text):
      if let row = Self.goalProgressRow(fromGoalContext: text) {
        goalRow = row
      }
    case .goalUpdated(let goal):
      if let row = Self.goalProgressRow(from: goal) {
        goalRow = row
      }
    case .turnAborted(let turnID):
      finishTurn(turnID, status: .aborted)
    case .turnCompleted(let turnID, let message):
      completeTurn(turnID, message: message)
    case .turnContext(let turnID):
      _ = ensureTurn(id: turnID)
      activeTurnID = turnID
    case .turnFailed(let turnID):
      finishTurn(turnID, status: .failed)
    case .turnStarted(let turnID):
      startTurn(turnID)
    }
  }

  private mutating func startTurn(_ preferredTurnID: String?) {
    let turnID = preferredTurnID ?? makeImplicitTurnID()
    let index = ensureTurn(id: turnID)
    turns[index].status = .inProgress
    activeTurnID = turnID
  }

  private mutating func completeTurn(_ preferredTurnID: String?, message: String?) {
    guard let index = turnIndex(preferredTurnID) else { return }
    if turns[index].status != .failed {
      turns[index].status = .completed
    }
    if let message {
      updateAssistantMessage(message, phase: "final_answer", at: index)
    }
    clearActiveTurnIfMatching(turns[index].id)
  }

  private mutating func finishTurn(
    _ preferredTurnID: String?,
    status: CodexTranscriptTurnState
  ) {
    guard let index = turnIndex(preferredTurnID) else { return }
    turns[index].status = status
    clearActiveTurnIfMatching(turns[index].id)
  }

  private mutating func updateAssistantMessage(
    _ text: String,
    phase: String?,
    turnID: String?
  ) {
    let index = ensureTurnForMessage(preferredTurnID: turnID)
    updateAssistantMessage(text, phase: phase, at: index)
  }

  private mutating func updateAssistantMessage(
    _ text: String,
    phase: String?,
    at index: Int
  ) {
    guard let message = Self.boundedHoverMessage(text) else { return }
    turns[index].detail = phase == "final_answer" ? nil : normalizedDetail(message)
    if phase == "final_answer" {
      turns[index].hoverMessages = [message]
      return
    }
    guard turns[index].hoverMessages.last != message else { return }
    turns[index].hoverMessages.append(message)
    if turns[index].hoverMessages.count > Self.maximumHoverMessageCount {
      turns[index].hoverMessages.removeFirst(
        turns[index].hoverMessages.count - Self.maximumHoverMessageCount
      )
    }
  }

  private mutating func ensureTurnForMessage(preferredTurnID: String?) -> Int {
    if let preferredTurnID {
      return ensureTurn(id: preferredTurnID)
    }
    if let activeTurnID,
      let index = turns.firstIndex(where: { $0.id == activeTurnID })
    {
      return index
    }
    if let index = turns.indices.last {
      return index
    }
    let turnID = makeImplicitTurnID()
    activeTurnID = turnID
    return ensureTurn(id: turnID)
  }

  private mutating func ensureTurn(id: String) -> Int {
    if let index = turns.firstIndex(where: { $0.id == id }) {
      return index
    }
    turns.append(CodexTranscriptTurn(id: id))
    if turns.count > Self.maximumTurnCount {
      let removedTurnIDs = Set(
        turns.prefix(turns.count - Self.maximumTurnCount).map(\.id)
      )
      turns.removeFirst(turns.count - Self.maximumTurnCount)
      if let activeTurnID, removedTurnIDs.contains(activeTurnID) {
        self.activeTurnID = nil
      }
    }
    return turns.index(before: turns.endIndex)
  }

  private func turnIndex(_ preferredTurnID: String?) -> Int? {
    if let preferredTurnID,
      let index = turns.firstIndex(where: { $0.id == preferredTurnID })
    {
      return index
    }
    if let activeTurnID,
      let index = turns.firstIndex(where: { $0.id == activeTurnID })
    {
      return index
    }
    return turns.indices.last
  }

  private mutating func clearActiveTurnIfMatching(_ turnID: String) {
    if activeTurnID == turnID {
      activeTurnID = nil
    }
  }

  private mutating func makeImplicitTurnID() -> String {
    let id = "implicit-turn-\(nextImplicitTurnIndex)"
    nextImplicitTurnIndex += 1
    return id
  }

  private static func boundedHoverMessage(_ text: String) -> String? {
    guard let message = normalizedMessage(text) else { return nil }
    guard message.count > maximumHoverMessageLength else { return message }
    return String(message.prefix(maximumHoverMessageLength - 3)) + "..."
  }

  private static func goalProgressRow(from goal: JSONObject) -> PaneAgentProgressRow? {
    guard let objective = AgentProgressParsing.normalizedTitle(goal["objective"]?.stringValue) else {
      return nil
    }
    let statusValue = goal["status"]?.stringValue
    return PaneAgentProgressRow(
      id: "goal:\(objective)",
      title: goalTitle(statusValue: statusValue, objective: objective),
      status: goalStatus(statusValue),
      kind: .goal
    )
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
      status: .running,
      kind: .goal
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
      .completed
    case "active":
      .running
    default:
      .pending
    }
  }

  private static func goalTitle(statusValue: String?, objective: String) -> String {
    switch statusValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "blocked":
      "Goal blocked: \(objective)"
    case "budgetlimited", "budget_limited", "budget-limited":
      "Goal budget reached: \(objective)"
    case "usagelimited", "usage_limited", "usage-limited":
      "Goal usage limited: \(objective)"
    case "paused":
      "Goal paused: \(objective)"
    default:
      "Goal: \(objective)"
    }
  }
}

@MainActor
final class CodexPanelMonitor: AgentPanelMonitor {
  private var currentSnapshot: AgentMonitorSnapshot?
  private var projection = CodexTranscriptProjection()

  func consume(_ update: AgentTranscriptUpdate) -> AgentMonitorSnapshot? {
    if update.didReset {
      projection = CodexTranscriptProjection()
    }
    let events = CodexTranscriptParser.events(from: update.objects)
    guard update.didReset || !events.isEmpty else { return nil }
    projection.absorb(events)
    let snapshot = projection.sidebarSnapshot
    guard snapshot != currentSnapshot else { return nil }
    currentSnapshot = snapshot
    return snapshot
  }
}

private enum CodexTranscriptParser {
  static func events(from objects: [JSONObject]) -> [CodexTranscriptEvent] {
    objects.compactMap(event(from:))
  }

  private static func event(from object: JSONObject) -> CodexTranscriptEvent? {
    guard let lineType = object["type"]?.stringValue,
      let payload = object["payload"]?.objectValue
    else {
      return nil
    }
    switch lineType {
    case "turn_context":
      return payload["turn_id"]?.stringValue.map(CodexTranscriptEvent.turnContext)
    case "event_msg":
      return eventMessage(from: payload)
    case "response_item":
      return responseItem(from: payload)
    default:
      return nil
    }
  }

  private static func eventMessage(from object: JSONObject) -> CodexTranscriptEvent? {
    guard let type = object["type"]?.stringValue else { return nil }
    let payload = object["payload"]?.objectValue ?? object
    let turnID = payload["turn_id"]?.stringValue ?? payload["turnId"]?.stringValue
    switch type {
    case "task_started", "turn_started":
      return .turnStarted(turnID)
    case "task_complete", "turn_complete":
      return .turnCompleted(
        turnID: turnID,
        message: payload["last_agent_message"]?.stringValue
      )
    case "turn_aborted":
      return .turnAborted(turnID)
    case "token_count":
      guard usageLimitWasReached(payload) else { return nil }
      return .turnFailed(turnID)
    case "thread_goal_updated":
      return payload["goal"]?.objectValue.map(CodexTranscriptEvent.goalUpdated)
    case "user_message":
      return payload["message"]?.stringValue.map(CodexTranscriptEvent.goalContext)
    case "agent_message":
      guard let text = payload["message"]?.stringValue else { return nil }
      return .assistantMessage(
        turnID: turnID,
        text: text,
        phase: payload["phase"]?.stringValue
      )
    default:
      return nil
    }
  }

  private static func usageLimitWasReached(_ payload: JSONObject) -> Bool {
    guard payload["info"] == .null,
      let rateLimits = payload["rate_limits"]?.objectValue
    else {
      return false
    }
    if let reachedType = rateLimits["rate_limit_reached_type"], reachedType != .null {
      return true
    }
    return ["primary", "secondary"].contains { key in
      guard let window = rateLimits[key]?.objectValue else { return false }
      return (window["used_percent"]?.intValue ?? 0) >= 100
    }
  }

  private static func responseItem(from payload: JSONObject) -> CodexTranscriptEvent? {
    guard payload["type"]?.stringValue == "message",
      let text = messageText(from: payload["content"]?.arrayValue)
    else {
      return nil
    }
    let role = payload["role"]?.stringValue ?? "assistant"
    if role == "user" {
      return .goalContext(text)
    }
    guard role == "assistant" else { return nil }
    return .assistantMessage(
      turnID: payload["turn_id"]?.stringValue,
      text: text,
      phase: payload["phase"]?.stringValue
    )
  }
}

private func messageText(from content: [JSONValue]?) -> String? {
  guard let content else { return nil }
  return normalizedMessage(
    content.compactMap { $0.objectValue?["text"]?.stringValue }.joined(separator: " ")
  )
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
