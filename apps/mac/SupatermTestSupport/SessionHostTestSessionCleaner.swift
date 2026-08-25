import Darwin
import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated enum SessionHostTestCleanupError: Error, CustomStringConvertible {
  case processDidNotExit(Int32)
  case processIdentityUnavailable(Int32)
  case processSignalFailed(processID: Int32, signal: Int32, errorCode: Int32)
  case sessionsRemain([Int32])

  var description: String {
    switch self {
    case .processDidNotExit(let processID):
      return "process \(processID) did not exit"
    case .processIdentityUnavailable(let processID):
      return "process \(processID) identity is unavailable"
    case .processSignalFailed(let processID, let signal, let errorCode):
      return "signal \(signal) failed for process \(processID) with error \(errorCode)"
    case .sessionsRemain(let processIDs):
      return "host sessions remain: \(processIDs.map(String.init).joined(separator: ", "))"
    }
  }
}

nonisolated struct SessionHostTestSessionCleaner: Sendable {
  typealias ListSessions = @Sendable () -> [Int32]
  typealias TerminateSession = @Sendable (_ processID: Int32) throws -> Void

  private let listSessions: ListSessions
  private let terminateSession: TerminateSession

  init(directory: String) {
    self.init(
      listSessions: { SessionHostTestProcessTable.sessionProcessIDs(directory: directory) },
      terminateSession: SessionHostTestWorkspace.terminateProcessGroup(processID:)
    )
  }

  init(listSessions: @escaping ListSessions, terminateSession: @escaping TerminateSession) {
    self.listSessions = listSessions
    self.terminateSession = terminateSession
  }

  func cleanup() throws {
    for processID in listSessions() {
      try terminateSession(processID)
    }

    let remaining = listSessions()
    guard remaining.isEmpty else {
      throw SessionHostTestCleanupError.sessionsRemain(remaining)
    }
  }
}

/// A sessionHost daemon outlives both its socket and the app that spawned it, so the
/// process table is the only authority on which sessions a test still owns.
nonisolated enum SessionHostTestProcessTable {
  static func sessionProcessIDs(directory: String) -> [Int32] {
    let entry = "\(SessionHostEnvironment.directoryKey)=\(directory)"
    let ownProcessGroupID = getpgrp()
    return processIDs().filter { processID in
      processID != ownProcessGroupID
        && getpgid(processID) == processID
        && environment(processID: processID).contains(entry)
    }
  }

  private static func processIDs() -> [Int32] {
    let stride = Int32(MemoryLayout<pid_t>.stride)
    let byteCount = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
    guard byteCount > 0 else { return [] }
    var processIDs = [pid_t](repeating: 0, count: Int(byteCount / stride))
    let writtenByteCount = processIDs.withUnsafeMutableBufferPointer { buffer in
      proc_listpids(UInt32(PROC_ALL_PIDS), 0, buffer.baseAddress, Int32(buffer.count) * stride)
    }
    guard writtenByteCount > 0 else { return [] }
    return processIDs.prefix(Int(writtenByteCount / stride)).filter { $0 > 0 }
  }

  /// KERN_PROCARGS2 lays out a four-byte argc, the executable path, NUL padding,
  /// then argc arguments and the environment, all NUL-terminated. Skipping the
  /// arguments keeps a process that merely names a directory from passing for
  /// one that runs in it.
  private static func environment(processID: Int32) -> [String] {
    var name: [Int32] = [CTL_KERN, KERN_PROCARGS2, processID]
    var byteCount = 0
    guard sysctl(&name, 3, nil, &byteCount, nil, 0) == 0, byteCount > MemoryLayout<Int32>.size else {
      return []
    }
    var buffer = [UInt8](repeating: 0, count: byteCount)
    guard sysctl(&name, 3, &buffer, &byteCount, nil, 0) == 0 else { return [] }
    let argumentCount = Int(buffer.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) })
    guard argumentCount >= 0 else { return [] }

    return buffer.prefix(byteCount)
      .dropFirst(MemoryLayout<Int32>.size)
      .drop { $0 != 0 }
      .drop { $0 == 0 }
      .split(separator: 0, omittingEmptySubsequences: false)
      .dropFirst(argumentCount)
      .prefix { !$0.isEmpty }
      .compactMap { String(bytes: $0, encoding: .utf8) }
  }
}

