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
  func buildWrapperArgvKeepsExecutableAsOneArgument() {
    let argv = ZmxAttach.buildWrapperArgv(
      executablePath: "/Applications/Supaterm Runtime.app/Contents/Resources/zmx/zmx",
      sessionID: "spt-session"
    )

    #expect(argv == ["/Applications/Supaterm Runtime.app/Contents/Resources/zmx/zmx", "attach", "spt-session"])
  }

  @Test
  func resolveLaunchWrapsInteractiveShellWithoutCommand() {
    let launch = ZmxAttach.resolveLaunch(
      executablePath: "/tmp/zmx",
      sessionID: "spt-session",
      command: nil
    )

    #expect(launch.command == nil)
    #expect(launch.commandWrapper == ["/tmp/zmx", "attach", "spt-session"])
  }

  @Test
  func resolveLaunchKeepsStartupCommandAndAddsWrapper() {
    let launch = ZmxAttach.resolveLaunch(
      executablePath: "/tmp/zmx",
      sessionID: "spt-session",
      command: "/opt/homebrew/bin/fish -l -i -c 'echo hello'"
    )

    #expect(launch.command == "/opt/homebrew/bin/fish -l -i -c 'echo hello'")
    #expect(launch.commandWrapper == ["/tmp/zmx", "attach", "spt-session"])
  }

  @Test
  func resolveLaunchTreatsBlankCommandAsInteractive() {
    let launch = ZmxAttach.resolveLaunch(
      executablePath: "/tmp/zmx",
      sessionID: "spt-session",
      command: " \n "
    )

    #expect(launch.command == nil)
    #expect(launch.commandWrapper == ["/tmp/zmx", "attach", "spt-session"])
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
