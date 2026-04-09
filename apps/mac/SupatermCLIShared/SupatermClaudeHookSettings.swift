import Foundation

public enum SupatermClaudeHookSettings {
  public static func command(for eventName: SupatermAgentHookEventName) -> String {
    SupatermManagedHookCommand.receiveHookCommand(for: .claude, eventName: eventName)
  }

  public static func jsonString() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(Settings()), as: UTF8.self)
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
    let hooks: [String: [HookGroup]] = [
      "Notification": [.init(matcher: "", hooks: [.init(command: SupatermClaudeHookSettings.command(for: .notification), timeout: 10)])],
      "PreToolUse": [.init(matcher: "", hooks: [.init(command: SupatermClaudeHookSettings.command(for: .preToolUse), timeout: 5, isAsync: true)])],
      "SessionEnd": [.init(matcher: "", hooks: [.init(command: SupatermClaudeHookSettings.command(for: .sessionEnd), timeout: 1)])],
      "SessionStart": [.init(matcher: "", hooks: [.init(command: SupatermClaudeHookSettings.command(for: .sessionStart), timeout: 10)])],
      "Stop": [.init(hooks: [.init(command: SupatermClaudeHookSettings.command(for: .stop), timeout: 10)])],
      "UserPromptSubmit": [.init(hooks: [.init(command: SupatermClaudeHookSettings.command(for: .userPromptSubmit), timeout: 10)])],
    ]
  }

  private struct HookGroup: Encodable {
    let matcher: String?
    let hooks: [CommandHook]

    init(matcher: String? = nil, hooks: [CommandHook]) {
      self.matcher = matcher
      self.hooks = hooks
    }
  }

  private struct CommandHook: Encodable {
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
}

public enum SupatermClaudeHookSettingsError: Error {
  case invalidConfiguration
}
