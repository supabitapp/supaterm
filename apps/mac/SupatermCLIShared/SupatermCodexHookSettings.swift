import Foundation

public enum SupatermCodexHookSettings {
  private static let specs = [
    HookSpec(configEvent: "PermissionRequest", nativeEvent: "permissionRequest", timeout: 5),
    HookSpec(configEvent: "PostToolUse", nativeEvent: "postToolUse", timeout: 5),
    HookSpec(
      configEvent: "PreToolUse",
      nativeEvent: "preToolUse",
      matcher: "request_user_input",
      timeout: 5
    ),
    HookSpec(configEvent: "SessionStart", nativeEvent: "sessionStart", timeout: 10),
    HookSpec(configEvent: "Stop", nativeEvent: "stop", timeout: 10),
    HookSpec(configEvent: "SubagentStart", nativeEvent: "subagentStart", timeout: 10),
    HookSpec(configEvent: "SubagentStop", nativeEvent: "subagentStop", timeout: 10),
    HookSpec(configEvent: "UserPromptSubmit", nativeEvent: "userPromptSubmit", timeout: 10),
  ]

  public static func command(homeDirectoryURL: URL) -> String {
    SupatermManagedHookCommand.policy(
      for: .codex,
      homeDirectoryURL: homeDirectoryURL
    ).command
  }

  public static func nativeHookIdentities(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> Set<CodexHookIdentity> {
    let command = command(homeDirectoryURL: homeDirectoryURL)
    return Set(
      specs.map { spec in
        CodexHookIdentity(
          eventName: spec.nativeEvent,
          handlerType: "command",
          matcher: spec.matcher,
          command: command,
          timeoutSeconds: spec.timeout,
          statusMessage: nil
        )
      }
    )
  }

  public static func nativeEventName(forConfigEvent event: String) -> String? {
    specs.first(where: { $0.configEvent == event })?.nativeEvent
  }

  public static func jsonString(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
  ) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let settings = Settings(command: command(homeDirectoryURL: homeDirectoryURL))
    guard let json = String(bytes: try encoder.encode(settings), encoding: .utf8) else {
      throw SupatermCodexHookSettingsError.invalidConfiguration
    }
    return json
  }

  public static func hookGroupsByEvent(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
  ) throws -> [String: [JSONValue]] {
    let settings = Settings(command: command(homeDirectoryURL: homeDirectoryURL))
    guard
      let objectValue = try JSONValue(settings).objectValue,
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

  private struct HookSpec {
    let configEvent: String
    let nativeEvent: String
    let matcher: String?
    let timeout: Int

    init(
      configEvent: String,
      nativeEvent: String,
      matcher: String? = nil,
      timeout: Int
    ) {
      self.configEvent = configEvent
      self.nativeEvent = nativeEvent
      self.matcher = matcher
      self.timeout = timeout
    }
  }

  private struct Settings: Encodable {
    let hooks: [String: [HookGroup]]

    init(command: String) {
      hooks = Dictionary(grouping: specs, by: \.configEvent).mapValues { specs in
        specs.map { spec in
          HookGroup(
            matcher: spec.matcher,
            hooks: [CommandHook(command: command, timeout: spec.timeout)]
          )
        }
      }
    }
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

public struct CodexHookIdentity: Hashable {
  private let components: [String?]

  public init(
    eventName: String,
    handlerType: String,
    matcher: String?,
    command: String,
    timeoutSeconds: Int,
    statusMessage: String?
  ) {
    components = [eventName, handlerType, matcher, command, String(timeoutSeconds), statusMessage]
  }

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.components == rhs.components
  }

  public func hash(into hasher: inout Hasher) {
    hasher.combine(components)
  }
}

enum SupatermCodexHookSettingsError: Error {
  case invalidConfiguration
}
