import Foundation
import SupatermSupport
import Synchronization
import Testing

struct ZmxTestSessionCleanerTests {
  @Test
  func cleanupTerminatesEverySession() throws {
    let sessions = Mutex([Int32(123), Int32(456)])
    let terminated = Mutex([Int32]())
    let cleaner = ZmxTestSessionCleaner(
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
    let cleaner = ZmxTestSessionCleaner(listSessions: { [789] }, terminateSession: { _ in })

    #expect(throws: ZmxTestCleanupError.self) {
      try cleaner.cleanup()
    }
  }

  @Test
  func sessionProcessIDsIgnoreOtherDirectories() throws {
    let directory = try makeZmxDirectory()
    let otherDirectory = try makeZmxDirectory()
    defer {
      try? ZmxTestSessionCleaner(directory: directory.path).cleanup()
      try? FileManager.default.removeItem(at: directory)
      try? FileManager.default.removeItem(at: otherDirectory)
    }

    try runZmxSession(in: directory)

    #expect(!ZmxTestProcessTable.sessionProcessIDs(directory: directory.path).isEmpty)
    #expect(ZmxTestProcessTable.sessionProcessIDs(directory: otherDirectory.path).isEmpty)
  }

  @Test
  func sessionProcessIDsIgnoreDirectoriesNamedOnlyInArguments() throws {
    let directory = try makeZmxDirectory()
    let namedDirectory = try makeZmxDirectory()
    defer {
      try? ZmxTestSessionCleaner(directory: directory.path).cleanup()
      try? FileManager.default.removeItem(at: directory)
      try? FileManager.default.removeItem(at: namedDirectory)
    }

    try runZmxSession(
      in: directory,
      command: [
        "/bin/sh", "-c", "sleep 60",
        "\(ZmxEnvironment.directoryKey)=\(namedDirectory.path)",
      ]
    )

    #expect(!ZmxTestProcessTable.sessionProcessIDs(directory: directory.path).isEmpty)
    #expect(ZmxTestProcessTable.sessionProcessIDs(directory: namedDirectory.path).isEmpty)
  }

  /// A busy daemon makes `zmx kill` unlink the socket without exiting, so the
  /// socket directory can disappear while the session is still running.
  @Test
  func cleanupReapsSessionAfterItsDirectoryIsGone() throws {
    let directory = try makeZmxDirectory()
    try runZmxSession(in: directory)
    let processID = try #require(ZmxTestProcessTable.sessionProcessIDs(directory: directory.path).first)
    let session = try #require(ZmxTestWorkspace.processIdentity(processID: processID))
    try FileManager.default.removeItem(at: directory)

    try ZmxTestSessionCleaner(directory: directory.path).cleanup()

    #expect(!ZmxTestWorkspace.processMatches(session))
  }

