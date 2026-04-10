import Foundation
import SupatermCLIShared

public enum AgentHookError: Error, Equatable, LocalizedError {
  case missingNotificationMessage

  public var errorDescription: String? {
    switch self {
    case .missingNotificationMessage:
      return "Agent notification payload is missing message."
    }
  }
}

extension SupatermAgentHookEvent {
  public func notificationMessage() throws -> String {
    guard let message else {
      throw AgentHookError.missingNotificationMessage
    }
    return message
  }
}
