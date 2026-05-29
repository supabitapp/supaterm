import Foundation
import SupatermCLIShared
import Testing

@testable import SupatermSupport

struct ZmxClientTests {
  @Test
  func sessionIDUsesInstanceNamespaceAndRoundTripsSurfaceID() {
    let surfaceID = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!
    let environment = [SupatermCLIEnvironment.instanceNameKey: "dev/main"]
    let otherEnvironment = [SupatermCLIEnvironment.instanceNameKey: "dev-main"]
    let sessionID = ZmxSessionID.make(surfaceID: surfaceID, environment: environment)

    #expect(
      sessionID == "\(ZmxSessionID.namespacePrefix(environment: environment))01234567-89ab-cdef-0123-456789abcdef")
    #expect(ZmxSessionID.surfaceID(from: sessionID, environment: environment) == surfaceID)
    #expect(ZmxSessionID.surfaceID(from: sessionID, environment: otherEnvironment) == nil)
    #expect(ZmxSessionID.surfaceID(from: "other-01234567-89ab-cdef-0123-456789abcdef") == nil)
  }

  @Test
  func attachCommandQuotesExecutableAndUserCommand() {
    let command = ZmxAttach.buildCommand(
      executablePath: "/Applications/Supaterm's Runtime/zmx",
      sessionID: "spt-session",
      userCommand: "echo 'hello'"
    )

    #expect(command == #"'/Applications/Supaterm'\''s Runtime/zmx' attach spt-session /bin/sh -c 'echo '\''hello'\'''"#)
  }

  @Test
  func attachCommandOmitsEmptyUserCommand() {
    #expect(
      ZmxAttach.buildCommand(
        executablePath: "/tmp/zmx",
        sessionID: "spt-session",
        userCommand: "  "
      ) == "'/tmp/zmx' attach spt-session"
    )
  }

  @Test
  func attachCommandUsesDefaultShellCommandWhenUserCommandIsMissing() {
    #expect(
      ZmxAttach.buildCommand(
        executablePath: "/tmp/zmx",
        sessionID: "spt-session",
        userCommand: nil,
        defaultShellCommand: "bash --posix"
      ) == "'/tmp/zmx' attach spt-session --default-shell-command 'bash --posix'"
    )
  }

  @Test
  func attachCommandUserCommandOverridesDefaultShellCommand() {
    #expect(
      ZmxAttach.buildCommand(
        executablePath: "/tmp/zmx",
        sessionID: "spt-session",
        userCommand: "echo hello",
        defaultShellCommand: "bash --posix"
      ) == "'/tmp/zmx' attach spt-session /bin/sh -c 'echo hello'"
    )
  }

  @Test
  func defaultShellCommandUsesShellEnvironment() {
    #expect(ZmxAttach.defaultShellCommand(environment: ["SHELL": "/bin/zsh"]) == "/bin/zsh")
    #expect(ZmxAttach.defaultShellCommand(environment: ["SHELL": " "]) == "/bin/sh")
    #expect(ZmxAttach.defaultShellCommand(environment: [:]) == "/bin/sh")
  }

  @Test
  func socketBudgetUsesShortTemporaryDirectory() {
    #expect(ZmxSocketBudget.socketDir() == "/tmp/zmx-\(getuid())")
  }

  @Test
  func socketBudgetAcceptsShortTemporaryDirectory() {
    #expect(ZmxSocketBudget.probe() == nil)
  }
}
