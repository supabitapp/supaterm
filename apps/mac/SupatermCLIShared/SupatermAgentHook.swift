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

public struct SupatermAgentHookEventName: Equatable, Hashable, RawRepresentable, Sendable {
  public static let agentEnd = Self(rawValue: "agent_end")
  public static let agentStart = Self(rawValue: "agent_start")
  public static let nativeSessionStart = Self(rawValue: "session_start")
  public static let notification = Self(rawValue: "Notification")
  public static let permissionRequest = Self(rawValue: "PermissionRequest")
  public static let postToolUse = Self(rawValue: "PostToolUse")
  public static let preToolUse = Self(rawValue: "PreToolUse")
  public static let sessionEnd = Self(rawValue: "SessionEnd")
  public static let sessionShutdown = Self(rawValue: "session_shutdown")
  public static let sessionStart = Self(rawValue: "SessionStart")
  public static let stop = Self(rawValue: "Stop")
  public static let subagentStart = Self(rawValue: "SubagentStart")
  public static let subagentStop = Self(rawValue: "SubagentStop")
  public static let userPromptSubmit = Self(rawValue: "UserPromptSubmit")

  public let rawValue: String

  public init(rawValue: String) {
    self.rawValue = rawValue
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
  public var agentType: String? { string("agent_type") }
  public var hookEventName: SupatermAgentHookEventName {
    SupatermAgentHookEventName(rawValue: payload["hook_event_name"]?.stringValue ?? "")
  }
  public var lastAssistantMessage: String? { string("last_assistant_message") }
  public var message: String? { string("message") }
  public var notificationType: String? { string("notification_type") }
  public var sessionID: String? { string("session_id") }
  public var source: String? { string("source") }
  public var stopReason: String? { string("stop_reason") }
  public var title: String? { string("title") }
  public var toolInput: JSONValue? { payload["tool_input"] }
  public var toolName: String? { string("tool_name") }
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
    sessionID: String? = nil,
    source: String? = nil,
    stopReason: String? = nil,
    title: String? = nil,
    toolInput: JSONValue? = nil,
    toolName: String? = nil,
    toolUseID: String? = nil,
    transcriptPath: String? = nil,
    turnID: String? = nil,
    agentID: String? = nil
  ) {
    var payload: JSONObject = ["hook_event_name": .string(hookEventName.rawValue)]
    Self.insert(agentID, key: "agent_id", into: &payload)
    Self.insert(agentType, key: "agent_type", into: &payload)
    Self.insert(cwd, key: "cwd", into: &payload)
    Self.insert(lastAssistantMessage, key: "last_assistant_message", into: &payload)
    Self.insert(message, key: "message", into: &payload)
    Self.insert(model, key: "model", into: &payload)
    Self.insert(notificationType, key: "notification_type", into: &payload)
    Self.insert(sessionID, key: "session_id", into: &payload)
    Self.insert(source, key: "source", into: &payload)
    Self.insert(stopReason, key: "stop_reason", into: &payload)
    Self.insert(title, key: "title", into: &payload)
    Self.insert(toolName, key: "tool_name", into: &payload)
    Self.insert(toolUseID, key: "tool_use_id", into: &payload)
    Self.insert(transcriptPath, key: "transcript_path", into: &payload)
    Self.insert(turnID, key: "turn_id", into: &payload)
    if let toolInput {
      payload["tool_input"] = toolInput
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
