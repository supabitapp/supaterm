import Foundation

enum SPClaudeHookSettings {
  static let command = #"[ -n "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" claude-hook || true"#

  static func jsonString() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(Settings()), as: UTF8.self)
  }

  private struct Settings: Encodable {
    let hooks: [String: [HookGroup]] = [
      "Notification": [.init(matcher: "", hooks: [.init(command: command, timeout: 10)])],
      "PreToolUse": [.init(matcher: "", hooks: [.init(command: command, timeout: 5, isAsync: true)])],
      "SessionEnd": [.init(matcher: "", hooks: [.init(command: command, timeout: 1)])],
      "SessionStart": [.init(matcher: "", hooks: [.init(command: command, timeout: 10)])],
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
