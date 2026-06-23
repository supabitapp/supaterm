import Foundation
import SupatermCLIShared
import SupatermTerminalAgentPanelFeature

extension CodexConversationState {
  mutating func updateStructuredPanelState(
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

  mutating func updateGoalState(
    forAppended item: CodexConversationItem,
    at index: Int
  ) {
    guard let row = Self.goalProgressRow(from: item) else { return }
    turns[index].goalRow = row
  }

  static func structuredProgressRows(
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

  static func structuredGoalRow(
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

  static func goalProgressRow(from item: CodexConversationItem) -> PaneAgentProgressRow? {
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
}
