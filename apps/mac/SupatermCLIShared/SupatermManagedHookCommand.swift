public enum SupatermManagedHookCommand {
  public static func receiveHookCommand(for agent: SupatermAgentKind) -> String {
    if agent == .codex {
      return SupatermCodexHookBridge.command
    }
    let command = bridgeCommand(for: agent)
    return #"exec /bin/sh -c '\#(command)'"#
  }

  public static func matchesReceiveHookCommand(
    _ command: String,
    for agent: SupatermAgentKind
  ) -> Bool {
    if agent == .codex {
      return command == SupatermCodexHookBridge.command
        || SupatermCodexHookBridge.legacyCommands.contains(command)
    }
    return command == receiveHookCommand(for: agent)
      || command == bridgeCommand(for: agent)
  }

  private static func bridgeCommand(for agent: SupatermAgentKind) -> String {
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook "#
      + #"--agent \#(agent.rawValue) --pid "$PPID" || cat >/dev/null || true"#
  }
}
