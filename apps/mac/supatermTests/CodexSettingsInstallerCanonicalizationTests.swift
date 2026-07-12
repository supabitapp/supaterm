import Foundation
import Testing

@testable import SupatermCLIShared

extension CodexSettingsInstallerTests {
  @Test
  func installCanonicalizesManagedPreAndPostToolUseHooks() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let command = SupatermCodexHookSettings.command.replacingOccurrences(of: "\"", with: "\\\"")
    try writeCodexSettings(
      """
      {
        "hooks": {
          "PostToolUse": [
            {
              "hooks": [
                {
                  "command": "\(command)",
                  "timeout": 5,
                  "type": "command"
                }
              ]
            }
          ],
          "PreToolUse": [
            {
              "hooks": [
                {
                  "command": "\(command)",
                  "timeout": 5,
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
    let postToolUseGroups = try codexEventGroupsValue("PostToolUse", in: object)
    let preToolUseGroups = try codexEventGroupsValue("PreToolUse", in: object)
    let postToolUseCommands =
      postToolUseGroups
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }
      .filter { $0 == SupatermCodexHookSettings.command }
    let preToolUseCommands =
      preToolUseGroups
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }
      .filter { $0 == SupatermCodexHookSettings.command }

    #expect(postToolUseCommands.count == 1)
    #expect(preToolUseCommands.count == 1)
    let postToolUseHooks = try #require(postToolUseGroups.last?["hooks"] as? [[String: Any]])
    let preToolUseHooks = try #require(preToolUseGroups.last?["hooks"] as? [[String: Any]])
    #expect(try #require(postToolUseHooks.last)["timeout"] as? Int == 5)
    #expect(try #require(preToolUseHooks.last)["timeout"] as? Int == 5)
    #expect(preToolUseGroups.last?["matcher"] as? String == "request_user_input")
    #expect(
      Set(try #require(object["hooks"] as? [String: Any]).keys)
        == canonicalCodexHookEvents
    )
  }

  @Test
  func installCanonicalizesDriftedSupatermEntries() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeCodexSettings(
      """
      {
        "hooks": {
          "SessionStart": [
            {
              "matcher": ".*",
              "hooks": [
                {
                  "command": "\(SupatermCodexHookSettings.command.replacingOccurrences(of: "\"", with: "\\\""))",
                  "timeout": 99,
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
    let groups = try codexEventGroupsValue("SessionStart", in: object)
    let group = try #require(groups.last)
    let hooks = try #require(group["hooks"] as? [[String: Any]])
    let supatermHook = try #require(hooks.last)

    #expect(group["matcher"] == nil)
    #expect(supatermHook["command"] as? String == SupatermCodexHookSettings.command)
    #expect(supatermHook["timeout"] as? Int == 10)
  }

  @Test
  func installCollapsesDuplicateSupatermEntries() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let escapedCommand = SupatermCodexHookSettings.command.replacingOccurrences(of: "\"", with: "\\\"")
    try writeCodexSettings(
      """
      {
        "hooks": {
          "Stop": [
            {
              "hooks": [
                {
                  "command": "\(escapedCommand)",
                  "timeout": 10,
                  "type": "command"
                }
              ]
            },
            {
              "hooks": [
                {
                  "command": "\(escapedCommand)",
                  "timeout": 20,
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
    let commands = try codexEventGroupsValue("Stop", in: object)
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }
      .filter { $0 == SupatermCodexHookSettings.command }

    #expect(commands.count == 1)
  }

  @Test
  func installReplacesExistingSupatermCommand() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let command = SupatermCodexHookSettings.command.replacingOccurrences(of: "\"", with: "\\\"")

    try writeCodexSettings(
      """
      {
        "hooks": {
          "Stop": [
            {
              "hooks": [
                {
                  "command": "\(command)",
                  "timeout": 99,
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
    let commands = try codexEventGroupsValue("Stop", in: object)
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }

    #expect(
      commands.filter(AgentHookCommandOwnership.isSupatermManagedCommand).count == 1
    )
    #expect(commands.contains(SupatermCodexHookSettings.command))
  }
}
