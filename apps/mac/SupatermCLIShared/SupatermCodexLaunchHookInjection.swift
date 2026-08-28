import Foundation

public enum SupatermCodexLaunchHookInjection {
  public static func arguments(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    processID: Int32
  ) -> [String]? {
    guard processID > 0,
      let context = SupatermCLIContext(environment: environment),
      let cliPath = normalized(environment[SupatermCLIEnvironment.cliPathKey]),
      let socketPath = SupatermSocketPath.normalized(
        environment[SupatermCLIEnvironment.socketPathKey]
      )
    else {
      return nil
    }

    let command = launchBoundReceiveHookCommand(
      cliPath: cliPath,
      socketPath: socketPath,
      context: context,
      processID: processID
    )
    let sessionStartOverride =
      #"hooks.SessionStart=[{hooks=[{type="command",command=""#
      + tomlEscaped(command)
      + #"",timeout=10}]}]"#
    return [
      "--enable",
      "hooks",
      "--dangerously-bypass-hook-trust",
      "-c",
      sessionStartOverride,
    ]
  }

  public static func launchBoundReceiveHookCommand(
    cliPath: String,
    socketPath: String,
    context: SupatermCLIContext,
    processID: Int32
  ) -> String {
    [
      shellQuoted(cliPath),
      "agent receive-agent-hook",
      "--agent codex",
      "--pid \(processID)",
      "--surface-id \(shellQuoted(context.surfaceID.uuidString))",
      "--tab-id \(shellQuoted(context.tabID.uuidString))",
      "--launch-bound",
      "--socket \(shellQuoted(socketPath))",
      "|| cat >/dev/null || true",
    ].joined(separator: " ")
  }

  private static func normalized(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmed.isEmpty
    else {
      return nil
    }
    return trimmed
  }

  private static func shellQuoted(_ value: String) -> String {
    "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
  }

  private static func tomlEscaped(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\r", with: "\\r")
      .replacingOccurrences(of: "\t", with: "\\t")
  }
}
