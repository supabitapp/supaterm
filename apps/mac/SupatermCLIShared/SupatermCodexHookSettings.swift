import Foundation

public enum SupatermCodexHookSettings {
  public static let command = SupatermAgentHookSettingsCommand.command(for: .codex)

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
      throw SupatermCodexHookSettingsError.invalidConfiguration
    }

    var hookGroupsByEvent: [String: [JSONValue]] = [:]
    for (event, value) in hooksValue {
      guard let groups = value.arrayValue else {
        throw SupatermCodexHookSettingsError.invalidConfiguration
      }
      hookGroupsByEvent[event] = groups
    }
    return hookGroupsByEvent
  }

  private struct Settings: Encodable {
    let hooks: [String: [HookGroup]] = [
      "PreToolUse": [.init(matcher: "Bash", hooks: [.init(command: command, timeout: 5)])],
      "SessionStart": [.init(matcher: "startup|resume", hooks: [.init(command: command, timeout: 10)])],
      "Stop": [.init(hooks: [.init(command: command, timeout: 10)])],
      "UserPromptSubmit": [.init(hooks: [.init(command: command, timeout: 10)])],
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

    init(command: String, timeout: Int) {
      self.command = command
      self.timeout = timeout
    }
  }
}

public enum SupatermCodexHookSettingsError: Error {
  case invalidConfiguration
}
