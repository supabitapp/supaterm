import Foundation

public enum SupatermCodexHookBridge {
  private static let relativePath = ".codex/supaterm-agent-state.sh"

  public static func command(homeDirectoryURL: URL) -> String {
    let path = SupatermShellCommand.escapedToken(url(homeDirectoryURL: homeDirectoryURL).path)
    let script = #"if [ -r "$1" ]; then exec /bin/sh "$1"; else cat >/dev/null; fi"#
    return #"exec /bin/sh -c '\#(script)' _ \#(path)"#
  }

  static var legacyCommands: [String] {
    let directCommand = legacyDirectCommand
    return [legacyHomeCommand, #"exec /bin/sh -c '\#(directCommand)'"#, directCommand]
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
        "$cli_path" agent receive-agent-hook --agent codex --pid "$PPID" && exit 0
      fi
      cat >/dev/null

      """.utf8
    )
  }

  private static var legacyHomeCommand: String {
    #"exec /bin/sh -c '/bin/sh "$HOME/\#(relativePath)" "$PPID" || cat >/dev/null || true'"#
  }

  private static var legacyDirectCommand: String {
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook "#
      + #"--agent codex --pid "$PPID" || cat >/dev/null || true"#
  }
}
