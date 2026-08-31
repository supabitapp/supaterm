import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

private let expectedCodexTerminalTitle: JSONValue = ["activity", "thread-title", "task-progress"]

extension CodexSettingsInstallerTests {
  @Test
  func setupWritesHooksAndMissingTerminalTitleInOneBatch() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexAppServer(homeDirectoryURL: homeDirectoryURL)
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    let health = try installer.setup()

    #expect(health == .healthy)
    #expect(server.terminalTitle() == expectedCodexTerminalTitle)
    #expect(server.state().count == canonicalCodexHookEvents.count)
    #expect(server.batchWriteKeyPaths() == [["hooks.state", "tui.terminal_title"]])
    #expect(server.userConfigReadCount() == 1)
  }

  @Test
  func setupIsIdempotent() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexAppServer(homeDirectoryURL: homeDirectoryURL)
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    #expect(try installer.setup() == .healthy)
    #expect(try installer.setup() == .healthy)

    #expect(server.terminalTitle() == expectedCodexTerminalTitle)
    #expect(server.batchWriteCount() == 1)
    #expect(server.userConfigReadCount() == 2)
  }

  @Test(
    arguments: [
      JSONValue.array(["run-state"]),
      .array([]),
      .null,
    ]
  )
  func setupPreservesExistingTerminalTitle(_ terminalTitle: JSONValue) throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      terminalTitle: terminalTitle
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    #expect(try installer.setup() == .healthy)

    #expect(server.terminalTitle() == terminalTitle)
    #expect(server.batchWriteKeyPaths() == [["hooks.state"]])
    #expect(server.userConfigReadCount() == 1)
  }

  @Test
  func setupPreservesConcurrentTerminalTitle() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let terminalTitle: JSONValue = ["run-state"]
    let server = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      beforeBatchWriteResponse: { $0.setTerminalTitle(terminalTitle) }
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    #expect(try installer.setup() == .healthy)

    #expect(server.terminalTitle() == terminalTitle)
    #expect(
      server.batchWriteKeyPaths()
        == [
          ["hooks.state", "tui.terminal_title"],
          ["hooks.state"],
        ]
    )
    #expect(server.userConfigReadCount() == 2)
  }

  @Test
  func setupAcceptsCommittedWriteAfterResponseFailure() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsBatchWriteAfterCommit: true
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    #expect(try installer.setup() == .healthy)

    #expect(server.terminalTitle() == expectedCodexTerminalTitle)
    #expect(server.batchWriteCount() == 1)
    #expect(server.userConfigReadCount() == 2)
  }

  @Test
  func setupReportsUnknownWriteOutcome() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsConfigReadAfterBatchWrite: true,
      rejectsBatchWriteAfterCommit: true
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    #expect(throws: CodexSettingsInstallerError.configWriteOutcomeUnknown("config/read")) {
      try installer.setup()
    }
  }

  @Test
  func setupRollsBackHooksWhenConfigWriteFails() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let server = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsBatchWrite: true
    )
    let installer = configurationInstaller(
      homeDirectoryURL: homeDirectoryURL,
      server: server
    )

    #expect(throws: CodexAppServerClientError.serverRejected("config/batchWrite")) {
      try installer.setup()
    }

    #expect(
      !FileManager.default.fileExists(
        atPath: CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path
      )
    )
  }
}

private func configurationInstaller(
  homeDirectoryURL: URL,
  server: TestCodexAppServer
) -> CodexSettingsInstaller {
  testCodexSettingsInstaller(
    homeDirectoryURL: homeDirectoryURL,
    runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
    appServer: server
  )
}
