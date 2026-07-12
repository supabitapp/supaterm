import Foundation

public enum SupatermCodexHookSettings {
  public static let command = SupatermManagedHookCommand.receiveHookCommand(for: .codex)

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

  static var nativeHookIdentities: Set<CodexHookIdentity> {
    Set(
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

  static func nativeEventName(forConfigEvent event: String) -> String? {
    specs.first(where: { $0.configEvent == event })?.nativeEvent
  }

  public static func jsonString() throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let json = String(bytes: try encoder.encode(Settings()), encoding: .utf8) else {
      throw SupatermCodexHookSettingsError.invalidConfiguration
    }
    return json
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

    init() {
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

struct CodexHookIdentity: Hashable {
  let eventName: String
  let handlerType: String
  let matcher: String?
  let command: String
  let timeoutSeconds: Int
  let statusMessage: String?

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.eventName == rhs.eventName
      && lhs.handlerType == rhs.handlerType
      && lhs.matcher == rhs.matcher
      && lhs.command == rhs.command
      && lhs.timeoutSeconds == rhs.timeoutSeconds
      && lhs.statusMessage == rhs.statusMessage
  }

  func hash(into hasher: inout Hasher) {
    hasher.combine(eventName)
    hasher.combine(handlerType)
    hasher.combine(matcher)
    hasher.combine(command)
    hasher.combine(timeoutSeconds)
    hasher.combine(statusMessage)
  }

  init(
    eventName: String,
    handlerType: String,
    matcher: String?,
    command: String,
    timeoutSeconds: Int,
    statusMessage: String?
  ) {
    self.eventName = eventName
    self.handlerType = handlerType
    self.matcher = matcher
    self.command = command
    self.timeoutSeconds = timeoutSeconds
    self.statusMessage = statusMessage
  }

  init(hook: CodexAppServerHook) {
    self.init(
      eventName: hook.eventName,
      handlerType: hook.handlerType,
      matcher: hook.matcher,
      command: hook.command ?? "",
      timeoutSeconds: hook.timeoutSeconds,
      statusMessage: hook.statusMessage
    )
  }
}

enum SupatermCodexHookSettingsError: Error {
  case invalidConfiguration
}