nonisolated struct SessionHostTestWorkspace: Sendable {
  static let ownerFilename = ".supaterm-test-owner"
  static let claimMarker = ".supaterm-test-reap-"

  struct ProcessIdentity: Codable, Equatable, Sendable {
    let processID: Int32
    let startTimeSeconds: UInt64
    let startTimeMicroseconds: UInt64
  }

  struct Owner: Codable, Sendable {
    let runnerProcess: ProcessIdentity
    let appProcess: ProcessIdentity?
  }

  private let stateHome: URL
  private let cleaner: SessionHostTestSessionCleaner
  let sessionHostDirectory: URL

  init(stateHome: URL, instanceName: String) throws {
    self.stateHome = stateHome
    sessionHostDirectory = Self.sessionHostDirectory(instanceName: instanceName)
    cleaner = SessionHostTestSessionCleaner(directory: sessionHostDirectory.path)
    let runnerProcess = try Self.requiredProcessIdentity(processID: getpid())
    try FileManager.default.createDirectory(at: stateHome, withIntermediateDirectories: true)
    try writeOwner(Owner(runnerProcess: runnerProcess, appProcess: nil))
  }

  func recordApp(_ process: Process) throws {
    let appProcess = try Self.requiredProcessIdentity(processID: process.processIdentifier)
    try writeOwner(Owner(runnerProcess: readOwner().runnerProcess, appProcess: appProcess))
  }

  /// Removes the directories only once no session survives, so an unreapable
  /// session keeps the owner file a later run needs to find it.
  func cleanup() throws {
    if let appProcess = try readOwner().appProcess {
      try Self.terminateProcess(appProcess)
    }
    try cleaner.cleanup()
    try Self.removeIfPresent(sessionHostDirectory)
    try Self.removeIfPresent(stateHome)
  }

  private var ownerURL: URL {
    stateHome.appendingPathComponent(Self.ownerFilename)
  }

  private func readOwner() throws -> Owner {
    try JSONDecoder().decode(Owner.self, from: Data(contentsOf: ownerURL))
  }

  private func writeOwner(_ owner: Owner) throws {
    try JSONEncoder().encode(owner).write(to: ownerURL, options: .atomic)
  }

  static func reapAbandoned(
    in temporaryDirectory: URL,
    stateHomePrefix: String,
    instanceNamePrefix: String
  ) throws {
    try reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: stateHomePrefix,
      instanceNamePrefix: instanceNamePrefix,
      cleanupInstance: { instanceName in
        let directory = sessionHostDirectory(instanceName: instanceName)
        try SessionHostTestSessionCleaner(directory: directory.path).cleanup()
        try removeIfPresent(directory)
      }
    )
  }

  static func reapAbandoned(
    in temporaryDirectory: URL,
    stateHomePrefix: String,
    instanceNamePrefix: String,
    cleanupInstance: (String) throws -> Void
  ) throws {
    let fileManager = FileManager.default
    let urls = try fileManager.contentsOfDirectory(
      at: temporaryDirectory,
      includingPropertiesForKeys: [.isDirectoryKey],
      options: [.skipsHiddenFiles]
    )
    for stateHome in urls.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
      let name = stateHome.lastPathComponent
      guard name.hasPrefix(stateHomePrefix) else { continue }
      if let reaperProcess = claimOwner(from: name), processMatches(reaperProcess) {
        continue
      }
      guard (try? stateHome.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
        continue
      }
      let ownerURL = stateHome.appendingPathComponent(ownerFilename)
      guard
        let data = try? Data(contentsOf: ownerURL),
        let owner = try? JSONDecoder().decode(Owner.self, from: data),
        !processMatches(owner.runnerProcess)
      else {
        continue
      }
      let suffixWithClaims = name.dropFirst(stateHomePrefix.count)
      let suffixEnd = suffixWithClaims.range(of: claimMarker)?.lowerBound ?? suffixWithClaims.endIndex
      let suffix = suffixWithClaims[..<suffixEnd]
      guard let claimedStateHome = try claim(stateHome, fileManager: fileManager) else { continue }
      do {
        if let appProcess = owner.appProcess {
          try terminateProcess(appProcess)
        }
        try cleanupInstance(instanceNamePrefix + suffix)
        try fileManager.removeItem(at: claimedStateHome)
      } catch {
        if !fileManager.fileExists(atPath: stateHome.path) {
          try? fileManager.moveItem(at: claimedStateHome, to: stateHome)
        }
        throw error
      }
    }
  }

  static func claim(
    _ stateHome: URL,
    reaperProcess: ProcessIdentity? = nil,
    fileManager: FileManager = .default
  ) throws -> URL? {
    let reaperProcess = try reaperProcess ?? requiredProcessIdentity(processID: getpid())
    let name = stateHome.lastPathComponent
    let baseEnd = name.range(of: claimMarker)?.lowerBound ?? name.endIndex
    let baseName = name[..<baseEnd]
    let claimedStateHome = stateHome.deletingLastPathComponent().appendingPathComponent(
      "\(baseName)\(claimMarker)\(reaperProcess.processID)-"
        + "\(reaperProcess.startTimeSeconds)-\(reaperProcess.startTimeMicroseconds)-" + UUID().uuidString,
      isDirectory: true
    )
    do {
      try fileManager.moveItem(at: stateHome, to: claimedStateHome)
      return claimedStateHome
    } catch let error as CocoaError where error.code == .fileNoSuchFile {
      return nil
    }
  }

  private static func claimOwner(from name: String) -> ProcessIdentity? {
    guard let markerRange = name.range(of: claimMarker, options: .backwards) else { return nil }
    let fields = name[markerRange.upperBound...].split(separator: "-", maxSplits: 3)
    guard
      fields.count == 4,
      let processID = Int32(fields[0]),
      let startTimeSeconds = UInt64(fields[1]),
      let startTimeMicroseconds = UInt64(fields[2])
    else {
      return nil
    }
    return ProcessIdentity(
      processID: processID,
      startTimeSeconds: startTimeSeconds,
      startTimeMicroseconds: startTimeMicroseconds
    )
  }

  static func sessionHostDirectory(instanceName: String) -> URL {
    let instanceHash = SessionHostSessionID.instanceHash(
      environment: [SupatermCLIEnvironment.instanceNameKey: instanceName]
    )
    return URL(fileURLWithPath: "/tmp", isDirectory: true)
      .appendingPathComponent("spt-z-\(instanceHash)", isDirectory: true)
  }

  private static func removeIfPresent(_ url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  static func terminateProcess(_ process: ProcessIdentity) throws {
    guard processMatches(process) else { return }
    try send(SIGTERM, to: process.processID)
    if waitForExit(process, timeout: 5) { return }
    guard processMatches(process) else { return }
    try send(SIGKILL, to: process.processID)
    guard waitForExit(process, timeout: 2) else {
      throw SessionHostTestCleanupError.processDidNotExit(process.processID)
    }
  }

  static func terminateProcessGroup(processID: Int32) throws {
    guard let process = processIdentity(processID: processID) else { return }
    try send(SIGHUP, toProcessGroup: processID)
    if waitForExit(process, timeout: 0.5) { return }
    try send(SIGKILL, toProcessGroup: processID)
    guard waitForExit(process, timeout: 2) else {
      throw SessionHostTestCleanupError.processDidNotExit(processID)
    }
  }

  private static func waitForExit(_ process: ProcessIdentity, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while processMatches(process), Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    return !processMatches(process)
  }

  static func processMatches(_ process: ProcessIdentity) -> Bool {
    processIdentity(processID: process.processID) == process
  }

  private static func requiredProcessIdentity(processID: Int32) throws -> ProcessIdentity {
    guard let process = processIdentity(processID: processID) else {
      throw SessionHostTestCleanupError.processIdentityUnavailable(processID)
    }
    return process
  }

  static func processIdentity(processID: Int32) -> ProcessIdentity? {
    var info = proc_bsdinfo()
    let size = MemoryLayout<proc_bsdinfo>.size
    guard proc_pidinfo(processID, PROC_PIDTBSDINFO, 0, &info, Int32(size)) == Int32(size) else {
      return nil
    }
    return ProcessIdentity(
      processID: processID,
      startTimeSeconds: info.pbi_start_tvsec,
      startTimeMicroseconds: info.pbi_start_tvusec
    )
  }

  private static func send(_ signal: Int32, to processID: Int32) throws {
    guard kill(processID, signal) != 0 else { return }
    guard errno != ESRCH else { return }
    throw SessionHostTestCleanupError.processSignalFailed(
      processID: processID,
      signal: signal,
      errorCode: errno
    )
  }

  private static func send(_ signal: Int32, toProcessGroup processID: Int32) throws {
    guard kill(-processID, signal) != 0 else { return }
    guard errno != ESRCH, errno != EPERM else { return }
    throw SessionHostTestCleanupError.processSignalFailed(
      processID: processID,
      signal: signal,
      errorCode: errno
    )
  }
}
