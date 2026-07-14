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
        InstallAgentHook.self,
        RemoveAgentHook.self,
        ReceiveAgentHook.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct InstallAgentHooks: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "install-hooks",
      abstract: "Install Supaterm's hook bridge for every supported coding agent.",
      discussion: SPHelp.installAgentHooksDiscussion
    )

    mutating func run() throws {
      var failures: [String] = []
      for agent in supportedHookAgents {
        do {
          try installSupatermHooks(for: agent)
        } catch {
          failures.append("\(agent.rawValue): \(error.localizedDescription)")
        }
      }

      guard failures.isEmpty else {
        FileHandle.standardError.write(Data((failures.joined(separator: "\n") + "\n").utf8))
        throw ExitCode.failure
      }
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
        instance: connection.instance,
        discoveryPolicy: .always
      )
      let response = try client.send(
        .agentHook(
          .init(
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

    mutating func run() throws {
      do {
        try installSupatermHooks(for: .claude)
      } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        throw ExitCode.failure
      }
    }
  }

  struct Codex: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex",
      abstract: "Install Supaterm's Codex hook bridge.",
      discussion: SPHelp.installAgentHookCodexDiscussion
    )

    mutating func run() throws {
      do {
        try installSupatermHooks(for: .codex)
      } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        throw ExitCode.failure
      }
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

    mutating func run() throws {
      do {
        try ClaudeSettingsInstaller(homeDirectoryURL: cliHomeDirectoryURL()).removeSupatermHooks()
      } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        throw ExitCode.failure
      }
    }
  }

  struct Codex: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex",
      abstract: "Remove Supaterm's Codex hook bridge.",
      discussion: SPHelp.removeAgentHookCodexDiscussion
    )

    mutating func run() throws {
      do {
        try CodexSettingsInstaller(homeDirectoryURL: cliHomeDirectoryURL()).removeSupatermHooks()
      } catch {
        FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
        throw ExitCode.failure
      }
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

private let supportedHookAgents: [SupatermAgentKind] = [.claude, .codex]

private func installSupatermHooks(for agent: SupatermAgentKind) throws {
  switch agent {
  case .claude:
    try ClaudeSettingsInstaller(homeDirectoryURL: cliHomeDirectoryURL()).installSupatermHooks()
  case .codex:
    try CodexSettingsInstaller(homeDirectoryURL: cliHomeDirectoryURL()).installSupatermHooks()
  case .pi:
    throw ValidationError("Pi does not use Supaterm hook settings.")
  }
}

extension SupatermAgentKind: @retroactive ExpressibleByArgument {}
