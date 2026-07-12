import Foundation
import Testing

@testable import SupatermCLIShared

extension CodexSettingsInstallerTests {
  @Test
  func installTrustsSupatermHooksInCodexConfig() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let appServer = TestCodexAppServer(homeDirectoryURL: homeDirectoryURL)
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") },
      appServer: appServer
    )

    try installer.installSupatermHooks()

    let state = appServer.state()
    let hooksPath = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path
    #expect(state.count == 8)
    #expect(state.keys.allSatisfy { $0.hasPrefix(hooksPath + ":") })
    #expect(
      state.values.allSatisfy {
        $0.objectValue?["trusted_hash"]?.stringValue?.hasPrefix("sha256:") == true
      }
    )
  }

  @Test
  func installAcceptsCommittedTrustWhenWriteResponseFails() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      rejectsBatchWriteAfterCommit: true
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    try installer.installSupatermHooks()

    #expect(try installer.integrationHealth() == .healthy)
  }

  @Test(
    .enabled(
      if: codexExecutableIsAvailable(),
      "Codex must be available in the login shell."
    )
  )
  func liveAppServerInstallsAndRemovesCanonicalTrust() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let configURL = CodexSettingsInstaller.configURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: configURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try "[features]\nhooks = true\n".write(
      to: configURL,
      atomically: true,
      encoding: .utf8
    )
    let appServerClient = CodexAppServerClient(homeDirectoryURL: homeDirectoryURL)
    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServerClient: appServerClient
    )

    try installer.installSupatermHooks()

    let installed = try appServerClient.readUserConfig(
      cwd: homeDirectoryURL,
      configURL: configURL
    )
    #expect(try installer.integrationHealth() == .healthy)
    #expect(installed.hookState.count == canonicalCodexHookEvents.count)
    #expect(
      installed.hookState.values.allSatisfy {
        $0.objectValue?["trusted_hash"]?.stringValue != nil
      }
    )

    try installer.removeSupatermHooks()

    let removed = try appServerClient.readUserConfig(
      cwd: homeDirectoryURL,
      configURL: configURL
    )
    #expect(removed.hookState.isEmpty)
  }

  @Test
  func installClearsDisabledStateWhenTrusting() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let stopKey = "\(CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path):stop:0:0"
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      hookState: [stopKey: ["enabled": false]]
    )

    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") },
      appServer: appServer
    )

    try installer.installSupatermHooks()

    let state = try #require(appServer.state()[stopKey]?.objectValue)
    #expect(state["enabled"] == nil)
    #expect(state["trusted_hash"]?.stringValue?.hasPrefix("sha256:") == true)
  }

  @Test
  func installRemovesTrustForDisplacedSupatermHooks() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let appServer = TestCodexAppServer(homeDirectoryURL: homeDirectoryURL)
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0, standardError: "") },
      appServer: appServer
    )
    try installer.installSupatermHooks()

    var object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    var hooks = try #require(object["hooks"] as? [String: Any])
    var stopGroups = try #require(hooks["Stop"] as? [[String: Any]])
    stopGroups.insert(
      [
        "hooks": [
          ["command": "echo keep", "timeout": 30, "type": "command"]
        ]
      ],
      at: 0
    )
    hooks["Stop"] = stopGroups
    object["hooks"] = hooks
    try writeCodexSettingsObject(object, homeDirectoryURL: homeDirectoryURL)

    try installer.installSupatermHooks()

    let settingsPath = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path
    let state = appServer.state()
    #expect(state["\(settingsPath):stop:0:0"] == nil)
    #expect(
      state["\(settingsPath):stop:1:0"]?.objectValue?["trusted_hash"]?.stringValue?.hasPrefix("sha256:")
        == true
    )
    #expect(try installer.integrationHealth() == .healthy)
  }

  @Test
  func installRebasesUnrelatedStateAndRemovesOrphans() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let command = SupatermCodexHookSettings.command.replacingOccurrences(of: "\"", with: "\\\"")
    try writeCodexSettings(
      """
      {
        "hooks": {
          "Stop": [
            {"hooks": [{"command": "\(command)", "timeout": 10, "type": "command"}]},
            {"hooks": [{"command": "echo keep", "timeout": 30, "type": "command"}]}
          ]
        }
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    let externalState: JSONValue = ["enabled": false]
    let unrelatedState: JSONValue = ["enabled": false, "trusted_hash": "sha256:user"]
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      hookState: [
        "external": externalState,
        "\(settingsURL.path):stop:1:0": unrelatedState,
        "\(settingsURL.path):stop:99:0": ["trusted_hash": "sha256:orphan"],
      ]
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    try installer.installSupatermHooks()

    let state = appServer.state()
    #expect(state["external"] == externalState)
    #expect(state["\(settingsURL.path):stop:0:0"] == ["enabled": false])
    #expect(state["\(settingsURL.path):stop:1:0"]?.objectValue?["trusted_hash"] != nil)
    #expect(state["\(settingsURL.path):stop:99:0"] == nil)
  }

  @Test
  func installIgnoresIdenticalHooksFromAnotherSource() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let appServer = TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      duplicateSourcePath: "/tmp/other-hooks.json"
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) },
      appServer: appServer
    )

    try installer.installSupatermHooks()

    #expect(
      !appServer.state().keys.contains(where: { $0.hasPrefix("/tmp/other-hooks.json:") })
    )
  }
}
