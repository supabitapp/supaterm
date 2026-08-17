import Foundation

public enum SupatermClaudeHookSettings {
  public static let command = SupatermManagedHookCommand.receiveHookCommand(for: .claude)
  public static let actionableNotificationTypes: Set<String> = [
    "elicitation_dialog",
    "idle_prompt",
    "permission_prompt",
  ]
  public static let backgroundNotificationTypes: Set<String> = [
    "agent_completed",
    "agent_needs_input",
    "worker_permission_prompt",
  ]

  public static func jsonString() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let json = String(bytes: try encoder.encode(Settings()), encoding: .utf8) else {
      throw SupatermClaudeHookSettingsError.invalidConfiguration
    }
    return json
  }

  public static func hookGroupsByEvent() throws -> [String: [JSONValue]] {
    guard
      let objectValue = try JSONValue(Settings()).objectValue,
      let hooksValue = objectValue["hooks"]?.objectValue
    else {
      throw SupatermClaudeHookSettingsError.invalidConfiguration
    }

    var hookGroupsByEvent: [String: [JSONValue]] = [:]
    for (event, value) in hooksValue {
      guard let groups = value.arrayValue else {
        throw SupatermClaudeHookSettingsError.invalidConfiguration
      }
      hookGroupsByEvent[event] = groups
    }
    return hookGroupsByEvent
  }

  private struct Settings: Encodable {
    let hooks: [String: [ClaudeHookGroup]] = [
      "Notification": [
        ClaudeHookGroup(
          matcher: Self.notificationMatcher,
          hooks: [ClaudeCommandHook(command: command, timeout: 10)]
        )
      ],
      "PostToolUse": [
        ClaudeHookGroup(
          matcher: "",
          hooks: [ClaudeCommandHook(command: command, timeout: 5, isAsync: true)]
        )
      ],
      "PreToolUse": [
        ClaudeHookGroup(
          matcher: "",
          hooks: [ClaudeCommandHook(command: command, timeout: 5, isAsync: true)]
        )
      ],
      "SessionEnd": [
        ClaudeHookGroup(matcher: "", hooks: [ClaudeCommandHook(command: command, timeout: 1)])
      ],
      "SessionStart": [
        ClaudeHookGroup(matcher: "", hooks: [ClaudeCommandHook(command: command, timeout: 10)])
      ],
      "Stop": [ClaudeHookGroup(hooks: [ClaudeCommandHook(command: command, timeout: 10)])],
      "SubagentStart": [
        ClaudeHookGroup(hooks: [ClaudeCommandHook(command: command, timeout: 10)])
      ],
      "SubagentStop": [
        ClaudeHookGroup(hooks: [ClaudeCommandHook(command: command, timeout: 10)])
      ],
      "TaskCompleted": [
        ClaudeHookGroup(hooks: [ClaudeCommandHook(command: command, timeout: 5, isAsync: true)])
      ],
      "TaskCreated": [
        ClaudeHookGroup(hooks: [ClaudeCommandHook(command: command, timeout: 5, isAsync: true)])
      ],
      "UserPromptSubmit": [
        ClaudeHookGroup(hooks: [ClaudeCommandHook(command: command, timeout: 10)])
      ],
    ]

    private static let notificationMatcher =
      actionableNotificationTypes
      .union(backgroundNotificationTypes)
      .sorted()
      .joined(separator: "|")
  }

}

private struct ClaudeHookGroup: Encodable {
  let matcher: String?
  let hooks: [ClaudeCommandHook]

  init(matcher: String? = nil, hooks: [ClaudeCommandHook]) {
    self.matcher = matcher
    self.hooks = hooks
  }
}

private struct ClaudeCommandHook: Encodable {
  let type = "command"
  let command: String
  let timeout: Int
  let isAsync: Bool?

  init(command: String, timeout: Int, isAsync: Bool? = nil) {
    self.command = command
    self.timeout = timeout
    self.isAsync = isAsync
  }

  enum CodingKeys: String, CodingKey {
    case type
    case command
    case timeout
    case isAsync = "async"
  }
}

enum SupatermClaudeHookSettingsError: Error {
  case invalidConfiguration
}
