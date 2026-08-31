import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

private let expectedCodexTerminalTitle: JSONValue = ["activity", "thread-title", "task-progress"]

extension CodexSettingsInstallerTests {
  @Test
  func configureSetsTerminalTitle() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexConfigurationServer(homeDirectoryURL: homeDirectoryURL)
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    try installer.configureForSupaterm()

    #expect(server.terminalTitle() == expectedCodexTerminalTitle)
    #expect(server.batchWriteCount() == 1)
  }

  @Test
  func configureIsIdempotent() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexConfigurationServer(homeDirectoryURL: homeDirectoryURL)
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    try installer.configureForSupaterm()
    try installer.configureForSupaterm()

    #expect(server.terminalTitle() == expectedCodexTerminalTitle)
    #expect(server.batchWriteCount() == 1)
  }

  @Test(
    arguments: [
      JSONValue.array(["run-state"]),
      .array([]),
      .null,
    ]
  )
  func configurePreservesExistingTerminalTitle(_ terminalTitle: JSONValue) throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexConfigurationServer(
      homeDirectoryURL: homeDirectoryURL,
      terminalTitle: terminalTitle
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    try installer.configureForSupaterm()

    #expect(server.terminalTitle() == terminalTitle)
    #expect(server.batchWriteCount() == 0)
  }

  @Test
  func configurePreservesConcurrentTerminalTitle() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let terminalTitle: JSONValue = ["run-state"]
    let server = TestCodexConfigurationServer(
      homeDirectoryURL: homeDirectoryURL,
      beforeBatchWrite: { $0.setTerminalTitle(terminalTitle) }
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    try installer.configureForSupaterm()

    #expect(server.terminalTitle() == terminalTitle)
    #expect(server.batchWriteCount() == 1)
  }

  @Test
  func configureAcceptsCommittedWriteAfterResponseFailure() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexConfigurationServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsBatchWriteAfterCommit: true
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    try installer.configureForSupaterm()

    #expect(server.terminalTitle() == expectedCodexTerminalTitle)
    #expect(server.batchWriteCount() == 1)
  }

  @Test
  func configureReportsUnknownWriteOutcome() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexConfigurationServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsConfigReadAfterBatchWrite: true,
      rejectsBatchWriteAfterCommit: true
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    #expect(throws: CodexSettingsInstallerError.configWriteOutcomeUnknown("config/read")) {
      try installer.configureForSupaterm()
    }
  }
}

private func configurationInstaller(
  homeDirectoryURL: URL,
  server: TestCodexConfigurationServer
) -> CodexSettingsInstaller {
  CodexSettingsInstaller(
    homeDirectoryURL: homeDirectoryURL,
    runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
    appServerClient: server.client
  )
}

nonisolated private final class TestCodexConfigurationServer: @unchecked Sendable {
  private let homeDirectoryURL: URL
  private let rejectsConfigReadAfterBatchWrite: Bool
  private let rejectsBatchWriteAfterCommit: Bool
  private let beforeBatchWrite: @Sendable (TestCodexConfigurationServer) throws -> Void
  private let lock = NSLock()
  private var storedTerminalTitle: JSONValue?
  private var writeCount = 0
  private var version = 1

  init(
    homeDirectoryURL: URL,
    terminalTitle: JSONValue? = nil,
    rejectsConfigReadAfterBatchWrite: Bool = false,
    rejectsBatchWriteAfterCommit: Bool = false,
    beforeBatchWrite: @escaping @Sendable (TestCodexConfigurationServer) throws -> Void = { _ in }
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    storedTerminalTitle = terminalTitle
    self.rejectsConfigReadAfterBatchWrite = rejectsConfigReadAfterBatchWrite
    self.rejectsBatchWriteAfterCommit = rejectsBatchWriteAfterCommit
    self.beforeBatchWrite = beforeBatchWrite
  }

  var client: CodexAppServerClient {
    CodexAppServerClient(request: request(method:params:))
  }

  func terminalTitle() -> JSONValue? {
    lock.lock()
    let result = storedTerminalTitle
    lock.unlock()
    return result
  }

  func batchWriteCount() -> Int {
    lock.lock()
    let result = writeCount
    lock.unlock()
    return result
  }

  func setTerminalTitle(_ value: JSONValue) {
    lock.lock()
    storedTerminalTitle = value
    version += 1
    lock.unlock()
  }

  private func request(method: String, params: JSONObject) throws -> JSONValue {
    switch method {
    case "config/read":
      return try configReadResponse()
    case "config/batchWrite":
      return try batchWriteResponse(params: params)
    default:
      throw CodexAppServerClientError.serverRejected(method)
    }
  }

  private func configReadResponse() throws -> JSONValue {
    lock.lock()
    let shouldReject = rejectsConfigReadAfterBatchWrite && writeCount > 0
    let terminalTitle = storedTerminalTitle
    let currentVersion = version
    lock.unlock()
    if shouldReject {
      throw CodexAppServerClientError.serverRejected("config/read")
    }
    var config: JSONObject = [:]
    if let terminalTitle {
      config["tui"] = ["terminal_title": terminalTitle]
    }
    return [
      "config": ["features": ["hooks": true]],
      "origins": [:],
      "layers": [
        [
          "name": [
            "type": "user",
            "file": .string(configURL.path),
            "profile": nil,
          ],
          "version": .string("version-\(currentVersion)"),
          "config": .object(config),
        ]
      ],
    ]
  }

  private func batchWriteResponse(params: JSONObject) throws -> JSONValue {
    lock.lock()
    writeCount += 1
    lock.unlock()
    try beforeBatchWrite(self)
    guard
      let edits = params["edits"]?.arrayValue,
      edits.count == 1,
      let edit = edits.first?.objectValue,
      edit["keyPath"]?.stringValue == "tui.terminal_title",
      edit["mergeStrategy"]?.stringValue == "replace",
      let value = edit["value"],
      params["filePath"]?.stringValue == configURL.path,
      params["reloadUserConfig"]?.boolValue == true
    else {
      throw CodexAppServerClientError.invalidResponse("config/batchWrite")
    }
    lock.lock()
    let currentVersion = "version-\(version)"
    guard params["expectedVersion"]?.stringValue == currentVersion else {
      lock.unlock()
      throw CodexAppServerClientError.serverRejected("config/batchWrite")
    }
    storedTerminalTitle = value
    version += 1
    let nextVersion = version
    lock.unlock()
    if rejectsBatchWriteAfterCommit {
      throw CodexAppServerClientError.serverRejected("config/batchWrite")
    }
    return [
      "status": "ok",
      "version": .string("version-\(nextVersion)"),
      "filePath": .string(configURL.path),
      "overriddenMetadata": nil,
    ]
  }

  private var configURL: URL {
    CodexSettingsInstaller.configURL(homeDirectoryURL: homeDirectoryURL)
  }
}
