import Foundation
import SupatermCLIShared

enum AgentHookCommandOwnership {
  static func isSupatermManagedCommand(_ command: String?) -> Bool {
    guard let command else {
      return false
    }
    let normalizedCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
    return SupatermManagedAgentKind.allCases.contains {
      normalizedCommand == SupatermManagedHookCommand.receiveHookCommand(for: $0)
    }
  }
}
