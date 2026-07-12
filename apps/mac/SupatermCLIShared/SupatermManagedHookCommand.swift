public enum SupatermManagedHookCommand {
  public static func receiveHookCommand(for agent: SupatermAgentKind) -> String {
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook "#
      + #"--agent \#(agent.rawValue) --pid "$PPID" || cat >/dev/null || true"#
  }

  public static func installArguments(for agent: SupatermAgentKind) -> [String] {
    ["agent", "install-hook", agent.rawValue]
  }
}
