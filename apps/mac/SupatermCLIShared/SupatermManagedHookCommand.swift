public enum SupatermManagedHookCommand {
  public static func receiveHookCommand(for agent: SupatermManagedAgentKind) -> String {
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook "#
      + #"--agent \#(agent.rawValue) --pid "$PPID" || cat >/dev/null || true"#
  }
}
