import Foundation
import Synchronization
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

extension CodexSettingsInstallerTests {
  @Test
  func integrationHealthIsUnavailableBeforeMinimumCodexVersion() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0, standardError: "") },
      runVersionCommand: {
        CodingAgentCommandResult(status: 0, standardOutput: "codex-cli 0.144.0")
      },
      runHooksFeatureCommand: {
        CodingAgentCommandResult(status: 0, standardOutput: "hooks stable true")
      }
    )

    #expect(try installer.integrationHealth() == .unavailable)
  }

  @Test
  func integrationHealthKeepsInstalledHooksRemovableBeforeMinimumVersion() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeCodexSettings(
      try canonicalCodexHookSettings(homeDirectoryURL: homeDirectoryURL),
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      runVersionCommand: {
        CodingAgentCommandResult(status: 0, standardOutput: "codex-cli 0.144.0")
      }
    )

    #expect(try installer.integrationHealth() == .unavailableInstalled)
  }

  @Test
  func integrationHealthAcceptsMinimumCodexVersion() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      runVersionCommand: {
        CodingAgentCommandResult(status: 0, standardOutput: "codex-cli 0.144.1")
      }
    )

    #expect(try installer.integrationHealth() == .absent)
  }

  @Test
  func integrationHealthRequiresCanonicalTrustState() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeCodexSettings(
      try canonicalCodexHookSettings(homeDirectoryURL: homeDirectoryURL),
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0, standardError: "") }
    )

    #expect(try installer.integrationHealth() == .drifted)
  }

  @Test
  func integrationHealthRequiresEnabledHooksFeature() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let hooksFeatureEnabled = Mutex(true)
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      hooksFeatureEnabled: {
        hooksFeatureEnabled.withLock { $0 }
      }
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )
    try installer.installSupatermHooks()
    hooksFeatureEnabled.withLock { $0 = false }

    #expect(try installer.integrationHealth() == .drifted)
  }

  @Test
  func integrationHealthIgnoresUnownedSupatermSubstring() throws {
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
                  "command": "echo SuPaTeRm bridge",
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

    #expect(try installer.integrationHealth() == .absent)
  }

  @Test
  func integrationHealthFindsShippedDirectHooksDrifted() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let command = try canonicalCodexHookCommand(homeDirectoryURL: homeDirectoryURL)
    let settings = try canonicalCodexHookSettings(
      homeDirectoryURL: homeDirectoryURL
    ).replacingOccurrences(
      of: command,
      with: expectedSupatermHookCommand(agent: "codex")
    )
    try writeCodexSettings(settings, homeDirectoryURL: homeDirectoryURL)
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) }
    )

    #expect(try installer.integrationHealth() == .drifted)
  }

  @Test
  func integrationHealthFindsMovedCLIPathDrifted() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      cliPath: "/Applications/Supaterm.app/Contents/MacOS/sp",
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) }
    )
    try installer.installSupatermHooks()
    let movedInstaller = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      cliPath: "/Users/example/Applications/Supaterm.app/Contents/MacOS/sp",
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) }
    )

    #expect(try movedInstaller.integrationHealth() == .drifted)
  }

  @Test
  func integrationHealthRejectsBlankCLIPath() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let appServer = TestCodexAppServer(homeDirectoryURL: homeDirectoryURL)
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )
    try installer.installSupatermHooks()
    let missingCLIInstaller = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      cliPath: "",
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    #expect(try missingCLIInstaller.integrationHealth() == .drifted)
  }
}
