import Foundation
import SupatermCLIShared

enum ClaudeHookError: Error, Equatable, LocalizedError {
  case missingNotificationMessage

  var errorDescription: String? {
    switch self {
    case .missingNotificationMessage:
      return "Claude notification payload is missing message."
    }
  }
}

extension SupatermClaudeHookEvent {
  func notificationMessage() throws -> String {
    guard let message else {
      throw ClaudeHookError.missingNotificationMessage
    }
    return message
  }
}
