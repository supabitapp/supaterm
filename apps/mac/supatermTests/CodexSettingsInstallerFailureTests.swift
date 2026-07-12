import Foundation
import Testing

@testable import SupatermCLIShared

extension CodexSettingsInstallerTests {
  @Test
  func installFailsWithoutOverwritingInvalidJSON() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let invalidJSON = """
      {
        "hooks":
      """
    try writeCodexSettings(invalidJSON, homeDirectoryURL: homeDirectoryURL)

    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    #expect(throws: CodexSettingsInstallerError.invalidJSON) {
      try installer.installSupatermHooks()
    }

    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let contents = try String(contentsOf: settingsURL, encoding: .utf8)
    #expect(contents == invalidJSON)
  }

  @Test
  func installFailsWhenCodexIsUnavailable() {
    let installer = testCodexSettingsInstaller(
      runEnableHooksCommand: {
        throw CodexSettingsInstallerError.codexUnavailable
      }
    )

    #expect(throws: CodexSettingsInstallerError.codexUnavailable) {
      try installer.installSupatermHooks()
    }
  }

  @Test
  func installMapsMissingVersionCommandToCodexUnavailable() {
    let installer = testCodexSettingsInstaller(
      runEnableHooksCommand: {
        Issue.record("The hooks feature must not be enabled when Codex is unavailable.")
        return CodingAgentCommandResult(status: 0)
      },
      runVersionCommand: {
        CodingAgentCommandResult(status: 127)
      }
    )

    #expect(throws: CodexSettingsInstallerError.codexUnavailable) {
      try installer.installSupatermHooks()
    }
  }

  @Test
  func installRejectsUnsupportedCodexVersion() {
    let installer = testCodexSettingsInstaller(
      runEnableHooksCommand: {
        Issue.record("The hooks feature must not be enabled for an unsupported Codex version.")
        return CodingAgentCommandResult(status: 0)
      },
      runVersionCommand: {
        CodingAgentCommandResult(status: 0, standardOutput: "codex-cli 0.144.0")
      }
    )

    #expect(throws: CodexSettingsInstallerError.unsupportedCodexVersion) {
      try installer.installSupatermHooks()
    }
  }

  @Test
  func installFailsWhenCodexFeatureEnableCommandFails() {
    let installer = testCodexSettingsInstaller(
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 1, standardError: "feature update failed") }
    )

    #expect(throws: CodexSettingsInstallerError.enableHooksFailed("feature update failed")) {
      try installer.installSupatermHooks()
    }
  }
}
