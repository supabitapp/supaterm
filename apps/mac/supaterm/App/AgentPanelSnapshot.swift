import Foundation

struct AgentPanelSnapshot: Equatable {
  var progressRows: [PaneAgentProgressRow] = []
  var sources: [PaneAgentSource] = []
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
