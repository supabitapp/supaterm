import Foundation
import Testing

@testable import SupatermCLIShared

extension CodexSettingsInstallerTests {
  @Test
  func removeSupatermHooksPreservesUnrelatedHooksAndDoesNotRequireCodex() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeCodexSettings(
      """
      {
        "hooks": {
          "Stop": [
            {
              "hooks": [
                {
                  "command": "\(SupatermCodexHookSettings.command.replacingOccurrences(of: "\"", with: "\\\""))",
                  "timeout": 10,
                  "type": "command"
                },
                {
                  "command": "echo keep",
                  "timeout": 30,
                  "type": "command"
                }
              ]
            }
          ]
        }
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: {
        Issue.record("removeSupatermHooks should not invoke the enable hooks command.")
        return CodexSettingsInstaller.CommandResult(status: 0, standardError: "")
      }
    )

    try installer.removeSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let commands = try codexEventGroupsValue("Stop", in: object)
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }

    #expect(commands == ["echo keep"])
    #expect(try installer.integrationHealth() == .absent)
  }

  @Test
  func removeSupatermHooksDropsEmptyHooksObject() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeCodexSettings(
      """
      {
        "hooks": {
          "Stop": [
            {
              "hooks": [
                {
                  "command": "\(SupatermCodexHookSettings.command.replacingOccurrences(of: "\"", with: "\\\""))",
                  "timeout": 10,
                  "type": "command"
                }
              ]
            }
          ]
        }
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.removeSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    #expect(object["hooks"] == nil)
  }

  @Test
  func removeDoesNotCreateMissingSettingsFile() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      runVersionCommand: { CodingAgentCommandResult(status: 1) }
    )

    try installer.removeSupatermHooks()

    #expect(
      !FileManager.default.fileExists(
        atPath: CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path
      )
    )
  }

  @Test
  func removeSupatermHooksRemovesTrustState() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let externalState: JSONValue = ["enabled": false]
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      hookState: ["external": externalState]
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") },
      appServer: appServer
    )

    try installer.installSupatermHooks()
    try installer.removeSupatermHooks()

    #expect(appServer.state() == ["external": externalState])
  }

  @Test
  func removeKeepsHooksDisabledWhenTrustWriteFails() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeCodexSettings(
      try SupatermCodexHookSettings.jsonString(),
      homeDirectoryURL: homeDirectoryURL
    )
    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let stopKey = "\(settingsURL.path):stop:0:0"
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      hookState: [stopKey: ["trusted_hash": "sha256:stop"]],
      rejectsBatchWrite: true
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    #expect(throws: CodexSettingsInstallerError.trustCleanupFailed("config/batchWrite")) {
      try installer.removeSupatermHooks()
    }

    #expect(try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)["hooks"] == nil)
  }

  @Test
  func removeDisablesHooksWhenTrustInspectionFails() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeCodexSettings(
      try SupatermCodexHookSettings.jsonString(),
      homeDirectoryURL: homeDirectoryURL
    )
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsConfigRead: true
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    #expect(throws: CodexSettingsInstallerError.trustCleanupFailed("config/read")) {
      try installer.removeSupatermHooks()
    }

    #expect(try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)["hooks"] == nil)
  }

  @Test
  func removeReportsUnknownTrustCleanupOutcomeAfterCommittedWrite() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeCodexSettings(
      try SupatermCodexHookSettings.jsonString(),
      homeDirectoryURL: homeDirectoryURL
    )
    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let stopKey = "\(settingsURL.path):stop:0:0"
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      hookState: [stopKey: ["trusted_hash": "sha256:stop"]],
      rejectsConfigReadAfterBatchWrite: true,
      rejectsBatchWriteAfterCommit: true
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    #expect(throws: CodexSettingsInstallerError.trustCleanupOutcomeUnknown("config/read")) {
      try installer.removeSupatermHooks()
    }

    #expect(try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)["hooks"] == nil)
  }
}
