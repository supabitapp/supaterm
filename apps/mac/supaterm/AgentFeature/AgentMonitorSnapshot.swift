import Foundation
import SupatermTerminalAgentPanelFeature

public struct AgentMonitorSnapshot: Equatable {
  public var status: AgentTurnStatus?
  public var detail: String?
  public var hoverMessages: [String] = []
  public var progressRows: [PaneAgentProgressRow] = []
}

struct AgentPanelMonitorTick {
  let snapshot: AgentMonitorSnapshot
  let isFinal: Bool
}

@MainActor
protocol AgentPanelMonitor {
  func start() -> AgentPanelMonitorTick?
  func poll() -> AgentPanelMonitorTick?
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
