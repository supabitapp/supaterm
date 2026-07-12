import Foundation
import Testing

@testable import SupatermCLIShared

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
