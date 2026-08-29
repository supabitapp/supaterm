func expectedSupatermHookCommand(agent: String) -> String {
  if agent == "codex" {
    return #"exec /bin/sh -c '/bin/sh "$HOME/.codex/supaterm-agent-state.sh" "$PPID" || cat >/dev/null || true'"#
  }
  let command = [
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] &&"#,
    #""$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent) --pid "$PPID" ||"#,
    #"cat >/dev/null || true"#,
  ].joined(separator: " ")
  return #"exec /bin/sh -c '\#(command)'"#
}

func legacySupatermHookCommand(agent: String) -> String {
  [
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] &&"#,
    #""$SUPATERM_CLI_PATH" agent receive-agent-hook --agent \#(agent) --pid "$PPID" ||"#,
    #"cat >/dev/null || true"#,
  ].joined(separator: " ")
}
