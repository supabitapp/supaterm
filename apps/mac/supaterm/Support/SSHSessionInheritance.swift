import Darwin
import Foundation
import SupatermCLIShared

public enum SSHSessionInheritance {
  typealias InvocationProvider = @Sendable (pid_t) -> ProcessInvocation?

  public static func startupCommand(
    zmxSessionName: String,
    cliPath: String?
  ) -> String? {
    startupCommand(
      zmxSessionName: zmxSessionName,
      cliPath: cliPath,
      table: .snapshot(),
      invocation: { ProcessTable.invocation(forProcessID: $0) }
    )
  }

  static func startupCommand(
    zmxSessionName: String,
    cliPath: String?,
    table: ProcessTable,
    invocation: InvocationProvider
  ) -> String? {
    for candidate in table.foregroundGroup(
      inZmxSession: zmxSessionName,
      invocation: invocation
    ) {
      guard
        let process = invocation(candidate.processID),
        let command = SupatermSSHCommand.commandLine(
          forArguments: process.arguments,
          terminalType: process.terminalType,
          cliPath: cliPath
        )
      else {
        continue
      }
      return SupatermShellCommand.interactiveStartupCommand(for: command)
    }

    return nil
  }
}
