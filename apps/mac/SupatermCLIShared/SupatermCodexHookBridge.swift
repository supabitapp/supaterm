import Foundation

public enum SupatermCodexHookBridge {
  public static let relativePath = ".codex/supaterm-agent-state.sh"

  public static var command: String {
    #"exec /bin/sh -c '/bin/sh "$HOME/\#(relativePath)" "$PPID" || cat >/dev/null || true'"#
  }

  public static var legacyCommands: [String] {
    let command = legacyCommand
    return [#"exec /bin/sh -c '\#(command)'"#, command]
  }

  public static func url(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL.appendingPathComponent(relativePath, isDirectory: false)
  }

  public static func data(cliPath: String) -> Data {
    let fallbackCLIPath = SupatermShellCommand.escapedToken(cliPath)
    return Data(
      """
      cli_path=${SUPATERM_CLI_PATH:-}
      if [ ! -x "$cli_path" ]; then
        cli_path=\(fallbackCLIPath)
      fi
      if [ -x "$cli_path" ]; then
        "$cli_path" agent receive-agent-hook --agent codex --pid "$1" && exit 0
      fi
      cat >/dev/null

      """.utf8
    )
  }

  private static var legacyCommand: String {
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook "#
      + #"--agent codex --pid "$PPID" || cat >/dev/null || true"#
  }
}
