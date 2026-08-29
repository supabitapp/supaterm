import Foundation
import SupatermCLIShared

enum AgentHookCommandOwnership {
  static func isSupatermManagedCommand(_ command: String?) -> Bool {
    guard let command else {
      return false
    }
    let normalizedCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
    return SupatermAgentKind.allCases.contains {
      SupatermManagedHookCommand.matchesReceiveHookCommand(normalizedCommand, for: $0)
    }
  }
}
