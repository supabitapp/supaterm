import Foundation
import Testing

@testable import SupatermCLIShared

struct CodexSettingsInstallerTests {
  @Test
  func installCreatesMissingSettingsFile() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.installSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let hooks = try #require(object["hooks"] as? [String: Any])
    #expect(Set(hooks.keys) == canonicalCodexHookEvents)
  }

  @Test
  func installPreservesUnrelatedHooks() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeCodexSettings(
      """
      {
        "hooks": {
          "PreToolUse": [
            {
              "matcher": "Write",
              "hooks": [
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
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.installSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let groups = try codexEventGroupsValue("PreToolUse", in: object)
    let commands =
      groups
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }

    #expect(commands.count == 2)
    #expect(commands.contains("echo keep"))
    #expect(commands.contains(SupatermCodexHookSettings.command))
  }

  @Test
  func installPreservesUnownedCommandsContainingSupaterm() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeCodexSettings(
      """
      {
        "hooks": {
          "LegacyEvent": [
            {
              "hooks": [
                {
                  "command": "echo supaterm old bridge",
                  "timeout": 9,
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

    try installer.installSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let hooks = try #require(object["hooks"] as? [String: Any])
    #expect(hooks["LegacyEvent"] != nil)
  }
}
