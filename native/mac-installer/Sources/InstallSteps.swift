import AppKit
import CryptoKit
import Foundation
import Security

enum InstallerError: LocalizedError {
  case feedUnavailable
  case noBuildForThisMac
  case downloadFailed
  case damagedDownload
  case untrustedApp
  case occupied(URL)
  case notWritable(URL)
  case replaceFailed(URL, Error)

  var errorDescription: String? {
    switch self {
    case .feedUnavailable:
      "Couldn't find the latest version of Supaterm. Check your internet connection and try again."
    case .noBuildForThisMac:
      "The latest release has no build for this Mac."
    case .downloadFailed:
      "The download didn't finish. Check your internet connection and try again."
    case .damagedDownload:
      "The download was damaged. Try again."
    case .untrustedApp:
      "The downloaded app isn't signed by Supaterm, so it wasn't installed."
    case let .occupied(url):
      "Another app is already at \(url.path). Move it, then try again."
    case let .notWritable(url):
      "You don't have permission to replace \(url.path). Move it to the Trash or ask an administrator, then try again."
    case let .replaceFailed(url, error):
      "Couldn't install Supaterm at \(url.path). \(error.localizedDescription)"
    }
  }
}

enum InstallSteps {
  static let appBundleIdentifier = "com.supaterm.desktop"
  static let appName = "Supaterm.app"
  // Developer ID, our team, and Apple's notarization; the same checks
  // Gatekeeper would make on a quarantined download.
  private static let appRequirement =
    "anchor apple generic and identifier \"\(appBundleIdentifier)\" "
    + "and certificate leaf[subject.OU] = \"9ZLSJ2GN2B\" and notarized"

  // Debug builds can install into a scratch folder without opening the app,
  // so testing never replaces or launches the copy in use.
  #if DEBUG
    private static let applicationsOverride = ProcessInfo.processInfo.environment["SUPATERM_INSTALLER_APPLICATIONS_DIR"]
  #else
    private static let applicationsOverride: String? = nil
  #endif

  static var opensAfterInstall: Bool { applicationsOverride == nil }

  static func download(
    _ artifact: ReleaseArtifact,
    into directory: URL,
    onProgress: @escaping @Sendable (Int64) -> Void
  ) async throws -> URL {
    let archive = directory.appending(path: artifact.url.lastPathComponent)
    try await ArchiveDownload(destination: archive, onProgress: onProgress).run(artifact.url)
    return archive
  }

  static func verifyChecksum(of archive: URL, matches artifact: ReleaseArtifact) throws {
    let handle = try FileHandle(forReadingFrom: archive)
    defer { try? handle.close() }
    var hasher = SHA512()
    var size: Int64 = 0
    while let chunk = try handle.read(upToCount: 4 << 20), !chunk.isEmpty {
      hasher.update(data: chunk)
      size += Int64(chunk.count)
    }
    let digest = Data(hasher.finalize()).base64EncodedString()
    guard size == artifact.size, digest == artifact.sha512 else { throw InstallerError.damagedDownload }
  }

  static func extractApp(from archive: URL, into directory: URL) async throws -> URL {
    let status = try await run("/usr/bin/ditto", ["-x", "-k", archive.path, directory.path])
    let app = directory.appending(path: appName)
    guard status == 0, FileManager.default.fileExists(atPath: app.path) else { throw InstallerError.damagedDownload }
    return app
  }

  static func verifySignature(of app: URL) throws {
    var code: SecStaticCode?
    var requirement: SecRequirement?
    guard
      SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess,
      SecRequirementCreateWithString(appRequirement as CFString, [], &requirement) == errSecSuccess,
      let code
    else { throw InstallerError.untrustedApp }
    let flags = SecCSFlags(
      rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate | kSecCSCheckNestedCode
    )
    guard SecStaticCodeCheckValidity(code, flags, requirement) == errSecSuccess else {
      throw InstallerError.untrustedApp
    }
  }

  // Updates an existing copy where it is, refusing one this account can't
  // replace rather than leaving a second, stale copy behind. Otherwise prefers
  // /Applications and falls back to ~/Applications for accounts that can't
  // write there. Resolved before downloading so a doomed install fails fast.
  static func destination() throws -> URL {
    if let applicationsOverride {
      return URL(filePath: applicationsOverride, directoryHint: .isDirectory).appending(path: appName)
    }
    let fileManager = FileManager.default
    let system = URL(filePath: "/Applications", directoryHint: .isDirectory)
    let user = fileManager.homeDirectoryForCurrentUser.appending(path: "Applications", directoryHint: .isDirectory)
    for directory in [system, user] {
      let existing = directory.appending(path: appName)
      guard isSupatermApp(at: existing) else { continue }
      guard fileManager.isWritableFile(atPath: directory.path), fileManager.isWritableFile(atPath: existing.path)
      else { throw InstallerError.notWritable(existing) }
      return existing
    }
    let directory = fileManager.isWritableFile(atPath: system.path) ? system : user
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = directory.appending(path: appName)
    guard (try? fileManager.attributesOfItem(atPath: destination.path)) == nil else {
      throw InstallerError.occupied(destination)
    }
    return destination
  }

