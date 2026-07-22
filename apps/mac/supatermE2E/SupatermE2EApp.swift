import Darwin
import Foundation
import SupatermCLIShared

@testable import SPCLI

struct SupatermE2EError: Error, CustomStringConvertible {
  let description: String

  init(_ description: String) {
    self.description = description
  }
}

final class SupatermE2EApp: @unchecked Sendable {
  let instanceName: String
  let stateHome: URL
  let cliHome: URL
  private(set) var socketPath: String
  private let environment: [String: String]
  private let executable: URL
  private var process: Process
  private var client: SPSocketClient
  private let logURL: URL

  static func launch() async throws -> SupatermE2EApp {
    let app = try SupatermE2EApp()
    try await app.waitUntil("the app socket accepts ping", timeout: 90) {
      (try? app.client.send(.ping()))?.ok == true
    }
    return app
  }

  private init() throws {
    executable = Self.productsDirectory
      .appendingPathComponent("supaterm.app/Contents/MacOS/supaterm")
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw SupatermE2EError(
        "Missing \(executable.path). Build the supatermE2E scheme (make mac-test-e2e) first."
      )
    }

    let instanceName = "e2e-\(UUID().uuidString.prefix(8).lowercased())"
    self.instanceName = instanceName
    stateHome = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-\(instanceName)", isDirectory: true)
    cliHome = stateHome.appendingPathComponent("home", isDirectory: true)
    let runtimeHome = URL(fileURLWithPath: "/tmp/\(instanceName)", isDirectory: true)
    logURL = stateHome.appendingPathComponent("app.log", isDirectory: false)

    try FileManager.default.createDirectory(at: cliHome, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: runtimeHome, withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: cliHome.appendingPathComponent(".zshrc").path, contents: nil)
    FileManager.default.createFile(atPath: logURL.path, contents: nil)

    environment = [
      "HOME": cliHome.path,
      "LOGNAME": NSUserName(),
      "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
      "SHELL": "/bin/zsh",
      "SUPATERM_TEST_MODE": "1",
      "SUPATERM_VERBOSE_LOGGING": "1",
      "USER": NSUserName(),
      "XDG_RUNTIME_DIR": runtimeHome.path,
      SupatermCLIEnvironment.instanceNameKey: instanceName,
      SupatermCLIEnvironment.stateHomeKey: stateHome.path,
    ]

