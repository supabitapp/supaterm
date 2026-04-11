import Foundation

public enum SupatermAgentKind: String, CaseIterable, Codable, Equatable, Sendable {
  case claude
  case codex
  case pi

  public var notificationTitle: String {
    switch self {
    case .claude:
      return "Claude Code"
    case .codex:
      return "Codex"
    case .pi:
      return "Pi"
    }
  }
}

public enum SupatermAgentHookEventName: Equatable, Sendable {
  case notification
  case postToolUse
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
    case "PostToolUse":
      self = .postToolUse
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
    case .postToolUse:
      return "PostToolUse"
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

extension SupatermAgentHookEventName: Codable {
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    self = .init(rawValue: try container.decode(String.self))
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    try container.encode(rawValue)
  }
}

public struct SupatermAgentHookQuestionOption: Equatable, Sendable, Codable {
  public let label: String?

  public init(label: String? = nil) {
    self.label = normalizeAgentHookString(label)
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

public struct SupatermAgentHookQuestion: Equatable, Sendable, Codable {
  public let header: String?
  public let options: [SupatermAgentHookQuestionOption]
  public let question: String?

  public init(
    header: String? = nil,
    options: [SupatermAgentHookQuestionOption] = [],
    question: String? = nil
  ) {
    self.header = normalizeAgentHookString(header)
    self.options = options
    self.question = normalizeAgentHookString(question)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      header: try container.decodeIfPresent(String.self, forKey: .header),
      options: try container.decodeIfPresent([SupatermAgentHookQuestionOption].self, forKey: .options) ?? [],
      question: try container.decodeIfPresent(String.self, forKey: .question)
    )
  }

  enum CodingKeys: String, CodingKey {
    case header
    case options
    case question
  }
}

public struct SupatermAgentHookToolInput: Equatable, Sendable, Codable {
  public let questions: [SupatermAgentHookQuestion]

  public init(questions: [SupatermAgentHookQuestion] = []) {
    self.questions = questions
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      questions: try container.decodeIfPresent([SupatermAgentHookQuestion].self, forKey: .questions) ?? []
    )
  }

  enum CodingKeys: String, CodingKey {
    case questions
  }
}

public struct SupatermAgentHookEvent: Equatable, Sendable, Codable {
  public let agentType: String?
  public let cwd: String?
  public let hookEventName: SupatermAgentHookEventName
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
  public let toolInput: SupatermAgentHookToolInput?
  public let toolName: String?
  public let toolUseID: String?
  public let transcriptPath: String?

  public init(
    agentType: String? = nil,
    cwd: String? = nil,
    hookEventName: SupatermAgentHookEventName,
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
    toolInput: SupatermAgentHookToolInput? = nil,
    toolName: String? = nil,
    toolUseID: String? = nil,
    transcriptPath: String? = nil
  ) {
    self.agentType = normalizeAgentHookString(agentType)
    self.cwd = normalizeAgentHookString(cwd)
    self.hookEventName = hookEventName
    self.lastAssistantMessage = normalizeAgentHookString(lastAssistantMessage)
    self.message = normalizeAgentHookString(message)
    self.model = normalizeAgentHookString(model)
    self.notificationType = normalizeAgentHookString(notificationType)
    self.permissionMode = normalizeAgentHookString(permissionMode)
    self.prompt = normalizeAgentHookString(prompt)
    self.reason = normalizeAgentHookString(reason)
    self.sessionID = normalizeAgentHookString(sessionID)
    self.source = normalizeAgentHookString(source)
    self.stopHookActive = stopHookActive
    self.title = normalizeAgentHookString(title)
    self.toolInput = toolInput
    self.toolName = normalizeAgentHookString(toolName)
    self.toolUseID = normalizeAgentHookString(toolUseID)
    self.transcriptPath = normalizeAgentHookString(transcriptPath)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      agentType: container.decodeLossyStringIfPresent(forKey: .agentType),
      cwd: container.decodeLossyStringIfPresent(forKey: .cwd),
      hookEventName: try container.decode(SupatermAgentHookEventName.self, forKey: .hookEventName),
      lastAssistantMessage: container.decodeLossyStringIfPresent(forKey: .lastAssistantMessage),
      message: container.decodeLossyStringIfPresent(forKey: .message),
      model: container.decodeLossyStringIfPresent(forKey: .model),
      notificationType: container.decodeLossyStringIfPresent(forKey: .notificationType),
      permissionMode: container.decodeLossyStringIfPresent(forKey: .permissionMode),
      prompt: container.decodeLossyStringIfPresent(forKey: .prompt),
      reason: container.decodeLossyStringIfPresent(forKey: .reason),
      sessionID: container.decodeLossyStringIfPresent(forKey: .sessionID),
      source: container.decodeLossyStringIfPresent(forKey: .source),
      stopHookActive: container.decodeLossyBoolIfPresent(forKey: .stopHookActive),
      title: container.decodeLossyStringIfPresent(forKey: .title),
      toolInput: container.decodeLossyIfPresent(SupatermAgentHookToolInput.self, forKey: .toolInput),
      toolName: container.decodeLossyStringIfPresent(forKey: .toolName),
      toolUseID: container.decodeLossyStringIfPresent(forKey: .toolUseID),
      transcriptPath: container.decodeLossyStringIfPresent(forKey: .transcriptPath)
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

public struct SupatermAgentHookRequest: Equatable, Sendable, Codable {
  public let agent: SupatermAgentKind
  public let context: SupatermCLIContext?
  public let event: SupatermAgentHookEvent

  public init(
    agent: SupatermAgentKind,
    context: SupatermCLIContext? = nil,
    event: SupatermAgentHookEvent
  ) {
    self.agent = agent
    self.context = context
    self.event = event
  }
}

private func normalizeAgentHookString(_ value: String?) -> String? {
  guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
    return nil
  }
  return value
}

private extension KeyedDecodingContainer {
  func decodeLossyIfPresent<T: Decodable>(
    _ type: T.Type,
    forKey key: Key
  ) -> T? {
    try? decodeIfPresent(type, forKey: key)
  }

  func decodeLossyStringIfPresent(
    forKey key: Key
  ) -> String? {
    decodeLossyIfPresent(String.self, forKey: key)
  }

  func decodeLossyBoolIfPresent(
    forKey key: Key
  ) -> Bool? {
    decodeLossyIfPresent(Bool.self, forKey: key)
  }
}
