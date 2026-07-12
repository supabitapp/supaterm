import Foundation

struct AgentMonitorSnapshot: Equatable {
  var status: AgentTurnStatus?
  var detail: String?
  var hoverMessages: [String] = []
  var progressRows: [PaneAgentProgressRow] = []
}

nonisolated struct AgentTranscriptUpdate: Sendable {
  let objects: [JSONObject]
  let didReset: Bool

  init(_ tick: AgentTranscriptTailer.Tick) {
    objects = tick.objects
    didReset = tick.didReset
  }

  init(objects: [JSONObject], didReset: Bool = false) {
    self.objects = objects
    self.didReset = didReset
  }
}

@MainActor
protocol AgentPanelMonitor {
  func consume(_ update: AgentTranscriptUpdate) -> AgentMonitorSnapshot?
}

enum AgentProgressParsing {
  static func normalizedTitle(_ text: String?) -> String? {
    guard let text else { return nil }
    let normalized =
      text
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    guard !normalized.isEmpty else { return nil }
    return normalized
  }

  static func status(_ rawValue: String?) -> PaneAgentProgressRow.Status {
    let value = rawValue?.trimmingCharacters(in: .whitespacesAndNewlines)
    switch value {
    case "inProgress":
      return .running
    default:
      break
    }
    switch value?.lowercased() {
    case "completed", "complete", "done":
      return .completed
    case "in_progress", "in-progress", "running", "active":
      return .running
    default:
      return .pending
    }
  }
}
