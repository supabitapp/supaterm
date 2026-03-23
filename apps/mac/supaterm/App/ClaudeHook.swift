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

  func pendingQuestion() -> String? {
    guard hookEventName == .preToolUse else { return nil }
    guard toolName == "AskUserQuestion" else { return nil }
    guard let firstQuestion = toolInput?.questions.first else { return nil }

    var parts: [String] = []
    if let question = firstQuestion.question {
      parts.append(question)
    } else if let header = firstQuestion.header {
      parts.append(header)
    }

    let labels = firstQuestion.options.compactMap(\.label)
    if !labels.isEmpty {
      parts.append(labels.map { "[\($0)]" }.joined(separator: " "))
    }

    guard !parts.isEmpty else { return nil }
    return parts.joined(separator: "\n")
  }

  static func isGenericAttentionMessage(_ value: String) -> Bool {
    let normalized =
      value
      .lowercased()
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.contains("needs your attention") || normalized.contains("needs your input")
  }
}