  @Test
  func workspaceCleanupKillsSessionsAndRemovesState() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let instanceName = "unit-live-\(UUID().uuidString)"
    let stateHome = temporaryDirectory.appendingPathComponent("direct", isDirectory: true)
    let workspace = try ZmxTestWorkspace(stateHome: stateHome, instanceName: instanceName)
    defer {
      try? ZmxTestSessionCleaner(directory: workspace.zmxDirectory.path).cleanup()
      try? FileManager.default.removeItem(at: workspace.zmxDirectory)
    }
    try FileManager.default.createDirectory(
      at: workspace.zmxDirectory,
      withIntermediateDirectories: true
    )
    try runZmxSession(in: workspace.zmxDirectory)
    let processID = try #require(
      ZmxTestProcessTable.sessionProcessIDs(directory: workspace.zmxDirectory.path).first
    )
    let session = try #require(ZmxTestWorkspace.processIdentity(processID: processID))

    try workspace.cleanup()

    #expect(!ZmxTestWorkspace.processMatches(session))
    #expect(!FileManager.default.fileExists(atPath: stateHome.path))
    #expect(!FileManager.default.fileExists(atPath: workspace.zmxDirectory.path))
  }

  @Test
  func reapAbandonedCleansOnlyWorkspacesWithoutLiveOwners() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let deadStateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    let liveStateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-live", isDirectory: true)
    try FileManager.default.createDirectory(at: deadStateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try writeOwner(ZmxTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: nil), to: deadStateHome)
    _ = try ZmxTestWorkspace(stateHome: liveStateHome, instanceName: "ui-live")
    let cleanedInstances = Mutex([String]())

    try ZmxTestWorkspace.reapAbandoned(
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
    let workspace = try ZmxTestWorkspace(stateHome: stateHome, instanceName: "ui-dead")
    try workspace.recordApp(process)
    let appProcess = try #require(try readOwner(from: stateHome).appProcess)
    try writeOwner(
      ZmxTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: appProcess),
      to: stateHome
    )

    try ZmxTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-ui-",
      instanceNamePrefix: "ui-",
      cleanupInstance: { _ in }
    )

    #expect(!ZmxTestWorkspace.processMatches(appProcess))
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
    let appProcess = ZmxTestWorkspace.ProcessIdentity(
      processID: process.processIdentifier,
      startTimeSeconds: .max,
      startTimeMicroseconds: .max
    )
    try writeOwner(
      ZmxTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: appProcess),
      to: stateHome
    )

    try ZmxTestWorkspace.reapAbandoned(
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

    let claim = try ZmxTestWorkspace.claim(stateHome)
    let claimedStateHome = try #require(claim)

    #expect(try ZmxTestWorkspace.claim(stateHome) == nil)
    #expect(FileManager.default.fileExists(atPath: claimedStateHome.path))
  }

  @Test
  func interruptedClaimIsReaped() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try writeOwner(ZmxTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: nil), to: stateHome)
    let claim = try ZmxTestWorkspace.claim(stateHome, reaperProcess: deadProcess)
    let claimedStateHome = try #require(claim)
    let cleanedInstances = Mutex([String]())

    try ZmxTestWorkspace.reapAbandoned(
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
      try ZmxTestWorkspace.claim(stateHome, reaperProcess: deadProcess)
    )
    let secondClaim = try #require(
      try ZmxTestWorkspace.claim(firstClaim, reaperProcess: deadProcess)
    )

    #expect(
      secondClaim.lastPathComponent.components(separatedBy: ZmxTestWorkspace.claimMarker).count == 2
    )
  }

  @Test
  func activeClaimIsNotReaped() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let stateHome = temporaryDirectory.appendingPathComponent("supaterm-ui-dead", isDirectory: true)
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    try writeOwner(ZmxTestWorkspace.Owner(runnerProcess: deadProcess, appProcess: nil), to: stateHome)
    let claim = try ZmxTestWorkspace.claim(stateHome)
    let claimedStateHome = try #require(claim)
    let cleanedInstances = Mutex([String]())

    try ZmxTestWorkspace.reapAbandoned(
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

  private var zmxExecutableURL: URL {
    Bundle(for: ZmxTestBundleToken.self).bundleURL
      .deletingLastPathComponent()
      .appendingPathComponent("supaterm.app/Contents/Helpers/zmx")
  }

  private var deadProcess: ZmxTestWorkspace.ProcessIdentity {
    ZmxTestWorkspace.ProcessIdentity(
      processID: .max,
      startTimeSeconds: .max,
      startTimeMicroseconds: .max
    )
  }

  private func makeZmxDirectory() throws -> URL {
    let directory = ZmxTestWorkspace.zmxDirectory(instanceName: "unit-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  private func runZmxSession(in directory: URL, command: [String] = ["/bin/sleep", "60"]) throws {
    var environment = ProcessInfo.processInfo.environment
    environment[ZmxEnvironment.directoryKey] = directory.path
    environment[ZmxEnvironment.sessionKey] = ""
    environment[ZmxEnvironment.sessionPrefixKey] = ""

    let process = Process()
    process.executableURL = zmxExecutableURL
    process.arguments = ["run", "spt-unit-\(UUID().uuidString)", "-d"] + command
    process.environment = environment
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()

    let deadline = Date().addingTimeInterval(10)
    while ZmxTestProcessTable.sessionProcessIDs(directory: directory.path).isEmpty, Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
  }

  private func writeOwner(_ owner: ZmxTestWorkspace.Owner, to stateHome: URL) throws {
    try JSONEncoder().encode(owner).write(
      to: stateHome.appendingPathComponent(ZmxTestWorkspace.ownerFilename),
      options: .atomic
    )
  }

  private func readOwner(from stateHome: URL) throws -> ZmxTestWorkspace.Owner {
    try JSONDecoder().decode(
      ZmxTestWorkspace.Owner.self,
      from: Data(contentsOf: stateHome.appendingPathComponent(ZmxTestWorkspace.ownerFilename))
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

private final class ZmxTestBundleToken {}
