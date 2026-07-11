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

public struct SupatermAgentHookEvent: Equatable, Sendable, Codable {
  public let payload: JSONObject

  public var agentID: String? { string("agent_id") }
  public var agentTranscriptPath: String? { string("agent_transcript_path") }
  public var agentType: String? { string("agent_type") }
  public var cwd: String? { string("cwd") }
  public var hookEventName: SupatermAgentHookEventName {
    SupatermAgentHookEventName(rawValue: payload["hook_event_name"]?.stringValue ?? "")
  }
  public var lastAssistantMessage: String? { string("last_assistant_message") }
  public var message: String? { string("message") }
  public var model: String? { string("model") }
  public var notificationType: String? { string("notification_type") }
  public var permissionMode: String? { string("permission_mode") }
  public var prompt: String? { string("prompt") }
  public var reason: String? { string("reason") }
  public var sessionID: String? { string("session_id") }
  public var source: String? { string("source") }
  public var stopHookActive: Bool? { payload["stop_hook_active"]?.boolValue }
  public var title: String? { string("title") }
  public var toolInput: JSONValue? { payload["tool_input"] }
  public var toolName: String? { string("tool_name") }
  public var toolResponse: JSONValue? { payload["tool_response"] }
  public var toolUseID: String? { string("tool_use_id") }
  public var transcriptPath: String? { string("transcript_path") }
  public var turnID: String? { string("turn_id") }

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
    toolInput: JSONValue? = nil,
    toolName: String? = nil,
    toolResponse: JSONValue? = nil,
    toolUseID: String? = nil,
    transcriptPath: String? = nil,
    turnID: String? = nil,
    agentID: String? = nil,
    agentTranscriptPath: String? = nil
  ) {
    var payload: JSONObject = ["hook_event_name": .string(hookEventName.rawValue)]
    Self.insert(agentID, key: "agent_id", into: &payload)
    Self.insert(agentTranscriptPath, key: "agent_transcript_path", into: &payload)
    Self.insert(agentType, key: "agent_type", into: &payload)
    Self.insert(cwd, key: "cwd", into: &payload)
    Self.insert(lastAssistantMessage, key: "last_assistant_message", into: &payload)
    Self.insert(message, key: "message", into: &payload)
    Self.insert(model, key: "model", into: &payload)
    Self.insert(notificationType, key: "notification_type", into: &payload)
    Self.insert(permissionMode, key: "permission_mode", into: &payload)
    Self.insert(prompt, key: "prompt", into: &payload)
    Self.insert(reason, key: "reason", into: &payload)
    Self.insert(sessionID, key: "session_id", into: &payload)
    Self.insert(source, key: "source", into: &payload)
    Self.insert(title, key: "title", into: &payload)
    Self.insert(toolName, key: "tool_name", into: &payload)
    Self.insert(toolUseID, key: "tool_use_id", into: &payload)
    Self.insert(transcriptPath, key: "transcript_path", into: &payload)
    Self.insert(turnID, key: "turn_id", into: &payload)
    if let stopHookActive {
      payload["stop_hook_active"] = .bool(stopHookActive)
    }
    if let toolInput {
      payload["tool_input"] = toolInput
    }
    if let toolResponse {
      payload["tool_response"] = toolResponse
    }
    self.payload = payload
  }

  public init(from decoder: Decoder) throws {
    let value = try JSONValue(from: decoder)
    guard let payload = value.objectValue,
      payload["hook_event_name"]?.stringValue != nil
    else {
      throw DecodingError.dataCorrupted(
        DecodingError.Context(
          codingPath: decoder.codingPath,
          debugDescription: "Agent hook event must contain a string hook_event_name."
        )
      )
    }
    self.payload = payload
  }

  public func encode(to encoder: Encoder) throws {
    try JSONValue.object(payload).encode(to: encoder)
  }

  private func string(_ key: String) -> String? {
    normalizeAgentHookString(payload[key]?.stringValue)
  }

  private static func insert(
    _ value: String?,
    key: String,
    into payload: inout JSONObject
  ) {
    guard let value = normalizeAgentHookString(value) else { return }
    payload[key] = .string(value)
  }
}

public struct SupatermAgentHookRequest: Equatable, Sendable, Codable {
  public let agent: SupatermAgentKind
  public let context: SupatermCLIContext?
  public let event: SupatermAgentHookEvent
  public let processID: Int32?

  public init(
    agent: SupatermAgentKind,
    context: SupatermCLIContext? = nil,
    event: SupatermAgentHookEvent,
    processID: Int32? = nil
  ) {
    self.agent = agent
    self.context = context
    self.event = event
    self.processID = processID
  }
}

private func normalizeAgentHookString(_ value: String?) -> String? {
  guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
    return nil
  }
  return value
}
