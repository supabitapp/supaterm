import Foundation

public enum SupatermClaudeHookEventName: Equatable, Sendable {
  case notification
  case preToolUse
  case sessionEnd
  case sessionStart
  case stop
  case unsupported(String)
  case userPromptSubmit

  public init(rawValue: String) {
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

  public var rawValue: String {
    switch self {
    case .notification:
      return "Notification"
    case .preToolUse:
      return "PreToolUse"
    case .sessionEnd:
      return "SessionEnd"
    case .sessionStart:
      return "SessionStart"
    case .stop:
      return "Stop"
    case .unsupported(let rawValue):
      return rawValue
    case .userPromptSubmit:
      return "UserPromptSubmit"
    }
  }
}

extension SupatermClaudeHookEventName: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    self = .init(rawValue: try container.decode(String.self))
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue)
  }
}

public struct SupatermClaudeHookQuestionOption: Equatable, Sendable, Codable {
  public let label: String?

  public init(label: String? = nil) {
    self.label = normalizeClaudeHookString(label)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      label: try container.decodeIfPresent(String.self, forKey: .label)
    )
  }

  enum CodingKeys: String, CodingKey {
    case label
  }
}

public struct SupatermClaudeHookQuestion: Equatable, Sendable, Codable {
  public let header: String?
  public let options: [SupatermClaudeHookQuestionOption]
  public let question: String?

  public init(
    header: String? = nil,
    options: [SupatermClaudeHookQuestionOption] = [],
    question: String? = nil
  ) {
    self.header = normalizeClaudeHookString(header)
    self.options = options
    self.question = normalizeClaudeHookString(question)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      header: try container.decodeIfPresent(String.self, forKey: .header),
      options: try container.decodeIfPresent([SupatermClaudeHookQuestionOption].self, forKey: .options) ?? [],
      question: try container.decodeIfPresent(String.self, forKey: .question)
    )
  }

  enum CodingKeys: String, CodingKey {
    case header
    case options
    case question
  }
}

public struct SupatermClaudeHookToolInput: Equatable, Sendable, Codable {
  public let questions: [SupatermClaudeHookQuestion]

  public init(questions: [SupatermClaudeHookQuestion] = []) {
    self.questions = questions
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      questions: try container.decodeIfPresent([SupatermClaudeHookQuestion].self, forKey: .questions) ?? []
    )
  }

  enum CodingKeys: String, CodingKey {
    case questions
  }
}

public struct SupatermClaudeHookEvent: Equatable, Sendable, Codable {
  public let agentType: String?
  public let cwd: String?
  public let hookEventName: SupatermClaudeHookEventName
  public let lastAssistantMessage: String?
  public let message: String?
  public let model: String?
  public let notificationType: String?
  public let permissionMode: String?
  public let prompt: String?
  public let reason: String?
  public let sessionID: String?
  public let source: String?
  public let stopHookActive: Bool?
  public let title: String?
  public let toolInput: SupatermClaudeHookToolInput?
  public let toolName: String?
  public let toolUseID: String?
  public let transcriptPath: String?

  public init(
    agentType: String? = nil,
    cwd: String? = nil,
    hookEventName: SupatermClaudeHookEventName,
    lastAssistantMessage: String? = nil,
    message: String? = nil,
    model: String? = nil,
    notificationType: String? = nil,
    permissionMode: String? = nil,
    prompt: String? = nil,
    reason: String? = nil,
    sessionID: String? = nil,
    source: String? = nil,
    stopHookActive: Bool? = nil,
    title: String? = nil,
    toolInput: SupatermClaudeHookToolInput? = nil,
    toolName: String? = nil,
    toolUseID: String? = nil,
    transcriptPath: String? = nil
  ) {
    self.agentType = normalizeClaudeHookString(agentType)
    self.cwd = normalizeClaudeHookString(cwd)
    self.hookEventName = hookEventName
    self.lastAssistantMessage = normalizeClaudeHookString(lastAssistantMessage)
    self.message = normalizeClaudeHookString(message)
    self.model = normalizeClaudeHookString(model)
    self.notificationType = normalizeClaudeHookString(notificationType)
    self.permissionMode = normalizeClaudeHookString(permissionMode)
    self.prompt = normalizeClaudeHookString(prompt)
    self.reason = normalizeClaudeHookString(reason)
    self.sessionID = normalizeClaudeHookString(sessionID)
    self.source = normalizeClaudeHookString(source)
    self.stopHookActive = stopHookActive
    self.title = normalizeClaudeHookString(title)
    self.toolInput = toolInput
    self.toolName = normalizeClaudeHookString(toolName)
    self.toolUseID = normalizeClaudeHookString(toolUseID)
    self.transcriptPath = normalizeClaudeHookString(transcriptPath)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      agentType: try container.decodeIfPresent(String.self, forKey: .agentType),
      cwd: try container.decodeIfPresent(String.self, forKey: .cwd),
      hookEventName: try container.decode(SupatermClaudeHookEventName.self, forKey: .hookEventName),
      lastAssistantMessage: try container.decodeIfPresent(String.self, forKey: .lastAssistantMessage),
      message: try container.decodeIfPresent(String.self, forKey: .message),
      model: try container.decodeIfPresent(String.self, forKey: .model),
      notificationType: try container.decodeIfPresent(String.self, forKey: .notificationType),
      permissionMode: try container.decodeIfPresent(String.self, forKey: .permissionMode),
      prompt: try container.decodeIfPresent(String.self, forKey: .prompt),
      reason: try container.decodeIfPresent(String.self, forKey: .reason),
      sessionID: try container.decodeIfPresent(String.self, forKey: .sessionID),
      source: try container.decodeIfPresent(String.self, forKey: .source),
      stopHookActive: try container.decodeIfPresent(Bool.self, forKey: .stopHookActive),
      title: try container.decodeIfPresent(String.self, forKey: .title),
      toolInput: try container.decodeIfPresent(SupatermClaudeHookToolInput.self, forKey: .toolInput),
      toolName: try container.decodeIfPresent(String.self, forKey: .toolName),
      toolUseID: try container.decodeIfPresent(String.self, forKey: .toolUseID),
      transcriptPath: try container.decodeIfPresent(String.self, forKey: .transcriptPath)
    )
  }

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

public struct SupatermClaudeHookRequest: Equatable, Sendable, Codable {
  public let context: SupatermCLIContext?
  public let event: SupatermClaudeHookEvent

  public init(
    context: SupatermCLIContext? = nil,
    event: SupatermClaudeHookEvent
  ) {
    self.context = context
    self.event = event
  }
}

private func normalizeClaudeHookString(_ value: String?) -> String? {
  guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
    return nil
  }
  return value
}
