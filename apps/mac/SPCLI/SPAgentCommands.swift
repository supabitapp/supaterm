import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct Agent: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "agent",
      abstract: "Manage Supaterm coding-agent integrations.",
      discussion: SPHelp.agentDiscussion,
      subcommands: [
        ExplainAgentDetection.self,
        InstallAgentHooks.self,
        InstallAgentHook.self,
        ReloadAgentDetectionRules.self,
        RemoveAgentHook.self,
        ReceiveAgentHook.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ExplainAgentDetection: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "explain",
      abstract: "Explain agent detection for a pane."
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let target = try resolvePublicPaneTarget(
        pane,
        context: SupatermCLIContext.current,
        snapshot: try treeSnapshot(client)
      )
      let response = try client.send(
        .agentDetectionExplain(SupatermAgentDetectionExplainRequest(target: target))
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      let result = try response.decodeResult(SupatermAgentDetectionExplainResult.self)
      try emitCommandResult(
        result,
        options: options.output,
        plain: renderAgentDetectionExplanation(result),
        human: renderAgentDetectionExplanation(result)
      )
    }
  }

  struct ReloadAgentDetectionRules: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "reload-rules",
      abstract: "Reload local agent detection manifests."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { _ in .agentDetectionReload() },
        as: SupatermAgentDetectionReloadResult.self,
        plain: renderAgentDetectionReload,
        human: renderAgentDetectionReload
      )
    }
  }

  struct InstallAgentHooks: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "install-hooks",
      abstract: "Install Supaterm's hook bridge for every supported coding agent.",
      discussion: SPHelp.installAgentHooksDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try sendAgentHookRequests(
        agents: [.claude, .codex],
        connection: connection,
        request: { try .hooksInstall($0) }
      )
    }
  }

  struct ReceiveAgentHook: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "receive-agent-hook",
      abstract: "Forward one agent hook event to Supaterm.",
      discussion: SPHelp.receiveAgentHookDiscussion,
      shouldDisplay: false
    )

    @Option(name: .long, help: "Agent that emitted the hook payload.")
    var agent: SupatermAgentKind

    @Option(name: .long, help: "Process ID that emitted the hook payload.")
    var pid: Int32?

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let rawInput = FileHandle.standardInput.readDataToEndOfFile()
      let event = try agentHookEvent(from: rawInput)
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(
        .agentHook(
          SupatermAgentHookRequest(
            agent: agent,
            context: SupatermCLIContext.current,
            event: event,
            processID: pid
          )
        )
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
    }
  }

  struct InstallAgentHook: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "install-hook",
      abstract: "Install Supaterm's hook bridge for a coding agent.",
      discussion: SPHelp.installAgentHookDiscussion,
      subcommands: [Claude.self, Codex.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct RemoveAgentHook: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "remove-hook",
      abstract: "Remove Supaterm's hook bridge for a coding agent.",
      discussion: SPHelp.removeAgentHookDiscussion,
      subcommands: [Claude.self, Codex.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP.InstallAgentHook {
  struct Claude: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Install Supaterm's Claude hook bridge.",
      discussion: SPHelp.installAgentHookClaudeDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try sendAgentHookRequests(
        agents: [.claude],
        connection: connection,
        request: { try .hooksInstall($0) }
      )
    }
  }

  struct Codex: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex",
      abstract: "Install Supaterm's Codex hook bridge.",
      discussion: SPHelp.installAgentHookCodexDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try sendAgentHookRequests(
        agents: [.codex],
        connection: connection,
        request: { try .hooksInstall($0) }
      )
    }
  }
}

extension SP.RemoveAgentHook {
  struct Claude: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Remove Supaterm's Claude hook bridge.",
      discussion: SPHelp.removeAgentHookClaudeDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try sendAgentHookRequests(
        agents: [.claude],
        connection: connection,
        request: { try .hooksRemove($0) }
      )
    }
  }

  struct Codex: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex",
      abstract: "Remove Supaterm's Codex hook bridge.",
      discussion: SPHelp.removeAgentHookCodexDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try sendAgentHookRequests(
        agents: [.codex],
        connection: connection,
        request: { try .hooksRemove($0) }
      )
    }
  }
}