  // AppKit reports bundle URLs with a trailing slash, so compare paths.
  static func runningCopies(of destination: URL) -> [NSRunningApplication] {
    let path = destination.resolvingSymlinksInPath().path
    return NSRunningApplication.runningApplications(withBundleIdentifier: appBundleIdentifier).filter {
      $0.bundleURL?.resolvingSymlinksInPath().path == path
    }
  }

  // Stages on the destination's volume first so the final swap is atomic.
  static func install(_ app: URL, at destination: URL) throws {
    let fileManager = FileManager.default
    do {
      let staging = try fileManager.url(
        for: .itemReplacementDirectory,
        in: .userDomainMask,
        appropriateFor: destination.deletingLastPathComponent(),
        create: true
      )
      defer { try? fileManager.removeItem(at: staging) }
      let staged = staging.appending(path: app.lastPathComponent)
      try fileManager.moveItem(at: app, to: staged)
      if fileManager.fileExists(atPath: destination.path) {
        _ = try fileManager.replaceItemAt(destination, withItemAt: staged)
      } else {
        try fileManager.moveItem(at: staged, to: destination)
      }
    } catch {
      throw InstallerError.replaceFailed(destination, error)
    }
  }

  private static func isSupatermApp(at url: URL) -> Bool {
    let isSymlink = (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true
    return !isSymlink && Bundle(url: url)?.bundleIdentifier == appBundleIdentifier
  }

  private static func run(_ executable: String, _ arguments: [String]) async throws -> Int32 {
    try await withCheckedThrowingContinuation { continuation in
      let process = Process()
      process.executableURL = URL(filePath: executable)
      process.arguments = arguments
      process.standardOutput = FileHandle.nullDevice
      process.standardError = FileHandle.nullDevice
      process.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
      do {
        try process.run()
      } catch {
        continuation.resume(throwing: error)
      }
    }
  }
}

// A session-level download delegate, because the async download API neither
// reports written bytes to a task delegate nor scales task progress in bytes.
private final class ArchiveDownload: NSObject, URLSessionDownloadDelegate {
  private static let reportingInterval: Int64 = 1 << 20
  private let destination: URL
  private let onProgress: @Sendable (Int64) -> Void
  private var continuation: CheckedContinuation<Void, Error>?
  private var finishError: Error?
  private var lastReported: Int64 = 0

  init(destination: URL, onProgress: @escaping @Sendable (Int64) -> Void) {
    self.destination = destination
    self.onProgress = onProgress
  }

  func run(_ url: URL) async throws {
    let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    let task = session.downloadTask(with: url)
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        task.resume()
      }
    } onCancel: {
      task.cancel()
    }
  }

  func urlSession(
    _: URLSession,
    downloadTask _: URLSessionDownloadTask,
    didWriteData _: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite _: Int64
  ) {
    guard totalBytesWritten - lastReported >= Self.reportingInterval else { return }
    lastReported = totalBytesWritten
    onProgress(totalBytesWritten)
  }

  func urlSession(_: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
    guard (downloadTask.response as? HTTPURLResponse)?.statusCode == 200 else {
      finishError = InstallerError.downloadFailed
      return
    }
    do {
      try FileManager.default.moveItem(at: location, to: destination)
    } catch {
      finishError = error
    }
  }

  func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
    if let failure = error ?? finishError {
      continuation?.resume(throwing: failure)
    } else {
      continuation?.resume()
    }
    continuation = nil
  }
}

enum InstallerDiskImage {
  // The installer runs from its own disk image, which can only be detached
  // after it exits, so a detached shell waits for that and ejects it.
  static func ejectAfterExit() {
    guard let mountPoint = mountPoint(containing: Bundle.main.bundleURL) else { return }
    let process = Process()
    process.executableURL = URL(filePath: "/bin/sh")
    process.arguments = [
      "-c",
      "for attempt in 1 2 3 4 5; do sleep 1; /usr/bin/hdiutil detach \"$0\" -quiet && exit 0; done",
      mountPoint,
    ]
    process.currentDirectoryURL = URL(filePath: "/")
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try? process.run()
  }

  // Gatekeeper may run the installer from a translocated copy outside the
  // image, so that case falls back to matching the installer's bundle and
  // skips ejecting when more than one mounted image could be ours.
  private static func mountPoint(containing bundle: URL) -> String? {
    let process = Process()
    process.executableURL = URL(filePath: "/usr/bin/hdiutil")
    process.arguments = ["info", "-plist"]
    let output = Pipe()
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    guard (try? process.run()) != nil else { return nil }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()

    guard
      let info = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
      let images = info["images"] as? [[String: Any]]
    else { return nil }
    let mountPoints = images
      .flatMap { $0["system-entities"] as? [[String: Any]] ?? [] }
      .compactMap { $0["mount-point"] as? String }
    if let direct = mountPoints.first(where: { bundle.path.hasPrefix($0 + "/") }) {
      return direct
    }
    guard bundle.path.contains("/AppTranslocation/") else { return nil }
    let candidates = mountPoints.filter { mountPoint in
      let candidate = URL(filePath: mountPoint).appending(path: bundle.lastPathComponent)
      return Bundle(url: candidate)?.bundleIdentifier == Bundle.main.bundleIdentifier
    }
    return candidates.count == 1 ? candidates[0] : nil
  }
}
