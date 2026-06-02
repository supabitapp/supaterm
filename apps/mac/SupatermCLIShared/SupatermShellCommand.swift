import Darwin
import Foundation

public enum SupatermShellCommand {
  public static func ghosttyStartupCommand(for script: String) -> String {
    ghosttyStartupCommand(for: script, shellPath: loginShellPath())
  }

  public static func ghosttyStartupCommand(for script: String, shellPath: String) -> String {
    let shellPath = normalizedShellPath(shellPath) ?? "/bin/zsh"
    return ([shellPath] + loginShellCommandArguments(for: script))
      .map(escapedToken)
      .joined(separator: " ")
  }

  public static func interactiveStartupCommand(for command: String) -> String {
    interactiveStartupCommand(for: command, shellPath: loginShellPath())
  }

  public static func interactiveStartupCommand(for command: String, shellPath: String) -> String {
    let shellPath = normalizedShellPath(shellPath) ?? "/bin/zsh"
    if shellPath.hasSuffix("/fish") {
      return [
        command,
        #"set -l shell "$SHELL""#,
        #"if test -z "$shell"; set shell \#(shellPath); end"#,
        #"if not test -x "$shell"; set shell \#(shellPath); end"#,
        #"exec "$shell" -l"#,
      ].joined(separator: "; ")
    }

    return [
      command,
      #"shell="${SHELL:-\#(shellPath)}""#,
      #"[ -x "$shell" ] || shell="\#(shellPath)""#,
      #"if "$shell" -l -c 'exit 0' >/dev/null 2>&1; then exec "$shell" -l; fi"#,
      #"exec "$shell""#,
    ].joined(separator: "; ")
  }

  static func loginShellCommandArguments(for command: String) -> [String] {
    ["-l", "-i", "-c", command]
  }

  static func loginShellPath(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    currentUserShellPath: String? = currentUserShellPath()
  ) -> String {
    normalizedShellPath(currentUserShellPath)
      ?? normalizedShellPath(environment["SHELL"])
      ?? "/bin/zsh"
  }

  public static func escapedToken(_ token: String) -> String {
    guard !token.isEmpty else { return "''" }

    let safeScalars = CharacterSet(
      charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%_+=:,./-")
    if token.unicodeScalars.allSatisfy(safeScalars.contains) {
      return token
    }

    return "'\(token.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
  }

  private static func currentUserShellPath() -> String? {
    guard let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell else {
      return nil
    }
    return String(cString: shell)
  }

  private static func normalizedShellPath(_ path: String?) -> String? {
    guard let path = path?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty else {
      return nil
    }
    return path
  }
}
