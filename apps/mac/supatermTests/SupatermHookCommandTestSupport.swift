func expectedSupatermHookCommand(agent: String) -> String {
  [
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] &&"#,
    #""$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent) ||"#,
    #"cat >/dev/null || true"#,
  ].joined(separator: " ")
}
