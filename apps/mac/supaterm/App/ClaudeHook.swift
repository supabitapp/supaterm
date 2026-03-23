import Foundation
import SupatermCLIShared

enum ClaudeHookError: Error, Equatable, LocalizedError {
  case invalidPayload
  case missingEventName
  case missingNotificationMessage

  var errorDescription: String? {
    switch self {
    case .invalidPayload:
      return "Claude hook payload must be a JSON object."
    case .missingEventName:
      return "Claude hook payload is missing hook_event_name."
    case .missingNotificationMessage:
      return "Claude notification payload is missing message."
    }
  }
}

enum ClaudeHookEventName: Equatable, Sendable {
  case notification
  case preToolUse
  case sessionEnd
  case sessionStart
  case stop
  case unsupported(String)
  case userPromptSubmit

  init(rawValue: String) {
    switch rawValue {
    case "Notification":
      self = .notification
    case "PreToolUse":
      self = .preToolUse
    case "SessionEnd":
      self = .sessionEnd
    case "SessionStart":
      self = .sessionStart
    case "Stop":
      self = .stop
    case "UserPromptSubmit":
      self = .userPromptSubmit
    default:
      self = .unsupported(rawValue)
    }
  }
}

struct ClaudeHookEvent: Equatable, Sendable {
  let agentType: String?
  let cwd: String?
  let lastAssistantMessage: String?
  let message: String?
  let model: String?
  let name: ClaudeHookEventName
  let notificationType: String?
  let permissionMode: String?
  let prompt: String?
  let reason: String?
  let sessionID: String?
  let source: String?
  let stopHookActive: Bool?
  let title: String?
  let toolInput: JSONObject?
  let toolName: String?
  let toolUseID: String?
  let transcriptPath: String?

  init(eventObject: JSONObject) throws {
    let encoder = JSONEncoder()
    let decoder = JSONDecoder()
    let data = try encoder.encode(eventObject)
    let payload: ClaudeHookPayload
    do {
      payload = try decoder.decode(ClaudeHookPayload.self, from: data)
    } catch {
      throw ClaudeHookError.invalidPayload
    }

    guard let hookEventName = Self.normalized(payload.hookEventName) else {
      throw ClaudeHookError.missingEventName
    }

    self.agentType = Self.normalized(payload.agentType)
    self.cwd = Self.normalized(payload.cwd)
    self.lastAssistantMessage = Self.normalized(payload.lastAssistantMessage)
    self.message = Self.normalized(payload.message)
    self.model = Self.normalized(payload.model)
    self.name = ClaudeHookEventName(rawValue: hookEventName)
    self.notificationType = Self.normalized(payload.notificationType)
    self.permissionMode = Self.normalized(payload.permissionMode)
    self.prompt = Self.normalized(payload.prompt)
    self.reason = Self.normalized(payload.reason)
    self.sessionID = Self.normalized(payload.sessionID)
    self.source = Self.normalized(payload.source)
    self.stopHookActive = payload.stopHookActive
    self.title = Self.normalized(payload.title)
    self.toolInput = payload.toolInput
    self.toolName = Self.normalized(payload.toolName)
    self.toolUseID = Self.normalized(payload.toolUseID)
    self.transcriptPath = Self.normalized(payload.transcriptPath)
  }

  func notificationMessage() throws -> String {
    guard let message else {
      throw ClaudeHookError.missingNotificationMessage
    }
    return message
  }

  func pendingQuestion() -> String? {
    guard case .preToolUse = name else { return nil }
    guard toolName == "AskUserQuestion" else { return nil }
    guard
      let firstQuestion = toolInput?["questions"]?.arrayValue?.first?.objectValue
    else {
      return nil
    }

    var parts: [String] = []
    if let question = Self.normalized(firstQuestion["question"]?.stringValue) {
      parts.append(question)
    } else if let header = Self.normalized(firstQuestion["header"]?.stringValue) {
      parts.append(header)
    }

    let labels = firstQuestion["options"]?.arrayValue?
      .compactMap { option in
        Self.normalized(option.objectValue?["label"]?.stringValue)
      } ?? []
    if !labels.isEmpty {
      parts.append(labels.map { "[\($0)]" }.joined(separator: " "))
    }

    guard !parts.isEmpty else { return nil }
    return parts.joined(separator: "\n")
  }

  static func isGenericAttentionMessage(_ value: String) -> Bool {
    let normalized = value
      .lowercased()
      .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.contains("needs your attention") || normalized.contains("needs your input")
  }

  private static func normalized(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
      return nil
    }
    return value
  }
}

private struct ClaudeHookPayload: Decodable {
  let agentType: String?
  let cwd: String?
  let hookEventName: String?
  let lastAssistantMessage: String?
  let message: String?
  let model: String?
  let notificationType: String?
  let permissionMode: String?
  let prompt: String?
  let reason: String?
  let sessionID: String?
  let source: String?
  let stopHookActive: Bool?
  let title: String?
  let toolInput: JSONObject?
  let toolName: String?
  let toolUseID: String?
  let transcriptPath: String?

  enum CodingKeys: String, CodingKey {
    case agentType = "agent_type"
    case cwd
    case hookEventName = "hook_event_name"
    case lastAssistantMessage = "last_assistant_message"
    case message
    case model
    case notificationType = "notification_type"
    case permissionMode = "permission_mode"
    case prompt
    case reason
    case sessionID = "session_id"
    case source
    case stopHookActive = "stop_hook_active"
    case title
    case toolInput = "tool_input"
    case toolName = "tool_name"
    case toolUseID = "tool_use_id"
    case transcriptPath = "transcript_path"
  }
}
