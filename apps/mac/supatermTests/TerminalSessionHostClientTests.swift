import Foundation
import SupatermCLIShared
import Testing

@testable import SupatermSupport

struct TerminalSessionHostClientTests {
  @Test
  func developmentBuildAndEnvironmentDisableSessions() {
    #expect(
      ZmxEnvironment.sessionsEnabled(
        setting: true,
        isDevelopmentBuild: false,
        environment: [:]
      )
    )
    #expect(
      !ZmxEnvironment.sessionsEnabled(
        setting: false,
        isDevelopmentBuild: false,
        environment: [:]
      )
    )
    #expect(
      !ZmxEnvironment.sessionsEnabled(
        setting: true,
        isDevelopmentBuild: true,
        environment: [:]
      )
    )
    #expect(
      ZmxEnvironment.sessionsEnabled(
        setting: true,
        isDevelopmentBuild: true,
        environment: [ZmxEnvironment.enabledKey: "1"]
      )
    )
    #expect(
      !ZmxEnvironment.sessionsEnabled(
        setting: true,
        isDevelopmentBuild: false,
        environment: [ZmxEnvironment.disabledKey: "1"]
      )
    )
    #expect(
      !ZmxEnvironment.sessionsEnabled(
        setting: true,
        isDevelopmentBuild: true,
        environment: [
          ZmxEnvironment.disabledKey: "1",
          ZmxEnvironment.enabledKey: "1",
        ]
      )
    )
  }

  @Test
  func sessionIDUsesInstanceNamespaceAndRoundTripsSurfaceID() {
    let surfaceID = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!
    let environment = [SupatermCLIEnvironment.instanceNameKey: "dev/main"]
    let otherEnvironment = [SupatermCLIEnvironment.instanceNameKey: "dev-main"]
    let client = TerminalSessionHostClient.makeZmx(executableURL: nil, environment: environment)
    let sessionID = client.sessionID(surfaceID)

    #expect(
      sessionID == "\(ZmxSessionID.namespacePrefix(environment: environment))01234567-89ab-cdef-0123-456789abcdef")
    #expect(ZmxSessionID.surfaceID(from: sessionID, environment: environment) == surfaceID)
    #expect(ZmxSessionID.surfaceID(from: sessionID, environment: otherEnvironment) == nil)
    #expect(ZmxSessionID.surfaceID(from: "other-01234567-89ab-cdef-0123-456789abcdef") == nil)
  }

  @Test
  func sessionsParseReachableNamespacedProcesses() {
    let firstSurfaceID = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!
    let secondSurfaceID = UUID(uuidString: "FEDCBA98-7654-3210-FEDC-BA9876543210")!
    let environment = [SupatermCLIEnvironment.instanceNameKey: "dev/main"]
    let firstSessionID = ZmxSessionID.make(surfaceID: firstSurfaceID, environment: environment)
    let secondSessionID = ZmxSessionID.make(surfaceID: secondSurfaceID, environment: environment)
    let output = """
      → name=\(firstSessionID)\tpid=101\tclients=1\tcreated=0
        name=\(secondSessionID)\tpid=202\tclients=0\tcreated=0
        name=\(firstSessionID)\terr=Timeout\tstatus=unreachable
        name=other-01234567-89ab-cdef-0123-456789abcdef\tpid=303\tclients=0\tcreated=0
        name=\(firstSessionID)\tpid=invalid\tclients=0\tcreated=0
      """

    #expect(
      ZmxSessionList.parse(output, environment: environment) == [
        TerminalSessionHostSession(surfaceID: firstSurfaceID, processID: 101),
        TerminalSessionHostSession(surfaceID: secondSurfaceID, processID: 202),
      ]
    )
  }

  @Test
  func listSessionsDrainsLargeOutputWhileProcessRuns() async throws {
    let surfaceID = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!
    let directoryURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let executableURL = directoryURL.appendingPathComponent("zmx", isDirectory: false)
    let client = TerminalSessionHostClient.makeZmx(executableURL: executableURL)
    let sessionID = client.sessionID(surfaceID)
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directoryURL) }
    let noise = String(repeating: "x", count: 128 * 1_024)
    let script = """
      #!/bin/sh
      printf 'name=\(sessionID)\\tpid=101\\tclients=0\\n'
      printf '%s\\n' '\(noise)'
      """
    try script.write(to: executableURL, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o700],
      ofItemAtPath: executableURL.path
    )

    let sessions = await client.listSessions()

    #expect(sessions == [TerminalSessionHostSession(surfaceID: surfaceID, processID: 101)])
  }

  @Test
  func commandWrapperKeepsExecutableAsOneArgument() throws {
    let surfaceID = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!
    let executableURL = URL(
      fileURLWithPath: "/Applications/Supaterm Runtime.app/Contents/Helpers/zmx"
    )
    let client = TerminalSessionHostClient.makeZmx(executableURL: executableURL)
    let argv = try #require(client.commandWrapper(surfaceID, .createIfNeeded))

    #expect(argv == [executableURL.path, "attach", client.sessionID(surfaceID)])
  }

  @Test
  func existingSessionWrapperCannotCreateASession() throws {
    let surfaceID = UUID(uuidString: "01234567-89AB-CDEF-0123-456789ABCDEF")!
    let executableURL = URL(
      fileURLWithPath: "/Applications/Supaterm Runtime.app/Contents/Helpers/zmx"
    )
    let client = TerminalSessionHostClient.makeZmx(executableURL: executableURL)
    let argv = try #require(client.commandWrapper(surfaceID, .existing))

    #expect(
      argv == [
        executableURL.path,
        "attach",
        "--existing",
        client.sessionID(surfaceID),
      ]
    )
  }

  @Test
  func socketBudgetUsesShortTemporaryDirectory() {
    #expect(ZmxSocketBudget.socketDir() == "/tmp/zmx-\(getuid())")
  }

  @Test
  func socketBudgetUsesConfiguredDirectory() {
    #expect(
      ZmxSocketBudget.socketDir(environment: [ZmxEnvironment.directoryKey: "/tmp/test-zmx"])
        == "/tmp/test-zmx"
    )
  }

  @Test
  func socketBudgetAcceptsShortTemporaryDirectory() {
    #expect(ZmxSocketBudget.probe() == nil)
  }
}