    process = Process()
    socketPath = ""
    client = try SPSocketClient(path: "/tmp/supaterm-e2e-unstarted", connectRetryTimeout: 0)
    try startProcess(currentDirectoryURL: cliHome)
  }

  private static var productsDirectory: URL {
    final class BundleToken {}
    return Bundle(for: BundleToken.self).bundleURL.deletingLastPathComponent()
  }

  var spExecutable: URL {
    Self.productsDirectory
      .appendingPathComponent("supaterm.app/Contents/Resources/bin/sp")
  }

  func cliEnvironment(context: SupatermCLIContext? = nil) -> [String: String] {
    var result = environment
    result[SupatermCLIEnvironment.socketPathKey] = socketPath
    result[SupatermCLIEnvironment.cliPathKey] = spExecutable.path
    result[SupatermCLIEnvironment.testCodexEnableHooksKey] = "1"
    result[SupatermCLIEnvironment.testHomeKey] = cliHome.path
    if let context {
      result[SupatermCLIEnvironment.surfaceIDKey] = context.surfaceID.uuidString
      result[SupatermCLIEnvironment.tabIDKey] = context.tabID.uuidString
    }
    return result
  }

  func context(tabID: UUID, paneID: UUID) -> SupatermCLIContext {
    SupatermCLIContext(surfaceID: paneID, tabID: tabID)
  }

  private var zmxSessionPrefix: String {
    "spt-\(SupatermInstanceIdentity.stableHash(for: instanceName))-"
  }

  private func startProcess(currentDirectoryURL: URL) throws {
    let log = try FileHandle(forWritingTo: logURL)
    try log.seekToEnd()
    let process = Process()
    process.executableURL = executable
    process.environment = environment
    process.currentDirectoryURL = currentDirectoryURL
    process.standardOutput = log
    process.standardError = log
    try process.run()
    self.process = process
    socketPath =
      SupatermSocketPath.managedSocketURL(
        instanceName: instanceName,
        processID: process.processIdentifier,
        environment: environment
      ).path
    client = try SPSocketClient(path: socketPath, connectRetryTimeout: 0.2)
  }

  func send<Result: Decodable>(
    _ request: SupatermSocketRequest,
    as type: Result.Type
  ) throws -> Result {
    let response = try client.send(request)
    guard response.ok else {
      throw SupatermE2EError(
        "\(request.method) failed: \(response.error?.message ?? "unknown error")"
      )
    }
    return try response.decodeResult(type)
  }

  func sendExpectingError(_ request: SupatermSocketRequest) throws -> String {
    let response = try client.send(request)
    guard !response.ok, let message = response.error?.message else {
      throw SupatermE2EError("\(request.method) unexpectedly succeeded")
    }
    return message
  }

  func debugSnapshot() throws -> SupatermAppDebugSnapshot {
    try send(.debug(SupatermDebugRequest()), as: SupatermAppDebugSnapshot.self)
  }

  func debugTab(_ tabID: UUID) throws -> SupatermAppDebugSnapshot.Tab? {
    try debugSnapshot()
      .windows
      .flatMap(\.spaces)
      .flatMap(\.flattenedTabs)
      .first { $0.id == tabID }
  }

  func debugRootTab(_ tabID: UUID) throws -> SupatermAppDebugSnapshot.RootTab? {
    try debugSnapshot()
      .windows
      .flatMap(\.spaces)
      .lazy
      .compactMap { e2eRootTab(withID: tabID, in: $0) }
      .first
  }

  func debugPane(_ paneID: UUID) throws -> SupatermAppDebugSnapshot.Pane? {
    try debugSnapshot()
      .windows
      .flatMap(\.spaces)
      .flatMap(\.flattenedTabs)
      .flatMap(\.panes)
      .first { $0.id == paneID }
  }

  func capture(
    _ target: SupatermPaneTargetRequest,
    scope: SupatermCapturePaneScope = .visible,
    lines: Int? = nil
  ) throws -> String {
    try send(
      .capturePane(SupatermCapturePaneRequest(lines: lines, scope: scope, target: target)),
      as: SupatermCapturePaneResult.self
    ).text
  }

  func type(_ text: String, into target: SupatermPaneTargetRequest) throws {
    _ = try send(
      .sendText(SupatermSendTextRequest(target: target, text: text)),
      as: SupatermSendTextResult.self
    )
  }

  func press(_ key: SupatermInputKey, in target: SupatermPaneTargetRequest) throws {
    _ = try send(
      .sendKey(SupatermSendKeyRequest(key: key, target: target)),
      as: SupatermSendKeyResult.self
    )
  }

  func waitForShellPrompt(_ target: SupatermPaneTargetRequest) async throws {
    try await waitForReadyPane(target)
    try await waitUntil("the shell renders a prompt") {
      try !capture(target).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
  }

  func waitUntil(
    _ label: String,
    timeout: TimeInterval = 30,
    _ condition: () throws -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if try condition() {
        return
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    throw SupatermE2EError("Timed out waiting until \(label).\n\(diagnostics())")
  }

  func waitForDebugSnapshot(
    _ label: String,
    timeout: TimeInterval = 30,
    _ condition: (SupatermAppDebugSnapshot) throws -> Bool
  ) async throws {
    var lastSnapshot: SupatermAppDebugSnapshot?
    do {
      try await waitUntil(label, timeout: timeout) {
        let snapshot = try debugSnapshot()
        lastSnapshot = snapshot
        return try condition(snapshot)
      }
    } catch {
      throw SupatermE2EError(
        "\(error)\n--- last debug snapshot ---\n\(String(describing: lastSnapshot))"
      )
    }
  }

  func waitForCapture(
    _ target: SupatermPaneTargetRequest,
    contains marker: String
  ) async throws {
    var lastText = ""
    do {
      try await waitUntil("the pane text contains '\(marker)'") {
        lastText = (try? capture(target)) ?? lastText
        return lastText.replacingOccurrences(of: "\n", with: "").contains(marker)
      }
    } catch {
      throw SupatermE2EError("\(error)\n--- last pane capture ---\n\(lastText)")
    }
  }

  func waitForReadyPane(_ target: SupatermPaneTargetRequest) async throws {
    var lastHealth: SupatermPaneHealthResult?
    do {
      try await waitUntil("the pane is ready to capture") {
        let health = try send(
          .paneHealth(SupatermPaneHealthRequest(target: target)),
          as: SupatermPaneHealthResult.self
        )
        lastHealth = health
        return health.isReady && health.canCaptureText
      }
    } catch {
      throw SupatermE2EError(
        "\(error)\n--- last pane health ---\n\(lastHealth.map(String.init(describing:)) ?? "none")")
    }
  }

  func quit() async throws {
    _ = try client.send(.quit())
    try await waitForProcessExit(timeout: 10)
  }

  func relaunch() async throws {
    guard !process.isRunning else {
      throw SupatermE2EError("Cannot relaunch while the app process is still running.")
    }
    guard let currentDirectoryURL = process.currentDirectoryURL else {
      throw SupatermE2EError("Missing launch current directory.")
    }
    try startProcess(currentDirectoryURL: currentDirectoryURL)
    try await waitUntil("the relaunched app socket accepts ping", timeout: 90) {
      (try? client.send(.ping()))?.ok == true
    }
  }

  func waitForPersistedStateQuiescence(
    timeout: TimeInterval = 5,
    containing requiredContents: [String] = []
  ) async throws {
    let files = [
      stateHome.appendingPathComponent("session.json", isDirectory: false),
      stateHome.appendingPathComponent("spaces.json", isDirectory: false),
    ]
    let deadline = Date().addingTimeInterval(timeout)
    var stableSince: Date?
    var lastFingerprint: [String]?
    while Date() < deadline {
      try await Task.sleep(for: .milliseconds(100))
      guard let nextSnapshot = try persistedStateSnapshot(files),
        requiredContents.allSatisfy({ nextSnapshot.contents.contains($0) })
      else {
        stableSince = nil
        lastFingerprint = nil
        continue
      }
      if nextSnapshot.fingerprint == lastFingerprint {
        let now = Date()
        stableSince = stableSince ?? now
        if let stableSince, now.timeIntervalSince(stableSince) >= 1.2 {
          return
        }
      } else {
        stableSince = nil
        lastFingerprint = nextSnapshot.fingerprint
      }
    }
    throw SupatermE2EError("Timed out waiting for persisted state quiescence.")
  }

  func terminate(preservingZmxSessions: Bool = false) {
    if process.isRunning {
      process.terminate()
      waitForProcessStop(timeout: 5)
    }
    if process.isRunning {
      kill(process.processIdentifier, SIGKILL)
      waitForProcessStop(timeout: 2)
    }

    guard !preservingZmxSessions else { return }
    let pkill = Process()
    pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
    pkill.arguments = ["-f", zmxSessionPrefix]
    try? pkill.run()
    pkill.waitUntilExit()
  }

  private func waitForProcessExit(timeout: TimeInterval) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning, Date() < deadline {
      try await Task.sleep(for: .milliseconds(100))
    }
    guard !process.isRunning else {
      throw SupatermE2EError("Timed out waiting for app process exit.")
    }
  }

  private func waitForProcessStop(timeout: TimeInterval) {
    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning, Date() < deadline {
      Thread.sleep(forTimeInterval: 0.1)
    }
  }

  private func persistedStateSnapshot(_ files: [URL]) throws -> (
    fingerprint: [String],
    contents: String
  )? {
    var contents = ""
    let fingerprint = try files.map { file in
      guard FileManager.default.fileExists(atPath: file.path) else {
        return nil as String?
      }
      let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
      let size = attributes[.size] as? NSNumber
      let modified = attributes[.modificationDate] as? Date
      contents += (try? String(contentsOf: file, encoding: .utf8)) ?? ""
      return
        "\(file.lastPathComponent):\(size?.uint64Value ?? 0):\(modified?.timeIntervalSince1970 ?? 0)"
    }
    guard !fingerprint.contains(nil) else { return nil }
    return (fingerprint.compactMap(\.self), contents)
  }

  private func diagnostics() -> String {
    let log = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
    let tail = log.split(separator: "\n").suffix(40).joined(separator: "\n")
    return "--- app log tail ---\n\(tail)"
  }
}