extension SP {
  struct AgentSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "agent-settings",
      abstract: "Print canonical Supaterm agent hook settings.",
      discussion: SPHelp.agentSettingsDiscussion,
      subcommands: [ClaudeHookSettings.self, CodexHookSettings.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ClaudeHookSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Print the canonical Claude hook settings JSON."
    )

    mutating func run() throws {
      print(try SupatermClaudeHookSettings.jsonString())
    }
  }

  struct CodexHookSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex",
      abstract: "Print the canonical Codex hook settings JSON."
    )

    mutating func run() throws {
      print(try SupatermCodexHookSettings.jsonString())
    }
  }
}

private func agentHookEvent(from data: Data) throws -> SupatermAgentHookEvent {
  guard !data.isEmpty else {
    throw ValidationError("Agent hook input must be valid hook JSON.")
  }

  do {
    return try JSONDecoder().decode(SupatermAgentHookEvent.self, from: data)
  } catch {
    throw ValidationError("Agent hook input must be valid hook JSON.")
  }
}

private func renderAgentDetectionReload(
  _ result: SupatermAgentDetectionReloadResult
) -> String {
  ([
    "generation\t\(result.generation)",
    "override-directory\t\(result.overrideDirectory)",
  ]
    + result.manifests.map { manifest in
      "manifest\t\(manifest.agentID)\t\(manifest.version ?? "unknown")\t\(manifest.origin.rawValue)\t\(manifest.path)"
    }).joined(separator: "\n")
}

private func renderAgentDetectionExplanation(
  _ result: SupatermAgentDetectionExplainResult
) -> String {
  var lines = [
    "pane\t\(result.target.paneID.uuidString.lowercased())",
    "status\t\(result.status.rawValue)",
    "generation\t\(result.generation.map(String.init) ?? "unknown")",
    "agent\t\(result.agentID ?? "unknown")",
    "agent-name\t\(result.displayName ?? "unknown")",
    "phase\t\(result.phase?.rawValue ?? "unknown")",
    "matched-rule\t\(result.matchedRuleID ?? "none")",
    "published-rule\t\(result.publishedRuleID ?? "none")",
  ]
  if let process = result.process {
    lines.append("process\t\(process.processID)\t\(process.startTimeMicroseconds)")
  } else {
    lines.append("process\tnone")
  }
  if let manifest = result.manifest {
    lines.append(
      "manifest\t\(manifest.version ?? "unknown")\t\(manifest.origin.rawValue)\t\(manifest.path)"
    )
  }
  for rule in result.rules {
    lines.append(
      [
        "rule",
        rule.matched ? "match" : "miss",
        String(rule.priority),
        rule.state.rawValue,
        rule.region,
        rule.ruleID,
      ].joined(separator: "\t")
    )
    lines += renderAgentDetectionCondition(rule.condition, depth: 1)
  }
  return lines.joined(separator: "\n")
}

private func renderAgentDetectionCondition(
  _ condition: SupatermAgentDetectionConditionEvidence,
  depth: Int
) -> [String] {
  let prefix = String(repeating: "  ", count: depth)
  let value = condition.value.map { "\t\(renderAgentDetectionValue($0))" } ?? ""
  return ["\(prefix)\(condition.kind)\t\(condition.matched ? "match" : "miss")\(value)"]
    + condition.children.flatMap { renderAgentDetectionCondition($0, depth: depth + 1) }
}

private func renderAgentDetectionValue(_ value: String) -> String {
  value
    .replacingOccurrences(of: "\\", with: "\\\\")
    .replacingOccurrences(of: "\t", with: "\\t")
    .replacingOccurrences(of: "\r", with: "\\r")
    .replacingOccurrences(of: "\n", with: "\\n")
}

private func sendAgentHookRequests(
  agents: [SupatermAgentKind],
  connection: SPConnectionOptions,
  request: (SupatermAgentHookTargetRequest) throws -> SupatermSocketRequest
) throws {
  let client = try socketClient(
    path: connection.explicitSocketPath,
    instance: connection.instance,
    responseTimeout: SupatermAgentHookManagementTiming.clientResponseTimeout
  )
  for agent in agents {
    let response = try client.send(try request(SupatermAgentHookTargetRequest(agent: agent)))
    guard response.ok else {
      throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
    }
  }
}

extension SupatermAgentKind: @retroactive ExpressibleByArgument {}
