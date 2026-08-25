import Foundation
import SupatermSupport
import Synchronization
import Testing

struct SessionHostTestSessionCleanerTests {
  @Test
  func cleanupTerminatesEverySession() throws {
    let sessions = Mutex([Int32(123), Int32(456)])
    let terminated = Mutex([Int32]())
    let cleaner = SessionHostTestSessionCleaner(
      listSessions: { sessions.withLock { $0 } },
      terminateSession: { processID in
        terminated.withLock { $0.append(processID) }
        sessions.withLock { $0.removeAll { $0 == processID } }
      }
    )

    try cleaner.cleanup()

    #expect(terminated.withLock { $0 } == [123, 456])
  }

  @Test
  func cleanupFailsWhenSessionsRemain() {
    let cleaner = SessionHostTestSessionCleaner(listSessions: { [789] }, terminateSession: { _ in })

    #expect(throws: SessionHostTestCleanupError.self) {
      try cleaner.cleanup()
    }
  }

  @Test
  func sessionProcessIDsIgnoreOtherDirectories() throws {
    let directory = try makeSessionHostDirectory()
    let otherDirectory = try makeSessionHostDirectory()
    defer {
      try? SessionHostTestSessionCleaner(directory: directory.path).cleanup()
      try? FileManager.default.removeItem(at: directory)
      try? FileManager.default.removeItem(at: otherDirectory)
    }

    try runSessionHostSession(in: directory)

    #expect(!SessionHostTestProcessTable.sessionProcessIDs(directory: directory.path).isEmpty)
    #expect(SessionHostTestProcessTable.sessionProcessIDs(directory: otherDirectory.path).isEmpty)
  }

  @Test
  func sessionProcessIDsIgnoreDirectoriesNamedOnlyInArguments() throws {
    let directory = try makeSessionHostDirectory()
    let namedDirectory = try makeSessionHostDirectory()
    defer {
      try? SessionHostTestSessionCleaner(directory: directory.path).cleanup()
      try? FileManager.default.removeItem(at: directory)
      try? FileManager.default.removeItem(at: namedDirectory)
    }

    try runSessionHostSession(
      in: directory,
      command: [
        "/bin/sh", "-c", "sleep 60",
        "\(SessionHostEnvironment.directoryKey)=\(namedDirectory.path)",
      ]
    )

    #expect(!SessionHostTestProcessTable.sessionProcessIDs(directory: directory.path).isEmpty)
    #expect(SessionHostTestProcessTable.sessionProcessIDs(directory: namedDirectory.path).isEmpty)
  }

  /// A busy daemon makes `sessionHost kill` unlink the socket without exiting, so the
  /// socket directory can disappear while the session is still running.
  @Test
  func cleanupReapsSessionAfterItsDirectoryIsGone() throws {
    let directory = try makeSessionHostDirectory()
    try runSessionHostSession(in: directory)
    let processID = try #require(SessionHostTestProcessTable.sessionProcessIDs(directory: directory.path).first)
    let session = try #require(SessionHostTestWorkspace.processIdentity(processID: processID))
    try FileManager.default.removeItem(at: directory)

    try SessionHostTestSessionCleaner(directory: directory.path).cleanup()

    #expect(!SessionHostTestWorkspace.processMatches(session))
  }

  @Test
  func workspaceCleanupKillsSessionsAndRemovesState() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let instanceName = "unit-live-\(UUID().uuidString)"
    let stateHome = temporaryDirectory.appendingPathComponent("direct", isDirectory: true)
    let workspace = try SessionHostTestWorkspace(stateHome: stateHome, instanceName: instanceName)
    defer {
      try? SessionHostTestSessionCleaner(directory: workspace.sessionHostDirectory.path).cleanup()
      try? FileManager.default.removeItem(at: workspace.sessionHostDirectory)
    }
    try FileManager.default.createDirectory(
      at: workspace.sessionHostDirectory,
      withIntermediateDirectories: true
    )
    try runSessionHostSession(in: workspace.sessionHostDirectory)
    let processID = try #require(
      SessionHostTestProcessTable.sessionProcessIDs(directory: workspace.sessionHostDirectory.path).first
    )
    let session = try #require(SessionHostTestWorkspace.processIdentity(processID: processID))

    try workspace.cleanup()

    #expect(!SessionHostTestWorkspace.processMatches(session))
    #expect(!FileManager.default.fileExists(atPath: stateHome.path))
    #expect(!FileManager.default.fileExists(atPath: workspace.sessionHostDirectory.path))
  }

  @Test
  func reapAbandonedCleansOnlyWorkspacesWithoutLiveOwners() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let deadStateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    let liveStateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-live", isDirectory: true)
    try FileManager.default.createDirectory(at: deadStateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try writeOwner(SessionHostTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: nil), to: deadStateHome)
    _ = try SessionHostTestWorkspace(stateHome: liveStateHome, instanceName: "ui-live")
    let cleanedInstances = Mutex([String]())

    try SessionHostTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-ui-",
      instanceNamePrefix: "ui-",
      cleanupInstance: { instanceName in
        cleanedInstances.withLock { $0.append(instanceName) }
      }
    )

    #expect(cleanedInstances.withLock { $0 } == ["ui-dead"])
    #expect(!FileManager.default.fileExists(atPath: deadStateHome.path))
    #expect(FileManager.default.fileExists(atPath: liveStateHome.path))
  }

  @Test
  func reapAbandonedTerminatesRecordedApp() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let process = try launchSleepProcess()
    defer { stop(process) }
    let workspace = try SessionHostTestWorkspace(stateHome: stateHome, instanceName: "ui-dead")
    try workspace.recordApp(process)
    let appProcess = try #require(try readOwner(from: stateHome).appProcess)
    try writeOwner(
      SessionHostTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: appProcess),
      to: stateHome
    )

    try SessionHostTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-ui-",
      instanceNamePrefix: "ui-",
      cleanupInstance: { _ in }
    )

    #expect(!SessionHostTestWorkspace.processMatches(appProcess))
  }

  @Test
  func reapAbandonedDoesNotSignalAReusedProcessID() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let process = try launchSleepProcess()
    defer { stop(process) }
    let appProcess = SessionHostTestWorkspace.ProcessIdentity(
      processID: process.processIdentifier,
      startTimeSeconds: .max,
      startTimeMicroseconds: .max
    )
    try writeOwner(
      SessionHostTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: appProcess),
      to: stateHome
    )

    try SessionHostTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-ui-",
      instanceNamePrefix: "ui-",
      cleanupInstance: { _ in }
    )

    #expect(process.isRunning)
  }

  @Test
  func abandonedWorkspaceCanBeClaimedOnce() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let claim = try SessionHostTestWorkspace.claim(stateHome)
    let claimedStateHome = try #require(claim)

    #expect(try SessionHostTestWorkspace.claim(stateHome) == nil)
    #expect(FileManager.default.fileExists(atPath: claimedStateHome.path))
  }

  @Test
  func interruptedClaimIsReaped() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try writeOwner(SessionHostTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: nil), to: stateHome)
    let claim = try SessionHostTestWorkspace.claim(stateHome, reaperProcess: deadProcess)
    let claimedStateHome = try #require(claim)
    let cleanedInstances = Mutex([String]())

    try SessionHostTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-ui-",
      instanceNamePrefix: "ui-",
      cleanupInstance: { instanceName in
        cleanedInstances.withLock { $0.append(instanceName) }
      }
    )

    #expect(cleanedInstances.withLock { $0 } == ["ui-dead"])
    #expect(!FileManager.default.fileExists(atPath: claimedStateHome.path))
  }

  @Test
  func repeatedClaimReplacesPriorMetadata() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let firstClaim = try #require(
      try SessionHostTestWorkspace.claim(stateHome, reaperProcess: deadProcess)
    )
    let secondClaim = try #require(
      try SessionHostTestWorkspace.claim(firstClaim, reaperProcess: deadProcess)
    )

    #expect(
      secondClaim.lastPathComponent.components(separatedBy: SessionHostTestWorkspace.claimMarker).count == 2
    )
  }

  @Test
  func activeClaimIsNotReaped() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try writeOwner(SessionHostTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: nil), to: stateHome)
    let claim = try SessionHostTestWorkspace.claim(stateHome)
    let claimedStateHome = try #require(claim)
    let cleanedInstances = Mutex([String]())

    try SessionHostTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-ui-",
      instanceNamePrefix: "ui-",
      cleanupInstance: { instanceName in
        cleanedInstances.withLock { $0.append(instanceName) }
      }
    )

    #expect(cleanedInstances.withLock { $0 }.isEmpty)
    #expect(FileManager.default.fileExists(atPath: claimedStateHome.path))
  }

  private var sessionHostExecutableURL: URL {
    Bundle(for: SessionHostTestBundleToken.self).bundleURL
      .deletingLastPathComponent()
      .appendingPathComponent(
        "supaterm.app/Contents/Resources/supaterm-host/macos-aarch64/supaterm-host"
      )
  }

  private var deadProcess: SessionHostTestWorkspace.ProcessIdentity {
    SessionHostTestWorkspace.ProcessIdentity(
      processID: .max,
      startTimeSeconds: .max,
      startTimeMicroseconds: .max
    )
  }

  private func makeSessionHostDirectory() throws -> URL {
    let directory = SessionHostTestWorkspace.sessionHostDirectory(instanceName: "unit-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func runSessionHostSession(in directory: URL, command: [String] = ["/bin/sleep", "60"]) throws {
    var environment = ProcessInfo.processInfo.environment
    environment[SessionHostEnvironment.directoryKey] = directory.path

    let process = Process()
    process.executableURL = sessionHostExecutableURL
    process.arguments = ["attach", "spt-unit-\(UUID().uuidString)"] + command
    process.environment = environment
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()

    let deadline = Date().addingTimeInterval(10)
    while SessionHostTestProcessTable.sessionProcessIDs(directory: directory.path).isEmpty, Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
  }

  private func writeOwner(_ owner: SessionHostTestWorkspace.Owner, to stateHome: URL) throws {
    try JSONEncoder().encode(owner).write(
      to: stateHome.appendingPathComponent(SessionHostTestWorkspace.ownerFilename),
      options: .atomic
    )
  }

  private func readOwner(from stateHome: URL) throws -> SessionHostTestWorkspace.Owner {
    try JSONDecoder().decode(
      SessionHostTestWorkspace.Owner.self,
      from: Data(contentsOf: stateHome.appendingPathComponent(SessionHostTestWorkspace.ownerFilename))
    )
  }

  private func launchSleepProcess() throws -> Process {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/sleep")
    process.arguments = ["60"]
    try process.run()
    return process
  }

  private func stop(_ process: Process) {
    if process.isRunning {
      process.terminate()
    }
    process.waitUntilExit()
  }
}

private final class SessionHostTestBundleToken {}
