import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSSHCommandTests {
  private static let cliPath = "/Applications/supaterm.app/Contents/MacOS/sp"

  @Test
  func parsesCommonInteractiveSessionOptionsWithoutRemoteCommands() {
    let arguments = [
      "-i", "~/.ssh/work",
      "-o", "ProxyJump=bastion.example.com",
      "-p2222",
      "-tt",
      "user@example.com",
    ]

    #expect(SupatermSSHCommand.sessionArguments(arguments) == arguments)
    #expect(SupatermSSHCommand.sessionArguments(arguments + ["uptime"]) == nil)
  }

  @Test
  func routesTheInheritedSessionThroughTheBundledCLI() {
    let command = commandLine(
      arguments: [
        "/usr/bin/ssh",
        "-o", "SendEnv=COLORTERM",
        "-o", "SendEnv=TERM_PROGRAM",
        "-o", "SendEnv=TERM_PROGRAM_VERSION",
        "-o", "SetEnv=PRODUCT=custom",
        "-p", "2222",
        "dev@example.com",
      ],
      terminalType: "xterm-custom",
      cliPath: Self.cliPath
    )

    let expected =
      "/usr/bin/env \(Self.cliPath) internal ssh --term xterm-custom --ssh /usr/bin/ssh -- "
      + "-o SetEnv=PRODUCT=custom -p 2222 dev@example.com"
    #expect(command == expected)
  }

  @Test
  func preservesCustomSSHExecutableAndTerminalType() {
    let command = commandLine(
      arguments: ["/opt/custom/client"] + SupatermSSHCommand.forwardedEnvironmentOptions
        + ["dev@example.com"],
      terminalType: "vt100-custom",
      cliPath: Self.cliPath
    )

    #expect(
      command
        == "/usr/bin/env \(Self.cliPath) internal ssh --term vt100-custom --ssh /opt/custom/client -- dev@example.com"
    )
  }

  @Test
  func stripsOnlyTheInjectedLeadingForwardingOptions() {
    let command = commandLine(
      arguments: ["/usr/bin/ssh"] + SupatermSSHCommand.forwardedEnvironmentOptions
        + ["-o", "SendEnv=COLORTERM", "dev@example.com"],
      cliPath: Self.cliPath
    )

    #expect(
      command
        == "/usr/bin/env \(Self.cliPath) internal ssh --ssh /usr/bin/ssh -- -o SendEnv=COLORTERM dev@example.com"
    )
  }

  @Test
  func preservesTheOriginalInvocationWithoutTheBundledCLI() {
    let command = commandLine(
      arguments: ["/usr/bin/ssh"] + SupatermSSHCommand.forwardedEnvironmentOptions
        + ["-p", "2222", "dev@example.com"],
      terminalType: "xterm-custom"
    )

    let expected =
      "/usr/bin/env TERM=xterm-custom /usr/bin/ssh -o SendEnv=COLORTERM "
      + "-o SendEnv=TERM_PROGRAM -o SendEnv=TERM_PROGRAM_VERSION -p 2222 dev@example.com"
    #expect(command == expected)
  }

  @Test
  func quotesOptionValuesThatNeedIt() {
    let command = commandLine(
      arguments: ["ssh", "-o", "ProxyCommand=nc %h %p", "example.com"]
    )

    #expect(command == "/usr/bin/env ssh -o 'ProxyCommand=nc %h %p' example.com")
  }

  @Test
  func keepsFlagsClusteredWithTheirValue() {
    let command = commandLine(
      arguments: ["ssh", "-tt", "-p2222", "-4", "example.com"]
    )

    #expect(command == "/usr/bin/env ssh -tt -p2222 -4 example.com")
  }

  @Test
  func refusesInvocationsThatCarryARemoteCommand() {
    #expect(commandLine(arguments: ["ssh", "example.com", "echo hi"]) == nil)
    #expect(
      commandLine(
        arguments: ["ssh"] + SupatermSSHCommand.forwardedEnvironmentOptions
          + ["example.com", "-o", "SendEnv=COLORTERM"]
      ) == nil
    )
    #expect(
      commandLine(
        arguments: ["ssh", "-o", "ControlPath=none", "example.com", "git-upload-pack '/repo'"]
      ) == nil
    )
  }

  @Test
  func refusesInvocationsThatOpenNoSession() {
    #expect(
      commandLine(arguments: ["ssh", "-N", "-L", "8080:localhost:8080", "example.com"])
        == nil
    )
    #expect(commandLine(arguments: ["ssh", "-f", "-D", "1080", "example.com"]) == nil)
    #expect(commandLine(arguments: ["ssh", "-W", "example.com:22", "jump.example.com"]) == nil)
  }

  @Test
  func keepsForwardingOptionsThatStillOpenASession() {
    let command = commandLine(
      arguments: ["ssh", "-L", "8080:localhost:8080", "example.com"]
    )

    #expect(command == "/usr/bin/env ssh -L 8080:localhost:8080 example.com")
  }

  @Test
  func rejectsUnidentifiedCustomExecutablesAndIncompleteInvocations() {
    #expect(commandLine(arguments: ["/opt/custom/client", "example.com"]) == nil)
    #expect(commandLine(arguments: ["/bin/fish", "-l"]) == nil)
    #expect(commandLine(arguments: ["ssh"]) == nil)
    #expect(commandLine(arguments: ["ssh", "-p"]) == nil)
    #expect(commandLine(arguments: []) == nil)
  }

  private func commandLine(
    arguments: [String],
    terminalType: String? = nil,
    cliPath: String? = nil
  ) -> String? {
    SupatermSSHCommand.commandLine(
      forArguments: arguments,
      terminalType: terminalType,
      cliPath: cliPath
    )
  }
}
