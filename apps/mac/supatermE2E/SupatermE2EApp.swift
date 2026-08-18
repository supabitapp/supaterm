import Darwin
import Foundation
import SupatermCLIShared
import SupatermSupport

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
  private let workspace: ZmxTestWorkspace
  private var process: Process
  private var client: SPSocketClient
  private let logURL: URL

  static func launch(
    shadowsBundledCLIAtShellStartup: Bool = false,
    zmxSessionsEnabled: Bool = false,
    inheritedEnvironmentKeys: Set<String> = [],
    environment: [String: String] = [:],
    pathDirectories: [URL] = []
  ) async throws -> SupatermE2EApp {
    let app = try SupatermE2EApp(
      shadowsBundledCLIAtShellStartup: shadowsBundledCLIAtShellStartup,
      zmxSessionsEnabled: zmxSessionsEnabled,
      inheritedEnvironmentKeys: inheritedEnvironmentKeys,
      explicitEnvironment: environment,
      pathDirectories: pathDirectories
    )
    try await app.waitUntil("the app socket accepts ping", timeout: 90) {
      (try? app.client.send(.ping()))?.ok == true
    }
    return app
  }

  private init(
    shadowsBundledCLIAtShellStartup: Bool,
    zmxSessionsEnabled: Bool,
    inheritedEnvironmentKeys: Set<String>,
    explicitEnvironment: [String: String],
    pathDirectories: [URL]
  ) throws {
    executable = Self.productsDirectory
      .appendingPathComponent("supaterm.app/Contents/MacOS/supaterm")
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw SupatermE2EError(
        "Missing \(executable.path). Build the supatermE2E scheme (make mac-test-e2e) first."
      )
    }

    let temporaryDirectory = FileManager.default.temporaryDirectory
    try ZmxTestWorkspace.reapAbandoned(
      in: temporaryDirectory,
      stateHomePrefix: "supaterm-e2e-",
      instanceNamePrefix: "e2e-"
    )

    let instanceName = "e2e-\(UUID().uuidString.prefix(8).lowercased())"
    self.instanceName = instanceName
    stateHome =
      temporaryDirectory
      .appendingPathComponent("supaterm-\(instanceName)", isDirectory: true)
    workspace = try ZmxTestWorkspace(stateHome: stateHome, instanceName: instanceName)
    cliHome = stateHome.appendingPathComponent("home", isDirectory: true)
    let runtimeHome = URL(fileURLWithPath: "/tmp/\(instanceName)", isDirectory: true)
    logURL = stateHome.appendingPathComponent("app.log", isDirectory: false)

    try FileManager.default.createDirectory(at: cliHome, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: runtimeHome, withIntermediateDirectories: true)
    let shellPath = SupatermShellCommand.loginShellPath()
    if shadowsBundledCLIAtShellStartup {
      try Self.installShadowCLI(shellPath: shellPath, home: cliHome)
    }
    FileManager.default.createFile(atPath: logURL.path, contents: nil)

    let systemPath = "/usr/bin:/bin:/usr/sbin:/sbin"
    let path = (pathDirectories.map(\.path) + [executable.deletingLastPathComponent().path, systemPath])
      .joined(separator: ":")
    var environment = [
      "HOME": cliHome.path,
      "LOGNAME": NSUserName(),
      "PATH": path,
      "SHELL": shellPath,
      "SUPATERM_TEST_MODE": "1",
      "SUPATERM_VERBOSE_LOGGING": "1",
      "USER": NSUserName(),
      "XDG_RUNTIME_DIR": runtimeHome.path,
      "ZDOTDIR": cliHome.path,
      ZmxEnvironment.directoryKey: workspace.zmxDirectory.path,
      SupatermCLIEnvironment.instanceNameKey: instanceName,
      SupatermCLIEnvironment.stateHomeKey: stateHome.path,
      SupatermCLIEnvironment.testHomeKey: cliHome.path,
    ]
    let processEnvironment = ProcessInfo.processInfo.environment
    for key in inheritedEnvironmentKeys {
      if let value = processEnvironment[key] {
        environment[key] = value
      }
    }
    environment.merge(explicitEnvironment) { _, explicit in explicit }
    if zmxSessionsEnabled {
      environment[ZmxEnvironment.enabledKey] = "1"
    } else {
      environment[ZmxEnvironment.disabledKey] = "1"
    }
    self.environment = environment

    process = Process()
    socketPath = ""
    client = try SPSocketClient(path: "/tmp/supaterm-e2e-unstarted", connectRetryTimeout: 0)
    try startProcess(currentDirectoryURL: cliHome)
  }

  private static var productsDirectory: URL {
    final class BundleToken {}
    return Bundle(for: BundleToken.self).bundleURL.deletingLastPathComponent()
  }

  private static func installShadowCLI(shellPath: String, home: URL) throws {
    let bin = home.appendingPathComponent("bin", isDirectory: true)
    try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)
    let executable = bin.appendingPathComponent("sp", isDirectory: false)
    try """
    #!/bin/sh
    /usr/bin/touch "$HOME/fake-sp"
    exit 127
    """.write(to: executable, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

    let shellName = URL(fileURLWithPath: shellPath).lastPathComponent.lowercased()
    let startup: (path: String, pathCommand: String)
    switch shellName {
    case "fish":
      startup = (".config/fish/config.fish", "set -gx PATH \(bin.path) /usr/bin /bin")
    case "csh", "tcsh":
      startup = (".\(shellName)rc", "setenv PATH \(bin.path):/usr/bin:/bin")
    case "bash":
      startup = (".bash_profile", "export PATH=\(bin.path):/usr/bin:/bin")
    case "zsh":
      startup = (".zshrc", "export PATH=\(bin.path):/usr/bin:/bin")
    case "dash", "ksh", "mksh", "sh":
      startup = (".profile", "export PATH=\(bin.path):/usr/bin:/bin")
    default:
      throw SupatermE2EError("Unsupported test shell: \(shellPath)")
    }

    let startupURL = home.appendingPathComponent(startup.path, isDirectory: false)
    try FileManager.default.createDirectory(
      at: startupURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try """
    \(startup.pathCommand)
    /usr/bin/touch "$HOME/shell-startup"
    """.write(to: startupURL, atomically: true, encoding: .utf8)
  }

  var spExecutable: URL {
    Self.productsDirectory
      .appendingPathComponent("supaterm.app/Contents/MacOS/sp")
  }

  var processIdentifier: pid_t { process.processIdentifier }

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
    try workspace.recordApp(process)
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

  func agentExplain(_ target: SupatermPaneTargetRequest) throws -> SupatermAgentExplainResult {
    try send(.agentExplain(target), as: SupatermAgentExplainResult.self)
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

  func submit(_ text: String, into target: SupatermPaneTargetRequest) throws {
    _ = try send(
      .sendText(SupatermSendTextRequest(mode: .submit, target: target, text: text)),
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
    try await waitForCapture(target, contains: hermeticShellPrompt)
  }

  func waitForShellOutput(_ target: SupatermPaneTargetRequest) async throws {
    try await waitForReadyPane(target)
    try await waitUntil("the shell writes output") {
      (try? capture(target).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) == false
    }
  }

  func waitUntil(
    _ label: String,
    timeout: TimeInterval = 30,
    _ condition: () throws -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    var lastConditionError: Error?
    while Date() < deadline {
      do {
        if try condition() {
          return
        }
      } catch {
        lastConditionError = error
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    let conditionDiagnostics =
      lastConditionError.map {
        "\n--- last condition error ---\n\($0)"
      } ?? ""
    throw SupatermE2EError(
      "Timed out waiting until \(label).\(conditionDiagnostics)\n\(diagnostics())"
    )
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
    contains marker: String,
    timeout: TimeInterval = 30
  ) async throws {
    var lastText = ""
    do {
      try await waitUntil("the pane text contains '\(marker)'", timeout: timeout) {
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

  func terminate(preservingState: Bool = false) {
    if process.isRunning {
      process.terminate()
      waitForProcessStop(timeout: 5)
    }
    if process.isRunning {
      kill(process.processIdentifier, SIGKILL)
      waitForProcessStop(timeout: 2)
    }

    guard !preservingState else { return }
    try? workspace.cleanup()
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
