import Foundation
import SupatermCLIShared

enum AgentHookError: Error, Equatable, LocalizedError {
  case missingNotificationMessage

  var errorDescription: String? {
    switch self {
    case .missingNotificationMessage:
      return "Agent notification payload is missing message."
    }
  }
}

extension SupatermAgentHookEvent {
  func notificationMessage() throws -> String {
    guard let message else {
      throw AgentHookError.missingNotificationMessage
    }
    return message
  }
}
