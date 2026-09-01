import Foundation

public struct TerminalCodingAgent: Equatable, Sendable {
  public let id: String
  public let markImageName: String
  public let processes: [AgentDetectionProcessRule]
}

public enum TerminalCodingAgentCatalog {
  public static let all: [TerminalCodingAgent] = [
    agent("amp", mark: "amp-mark", commands: ["amp", "amp.exe"]),
    agent("antigravity", mark: "antigravity-mark", commands: ["agy", "antigravity"]),
    agent(
      "claude",
      mark: "claude-code-mark",
      commands: ["claude", "claude.exe"],
      scripts: ["@anthropic-ai/claude-code/cli.js"]
    ),
    agent(
      "cline",
      mark: "cline-mark",
      commands: ["cline", "clite"],
      scripts: ["@cline/cli/bin/clite"]
    ),
    agent(
      "codex",
      mark: "codex-mark",
      commands: ["codex", "codex-aarch64-apple-darwin", "codex-x86_64-apple-darwin"]
    ),
    agent(
      "copilot",
      mark: "copilot-mark",
      commands: ["copilot", "copilot.exe"],
      scripts: ["@github/copilot/npm-loader.js"]
    ),
    agent("cursor", mark: "cursor-mark", commands: ["cursor-agent", "cursor-agent.exe"]),
    agent(
      "gemini",
      mark: "geminicli-mark",
      commands: ["gemini"],
      scripts: ["@google/gemini-cli/bundle/gemini.js"]
    ),
    agent("goose", mark: "goose-mark", commands: ["goose"]),
    agent("grok", mark: "grok-mark", commands: ["grok"]),
    agent("hermes", mark: "hermesagent-mark", commands: ["hermes"]),
    agent("kimi", mark: "kimi-mark", commands: ["kimi", "kimi-cli"]),
    agent("opencode", mark: "opencode-mark", commands: ["opencode", "opencode.exe"]),
    agent(
      "pi",
      mark: "pi-mark",
      commands: ["pi"],
      scripts: [
        "@mariozechner/pi-coding-agent/dist/cli.js",
        "@earendil-works/pi-coding-agent/dist/cli.js",
      ]
    ),
    agent(
      "qwen",
      mark: "qwen-mark",
      commands: ["qwen"],
      scripts: ["@qwen-code/qwen-code/cli-entry.js"]
    ),
  ]

  public static var processManifests: [AgentDetectionProcessManifest] {
    all.map {
      AgentDetectionProcessManifest(agentID: $0.id, processes: $0.processes)
    }
  }

  public static func markImageName(for agentID: String) -> String? {
    all.first { $0.id == agentID }?.markImageName
  }

  public static func merging(
    _ manifests: [AgentDetectionProcessManifest]
  ) -> [AgentDetectionProcessManifest] {
    Dictionary(grouping: processManifests + manifests, by: \.agentID)
      .map { agentID, manifests in
        AgentDetectionProcessManifest(
          agentID: agentID,
          processes: Array(Set(manifests.flatMap(\.processes))).sorted {
            (
              $0.executable, $0.processTitle ?? "", $0.launchCommand ?? "",
              $0.argumentPathSuffix ?? ""
            )
              < (
                $1.executable, $1.processTitle ?? "", $1.launchCommand ?? "",
                $1.argumentPathSuffix ?? ""
              )
          }
        )
      }
      .sorted { $0.agentID < $1.agentID }
  }

  private static let scriptExecutables = [
    "bun", "deno", "node", "python", "python3", "python3.11", "python3.12", "python3.13",
    "python3.14",
  ]

  private static func agent(
    _ id: String,
    mark: String,
    commands: [String],
    scripts: [String] = []
  ) -> TerminalCodingAgent {
    TerminalCodingAgent(
      id: id,
      markImageName: mark,
      processes: commands.map { AgentDetectionProcessRule(executable: $0) }
        + scriptExecutables.flatMap { executable in
          commands.map {
            AgentDetectionProcessRule(executable: executable, launchCommand: $0)
          }
        }
        + scriptExecutables.flatMap { executable in
          scripts.map {
            AgentDetectionProcessRule(executable: executable, argumentPathSuffix: $0)
          }
        }
    )
  }
}
