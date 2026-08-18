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
        Agent.self,
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

extension SP.Internal {
  struct Agent: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "agent",
      abstract: "Run internal coding-agent diagnostics.",
      shouldDisplay: false,
      subcommands: [Explain.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP.Internal.Agent {
  struct Explain: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "explain",
      abstract: "Explain coding-agent detection for a pane.",
      shouldDisplay: false
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { client in
          try .agentExplain(
            resolvePublicPaneTarget(
              pane,
              context: SupatermCLIContext.current,
              snapshot: try treeSnapshot(client)
            )
          )
        },
        as: SupatermAgentExplainResult.self,
        plain: agentExplainPlain,
        human: agentExplainHuman
      )
    }
  }
}

func agentExplainPlain(_ result: SupatermAgentExplainResult) -> String {
  let processID = result.process.map { String($0.processID) } ?? "-"
  let processStartTime = result.process.map { String($0.startTimeMicroseconds) } ?? "-"
  let ruleGeneration = result.rules.map { String($0.generation) } ?? "-"
  let fields: [String] = [
    agentExplainPaneSelector(result.target),
    result.mode.rawValue,
    result.status.rawValue,
    result.agent?.id ?? "-",
    result.agent?.phase.rawValue ?? "-",
    processID,
    processStartTime,
    result.rules?.source.rawValue ?? "-",
    ruleGeneration,
    result.ruleID ?? "-",
  ]
  return fields.joined(separator: "\t")
}

func agentExplainHuman(_ result: SupatermAgentExplainResult) -> String {
  var lines = [
    "Pane \(agentExplainPaneSelector(result.target))",
    "Detection: \(result.mode.rawValue) (\(agentExplainWords(result.status.rawValue)))",
  ]
  if let agent = result.agent {
    lines.append(
      "Agent: \(agent.displayName) [\(agent.id)], \(agentExplainWords(agent.phase.rawValue))"
    )
  }
  if let process = result.process {
    lines.append(
      "Process: \(process.processID), started \(process.startTimeMicroseconds)"
    )
  }
  if let rules = result.rules {
    var ruleText = "Rules: \(rules.source.rawValue) generation \(rules.generation)"
    if let ruleID = result.ruleID {
      ruleText += ", matched \(ruleID)"
    }
    lines.append(ruleText)
  } else if let ruleID = result.ruleID {
    lines.append("Rule: \(ruleID)")
  }
  return lines.joined(separator: "\n")
}

private func agentExplainPaneSelector(_ target: SupatermPaneTarget) -> String {
  "\(target.spaceIndex)/\(target.tabIndex)/\(target.paneIndex)"
}

private func agentExplainWords(_ value: String) -> String {
  value.replacingOccurrences(of: "_", with: " ")
}

extension SP.Development {
  struct Claude: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Emit a synthetic Claude session identity for live integration verification.",
      discussion: SPHelp.developmentClaudeDiscussion,
      subcommands: [
        SessionStart.self
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
      try sendDevelopmentClaudeSessionStart(invocation: invocation)
    }
  }
}

struct SPDevelopmentClaudeInvocationOptions: ParsableArguments {
  @OptionGroup
  var connection: SPConnectionOptions

  @Option(name: .long, help: "Use the specified synthetic Claude session identifier.")
  var sessionID: String?
}

struct SPDevelopmentClaudeEventBuilder {
  let currentDirectoryPath: String

  init(currentDirectoryPath: String = FileManager.default.currentDirectoryPath) {
    self.currentDirectoryPath = currentDirectoryPath
  }

  func defaultSessionID(for context: SupatermCLIContext) -> String {
    "sp-development-\(context.surfaceID.uuidString.lowercased())"
  }

  func sessionStartEvent(
    context: SupatermCLIContext,
    sessionIDOverride: String? = nil
  ) throws -> SupatermAgentHookEvent {
    let sessionID = try resolvedSessionID(context: context, sessionIDOverride: sessionIDOverride)
    return SupatermAgentHookEvent(
      agentType: "assistant",
      cwd: currentDirectoryPath,
      hookEventName: .sessionStart,
      model: "sp-development",
      sessionID: sessionID,
      source: "sp development"
    )
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

private func sendDevelopmentClaudeSessionStart(
  invocation: SPDevelopmentClaudeInvocationOptions
) throws {
  try requireDevelopmentBuild(connection: invocation.connection)

  guard let context = SupatermCLIContext.current else {
    throw ValidationError("Run this command inside a Supaterm pane.")
  }

  let event = try SPDevelopmentClaudeEventBuilder().sessionStartEvent(
    context: context,
    sessionIDOverride: invocation.sessionID
  )
  let client = try socketClient(
    path: invocation.connection.explicitSocketPath,
    instance: invocation.connection.instance
  )
  let response = try client.send(
    .agentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: context,
        event: event
      )
    )
  )
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }

  print("sent session-start for session \(event.sessionID ?? "")")
}

private func requireDevelopmentBuild(connection: SPConnectionOptions) throws {
  let client = try socketClient(
    path: connection.explicitSocketPath,
    instance: connection.instance,
    discoveryPolicy: .always
  )
  let response = try client.send(
    .debug(
      SupatermDebugRequest(context: SupatermCLIContext.current)
    )
  )
  guard response.ok else {
    throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
  }

  let snapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
  try SPDevelopmentAvailability.validate(isDevelopmentBuild: snapshot.build.isDevelopmentBuild)
}
