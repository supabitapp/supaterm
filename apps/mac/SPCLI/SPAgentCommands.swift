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
        InstallAgentHooks.self,
        ReloadAgentDetectionRules.self,
        RemoveAgentHooks.self,
        ReceiveAgentHook.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
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
      try manageAgentHooks(
        .installDetected,
        connection: connection,
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

  struct RemoveAgentHooks: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "remove-hooks",
      abstract: "Remove Supaterm's hook bridge from every supported coding agent.",
      discussion: SPHelp.removeAgentHooksDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try manageAgentHooks(
        .removeAll,
        connection: connection,
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
      guard let cliPath = SPExecutable.currentPath() else {
        throw ValidationError("Supaterm could not resolve the sp executable path.")
      }
      print(try SupatermCodexHookSettings.jsonString(cliPath: cliPath))
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

private enum AgentHookManagementOperation {
  case installDetected
  case removeAll

  func request(for target: SupatermAgentHookTargetRequest) throws -> SupatermSocketRequest {
    switch self {
    case .installDetected:
      try .hooksInstall(target)
    case .removeAll:
      try .hooksRemove(target)
    }
  }

  func disposition(for health: CodingAgentIntegrationHealth) -> AgentHookDisposition {
    switch self {
    case .installDetected:
      switch health {
      case .healthy:
        return .success
      case .unavailable:
        return .notDetected
      case .unavailableInstalled, .absent, .partial, .drifted:
        return .failure("Expected a healthy hook integration, got \(health.rawValue).")
      }
    case .removeAll:
      switch health {
      case .absent, .unavailable:
        return .success
      case .unavailableInstalled, .partial, .drifted, .healthy:
        return .failure("Expected hooks to be absent, got \(health.rawValue).")
      }
    }
  }
}

private enum AgentHookDisposition: Equatable {
  case success
  case notDetected
  case failure(String)
}

private func manageAgentHooks(
  _ operation: AgentHookManagementOperation,
  agents: [SupatermAgentKind] = SupatermAgentKind.allCases,
  connection: SPConnectionOptions
) throws {
  let client = try socketClient(
    path: connection.explicitSocketPath,
    instance: connection.instance,
    responseTimeout: SupatermAgentHookManagementTiming.clientResponseTimeout
  )
  var failures: [String] = []
  var dispositions: [AgentHookDisposition] = []
  for agent in agents {
    do {
      let target = SupatermAgentHookTargetRequest(agent: agent)
      let response = try client.send(try operation.request(for: target))
      guard response.ok else {
        let message = response.error?.message ?? "Supaterm socket request failed."
        failures.append("\(agent.notificationTitle): \(message)")
        dispositions.append(.failure(message))
        continue
      }
      let result = try response.decodeResult(SupatermAgentHookHealth.self)
      guard result.agent == agent else {
        let message =
          "Supaterm returned status for \(result.agent.notificationTitle), expected \(agent.notificationTitle)."
        failures.append("\(agent.notificationTitle): \(message)")
        dispositions.append(.failure(message))
        continue
      }
      let disposition = operation.disposition(for: result.health)
      switch disposition {
      case .success, .notDetected:
        dispositions.append(disposition)
      case .failure(let message):
        failures.append("\(agent.notificationTitle): \(message)")
        dispositions.append(.failure(message))
      }
    } catch {
      let message = error.localizedDescription
      failures.append("\(agent.notificationTitle): \(message)")
      dispositions.append(.failure(message))
    }
  }
  guard failures.isEmpty else {
    throw ValidationError(failures.joined(separator: "\n"))
  }
  if case .installDetected = operation,
    !dispositions.isEmpty,
    dispositions.allSatisfy({ $0 == .notDetected })
  {
    throw ValidationError("No supported coding agent was detected.")
  }
}

extension SupatermAgentKind: @retroactive ExpressibleByArgument {}
