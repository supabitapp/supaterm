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
        SetupAgentIntegrations.self,
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

  struct SetupAgentIntegrations: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "setup",
      abstract: "Install Supaterm's skill and managed coding-agent hooks.",
      discussion: SPHelp.setupAgentIntegrationsDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try manageAgentIntegrations(
        .setupDetected,
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
    var agent: SupatermManagedAgentKind

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
      abstract: "Remove Supaterm's managed coding-agent hooks.",
      discussion: SPHelp.removeAgentHooksDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try manageAgentIntegrations(
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

private enum AgentIntegrationManagementOperation {
  case setupDetected
  case removeAll

  func request(for target: SupatermAgentIntegrationRequest) throws -> SupatermSocketRequest {
    switch self {
    case .setupDetected:
      try .agentIntegrationSetup(target)
    case .removeAll:
      try .hooksRemove(target)
    }
  }

  func disposition(for health: CodingAgentIntegrationHealth) -> AgentIntegrationDisposition {
    switch self {
    case .setupDetected:
      switch health {
      case .healthy:
        return .success
      case .unavailable:
        return .notDetected
      case .unavailableInstalled, .absent, .partial, .drifted:
        return .failure("Expected a healthy integration, got \(health.rawValue).")
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

  func emitProgress(
    for agent: SupatermManagedAgentKind,
    disposition: AgentIntegrationDisposition? = nil
  ) {
    guard case .setupDetected = self else {
      return
    }
    let message =
      switch disposition {
      case nil:
        "Setting up \(agent.notificationTitle)..."
      case .success:
        "\(agent.notificationTitle): ready"
      case .notDetected:
        "\(agent.notificationTitle): not detected"
      case .failure:
        "\(agent.notificationTitle): failed"
      }
    FileHandle.standardOutput.write(Data("\(message)\n".utf8))
  }

  func prepare(client: SPSocketClient) throws {
    guard case .setupDetected = self else { return }
    FileHandle.standardOutput.write(Data("Installing Supaterm skill...\n".utf8))
    do {
      let response = try client.send(.skillsInstall())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      _ = try response.decodeResult(SupatermSkillInstallResult.self)
      FileHandle.standardOutput.write(Data("Supaterm skill: ready\n".utf8))
    } catch {
      FileHandle.standardOutput.write(Data("Supaterm skill: failed\n".utf8))
      throw error
    }
  }
}

private enum AgentIntegrationDisposition {
  case success
  case notDetected
  case failure(String)
}

private func manageAgentIntegrations(
  _ operation: AgentIntegrationManagementOperation,
  agents: [SupatermManagedAgentKind] = SupatermManagedAgentKind.allCases,
  connection: SPConnectionOptions
) throws {
  let client = try socketClient(
    path: connection.explicitSocketPath,
    instance: connection.instance,
    responseTimeout: SupatermAgentIntegrationTiming.clientResponseTimeout
  )
  try operation.prepare(client: client)
  var failures: [String] = []
  var didSucceed = false
  for agent in agents {
    operation.emitProgress(for: agent)
    let disposition = agentIntegrationDisposition(
      operation: operation,
      agent: agent,
      client: client
    )
    operation.emitProgress(for: agent, disposition: disposition)
    switch disposition {
    case .success:
      didSucceed = true
    case .failure(let message):
      failures.append("\(agent.notificationTitle): \(message)")
    case .notDetected:
      break
    }
  }
  guard failures.isEmpty else {
    throw ValidationError(failures.joined(separator: "\n"))
  }
  if case .setupDetected = operation,
    !agents.isEmpty,
    !didSucceed
  {
    throw ValidationError("Neither Claude nor Codex was detected.")
  }
}

private func agentIntegrationDisposition(
  operation: AgentIntegrationManagementOperation,
  agent: SupatermManagedAgentKind,
  client: SPSocketClient
) -> AgentIntegrationDisposition {
  do {
    let target = SupatermAgentIntegrationRequest(agent: agent)
    let response = try client.send(try operation.request(for: target))
    guard response.ok else {
      return .failure(response.error?.message ?? "Supaterm socket request failed.")
    }
    let result = try response.decodeResult(SupatermAgentIntegrationResult.self)
    guard result.agent == agent else {
      return .failure(
        "Supaterm returned status for \(result.agent.notificationTitle), expected \(agent.notificationTitle)."
      )
    }
    return operation.disposition(for: result.health)
  } catch {
    return .failure(error.localizedDescription)
  }
}

extension SupatermManagedAgentKind: @retroactive ExpressibleByArgument {}
