import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct SPPingResult: Equatable, Codable {
    let pong: Bool
  }

  struct Internal: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "internal",
      abstract: "Run internal Supaterm CLI commands.",
      discussion: SPHelp.internalDiscussion,
      shouldDisplay: false,
      subcommands: [
        Ping.self,
        AgentSettings.self,
        Development.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct Ping: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ping",
      abstract: "Check Supaterm socket liveness."
    )

    @Option(name: .long, help: "Socket response timeout in seconds.")
    var timeout = 0.75

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance,
        responseTimeout: timeout
      )
      let response = try client.send(.ping())
      let result = try Self.result(from: response)
      print(try jsonString(result))
    }

    static func result(from response: SupatermSocketResponse) throws -> SPPingResult {
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      return try response.decodeResult(SPPingResult.self)
    }
  }

  struct Development: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "dev",
      abstract: "Run development-only verification commands.",
      discussion: SPHelp.developmentDiscussion,
      subcommands: [Claude.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP.Development {
  struct Claude: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Emit synthetic Claude hook events for live integration verification.",
      discussion: SPHelp.developmentClaudeDiscussion,
      subcommands: [
        SessionStart.self,
        PreToolUse.self,
        Notification.self,
        UserPromptSubmit.self,
        Stop.self,
        SessionEnd.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP.Development.Claude {
  struct SessionStart: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "session-start",
      abstract: "Mark the current tab as running Claude activity.",
      discussion: SPHelp.developmentClaudeSessionStartDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.sessionStart, invocation: invocation)
    }
  }

  struct PreToolUse: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "pre-tool-use",
      abstract: "Emit a synthetic pre-tool-use hook for the current Claude session.",
      discussion: SPHelp.developmentClaudePreToolUseDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.preToolUse, invocation: invocation)
    }
  }

  struct Notification: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "notification",
      abstract: "Trigger a generic attention notification for the current Claude session.",
      discussion: SPHelp.developmentClaudeNotificationDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.notification, invocation: invocation)
    }
  }

  struct UserPromptSubmit: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "user-prompt-submit",
      abstract: "Return the current Claude session to running after synthetic input.",
      discussion: SPHelp.developmentClaudeUserPromptSubmitDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.userPromptSubmit, invocation: invocation)
    }
  }

  struct Stop: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "stop",
      abstract: "Mark the current Claude session as idle.",
      discussion: SPHelp.developmentClaudeStopDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.stop, invocation: invocation)
    }
  }

  struct SessionEnd: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "session-end",
      abstract: "Clear synthetic Claude activity for the current session.",
      discussion: SPHelp.developmentClaudeSessionEndDiscussion
    )

    @OptionGroup
    var invocation: SPDevelopmentClaudeInvocationOptions

    mutating func run() throws {
      try sendDevelopmentClaudeEvent(.sessionEnd, invocation: invocation)
    }
  }
}

struct SPDevelopmentClaudeInvocationOptions: ParsableArguments {
  @OptionGroup
  var connection: SPConnectionOptions

  @Option(name: .long, help: "Use the specified synthetic Claude session identifier.")
  var sessionID: String?
}

enum SPDevelopmentClaudeEventKind: Equatable {
  case sessionEnd
  case sessionStart
  case stop
  case notification
  case preToolUse
  case userPromptSubmit

  var commandName: String {
    switch self {
    case .sessionStart:
      return "session-start"
    case .preToolUse:
      return "pre-tool-use"
    case .notification:
      return "notification"
    case .userPromptSubmit:
      return "user-prompt-submit"
    case .stop:
      return "stop"
    case .sessionEnd:
      return "session-end"
    }
  }
}

struct SPDevelopmentClaudeEventBuilder {
  let currentDirectoryPath: String

  init(currentDirectoryPath: String = FileManager.default.currentDirectoryPath) {
    self.currentDirectoryPath = currentDirectoryPath
  }

  func defaultSessionID(for context: SupatermCLIContext) -> String {
    "sp-development-\(context.surfaceID.uuidString.lowercased())"
  }

  func event(
    _ kind: SPDevelopmentClaudeEventKind,
    context: SupatermCLIContext,
    sessionIDOverride: String? = nil
  ) throws -> SupatermAgentHookEvent {
    let sessionID = try resolvedSessionID(context: context, sessionIDOverride: sessionIDOverride)
    switch kind {
    case .sessionStart:
      return .init(
        agentType: "assistant",
        cwd: currentDirectoryPath,
        hookEventName: .sessionStart,
        model: "sp-development",
        sessionID: sessionID,
        source: "sp development"
      )

    case .preToolUse:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .preToolUse,
        permissionMode: "acceptEdits",
        sessionID: sessionID
      )

    case .notification:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .notification,
        message: "Claude needs your attention",
        notificationType: "request_input",
        sessionID: sessionID,
        title: "Needs input"
      )

    case .userPromptSubmit:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .userPromptSubmit,
        permissionMode: "acceptEdits",
        prompt: "Use the recommended option",
        sessionID: sessionID
      )

    case .stop:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .stop,
        lastAssistantMessage: "Done.",
        permissionMode: "acceptEdits",
        sessionID: sessionID,
        stopHookActive: false
      )

    case .sessionEnd:
      return .init(
        cwd: currentDirectoryPath,
        hookEventName: .sessionEnd,
        reason: "exit",
        sessionID: sessionID
      )
    }
  }

  private func resolvedSessionID(
    context: SupatermCLIContext,
    sessionIDOverride: String?
  ) throws -> String {
    if let sessionIDOverride {
      let trimmed = sessionIDOverride.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty else {
        throw ValidationError("--session-id must not be empty.")
      }
      return trimmed
    }
    return defaultSessionID(for: context)
  }
}

struct SPDevelopmentAvailability {
  static func validate(isDevelopmentBuild: Bool) throws {
    guard isDevelopmentBuild else {
      throw ValidationError("This command is only available when Supaterm is running a development build.")
    }
  }
}

private func sendDevelopmentClaudeEvent(
  _ kind: SPDevelopmentClaudeEventKind,
  invocation: SPDevelopmentClaudeInvocationOptions
) throws {
  try requireDevelopmentBuild(connection: invocation.connection)

  guard let context = SupatermCLIContext.current else {
    throw ValidationError("Run this command inside a Supaterm pane.")
  }

  let event = try SPDevelopmentClaudeEventBuilder().event(
    kind,
    context: context,
    sessionIDOverride: invocation.sessionID
  )
  let client = try socketClient(
    path: invocation.connection.explicitSocketPath,
    instance: invocation.connection.instance
  )
  let response = try client.send(
    .agentHook(
      .init(
        agent: .claude,
        context: context,
        event: event
      )
    )
  )
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }

  print("sent \(kind.commandName) for session \(event.sessionID ?? "")")
}

private func requireDevelopmentBuild(connection: SPConnectionOptions) throws {
  let client = try socketClient(
    path: connection.explicitSocketPath,
    instance: connection.instance,
    alwaysDiscover: true
  )
  let response = try client.send(
    .debug(
      .init(context: SupatermCLIContext.current)
    )
  )
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }

  let snapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
  try SPDevelopmentAvailability.validate(isDevelopmentBuild: snapshot.build.isDevelopmentBuild)
}
