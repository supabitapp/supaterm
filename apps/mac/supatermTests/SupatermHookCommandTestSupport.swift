func expectedSupatermHookCommand(agent: String) -> String {
  [
    #"if [ -x "${SUPATERM_CLI_PATH:-}" ]; then"#,
    #""$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent) || cat >/dev/null;"#,
    #"else cat >/dev/null; fi || true"#,
  ].joined(separator: " ")
}
