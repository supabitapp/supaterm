import Foundation
import Testing

@testable import SupatermSupport

extension CodexSettingsInstallerTests {
  @Test
  func installRestoresHooksFileWhenNativeWriteFails() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let original = """
      {"hooks":{"Stop":[{"hooks":[{"command":"echo keep","timeout":30,"type":"command"}]}]}}
      """
    try writeCodexSettings(original, homeDirectoryURL: homeDirectoryURL)
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsBatchWrite: true
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    #expect(throws: CodexAppServerClientError.serverRejected("config/batchWrite")) {
      try installer.installSupatermHooks()
    }

    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    #expect(try String(contentsOf: settingsURL, encoding: .utf8) == original)
    #expect(
      !FileManager.default.fileExists(
        atPath: CodexSettingsInstaller.bridgeURL(homeDirectoryURL: homeDirectoryURL).path
      )
    )
  }

  @Test
  func installRestoresExistingBridgeWhenNativeWriteFails() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let bridgeURL = CodexSettingsInstaller.bridgeURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: bridgeURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    let original = Data("old bridge".utf8)
    try original.write(to: bridgeURL)
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: TestCodexAppServer(
        homeDirectoryURL: homeDirectoryURL,
        rejectsBatchWrite: true
      )
    )

    #expect(throws: CodexAppServerClientError.serverRejected("config/batchWrite")) {
      try installer.installSupatermHooks()
    }

    #expect(try Data(contentsOf: bridgeURL) == original)
  }

  @Test
  func installDoesNotOverwriteConcurrentHookEditDuringRollback() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let original = #"{"hooks":{}}"#
    let concurrent = #"{"concurrent":true}"#
    try writeCodexSettings(original, homeDirectoryURL: homeDirectoryURL)
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsBatchWrite: true,
      beforeBatchWriteResponse: {
        try writeCodexSettings(concurrent, homeDirectoryURL: homeDirectoryURL)
      }
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    #expect(throws: CodexAppServerClientError.serverRejected("config/batchWrite")) {
      try installer.installSupatermHooks()
    }
    #expect(
      try String(
        contentsOf: CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL),
        encoding: .utf8
      ) == concurrent
    )
  }

  @Test
  func installRollsBackToExactMutationPreimage() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let original = #"{"hooks":{}}"#
    let concurrent = #"{"hooks":{"Stop":[{"hooks":[{"command":"echo concurrent","timeout":30,"type":"command"}]}]}}"#
    try writeCodexSettings(original, homeDirectoryURL: homeDirectoryURL)
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      afterFirstHooksList: {
        try writeCodexSettings(concurrent, homeDirectoryURL: homeDirectoryURL)
      }
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    #expect(throws: CodexSettingsInstallerError.nativeHooksMismatch) {
      try installer.installSupatermHooks()
    }

    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    #expect(try String(contentsOf: settingsURL, encoding: .utf8) == concurrent)
  }
}
