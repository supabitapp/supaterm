import Foundation

public struct SupatermManagedHookCommandPolicy: Sendable {
  private let exactCommands: Set<String>
  private let recognizesCodexCommands: Bool

  fileprivate init(
    exactCommands: Set<String>,
    recognizesCodexCommands: Bool
  ) {
    self.exactCommands = exactCommands
    self.recognizesCodexCommands = recognizesCodexCommands
  }

  public func matches(_ candidate: String?) -> Bool {
    guard let candidate else { return false }
    let command = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
    return exactCommands.contains(command)
      || (recognizesCodexCommands && SupatermManagedHookCommand.isCodexCommand(command))
  }
}

public enum SupatermManagedHookCommandError: Error, Equatable {
  case invalidCLIPath
}

public enum SupatermManagedHookCommand {
  private static let codexCommandPrefix =
    #"exec /bin/sh -c 'if [ -x "$1" ]; then "$1" agent receive-agent-hook --agent codex "#
    + #"--pid "$PPID" && exit 0; fi; /bin/cat >/dev/null' supaterm-codex-hook-v1 "#

  public static func policy(for agent: SupatermAgentKind) -> SupatermManagedHookCommandPolicy {
    return SupatermManagedHookCommandPolicy(
      exactCommands: [receiveHookCommand(for: agent)],
      recognizesCodexCommands: agent == .codex
    )
  }

  public static func codexCommand(cliPath: String) throws -> String {
    codexCommandPrefix
      + SupatermShellCommand.escapedToken(try canonicalCodexCLIPath(cliPath))
  }

  public static func receiveHookCommand(for agent: SupatermAgentKind) -> String {
    #"[ -x "${SUPATERM_CLI_PATH:-}" ] && "$SUPATERM_CLI_PATH" agent receive-agent-hook "#
      + #"--agent \#(agent.rawValue) --pid "$PPID" || cat >/dev/null || true"#
  }

  fileprivate static func isCodexCommand(_ command: String) -> Bool {
    guard command.hasPrefix(codexCommandPrefix) else { return false }
    let token = String(command.dropFirst(codexCommandPrefix.count))
    guard let path = unescapedToken(token) else { return false }
    guard path == URL(fileURLWithPath: path).standardizedFileURL.path else { return false }
    guard URL(fileURLWithPath: path).lastPathComponent == "sp" else { return false }
    return path.hasPrefix("/") && SupatermShellCommand.escapedToken(path) == token
  }

  private static func canonicalCodexCLIPath(_ cliPath: String) throws -> String {
    guard
      !cliPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      cliPath.hasPrefix("/")
    else {
      throw SupatermManagedHookCommandError.invalidCLIPath
    }
    let path = URL(fileURLWithPath: cliPath).standardizedFileURL.path
    guard URL(fileURLWithPath: path).lastPathComponent == "sp" else {
      throw SupatermManagedHookCommandError.invalidCLIPath
    }
    return path
  }

  private static func unescapedToken(_ token: String) -> String? {
    guard !token.isEmpty else { return nil }
    guard token.hasPrefix("'") else { return token }
    guard token.hasSuffix("'") else { return nil }
    return token.dropFirst().dropLast().replacingOccurrences(of: "'\"'\"'", with: "'")
  }
}
