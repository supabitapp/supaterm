import Foundation

public struct SupatermManagedHookCommandPolicy: Sendable {
  public let command: String
  private let legacyCommands: Set<String>

  fileprivate init(command: String, legacyCommands: Set<String>) {
    self.command = command
    self.legacyCommands = legacyCommands
  }

  public func matches(_ candidate: String?) -> Bool {
    guard let candidate else { return false }
    let command = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
    return command == self.command || legacyCommands.contains(command)
  }
}

public enum SupatermManagedHookCommand {
  public static func policy(
    for agent: SupatermAgentKind,
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser
  ) -> SupatermManagedHookCommandPolicy {
    if agent == .codex {
      return SupatermManagedHookCommandPolicy(
        command: SupatermCodexHookBridge.command(homeDirectoryURL: homeDirectoryURL),
        legacyCommands: Set(SupatermCodexHookBridge.legacyCommands)
      )
    }
    let directCommand = bridgeCommand(for: agent)
    return SupatermManagedHookCommandPolicy(
      command: #"exec /bin/sh -c '\#(directCommand)'"#,
      legacyCommands: [directCommand]
    )
  }

  private static func bridgeCommand(for agent: SupatermAgentKind) -> String {
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook "#
      + #"--agent \#(agent.rawValue) --pid "$PPID" || cat >/dev/null || true"#
  }
}
