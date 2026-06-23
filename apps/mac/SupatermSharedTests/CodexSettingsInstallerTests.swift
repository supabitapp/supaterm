import Foundation
import TOML
import Testing

@testable import SupatermCLIShared

struct CodexSettingsInstallerTests {
  @Test
  func installCreatesMissingSettingsFile() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.installSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let hooks = try #require(object["hooks"] as? [String: Any])
    #expect(Set(hooks.keys) == ["PostToolUse", "PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"])
  }

  @Test
  func installTrustsSupatermHooksInCodexConfig() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.installSupatermHooks()

    let state = try codexConfigHookState(homeDirectoryURL: homeDirectoryURL)
    let hooksPath = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path
    let expectedTrustedHashes: [String: String?] = [
      "\(hooksPath):post_tool_use:0:0":
        "sha256:7f46fa775087e62b0107670dd7bede1edbcfe8a799200e77286fd397d095de95",
      "\(hooksPath):pre_tool_use:0:0":
        "sha256:86ad5f88a51f1bb05f8ea365f5a63ebd6eeba55f6665b6c99a5e1c5d8503a5b2",
      "\(hooksPath):session_start:0:0":
        "sha256:c4d2bd85540ddac1db75f7224ca5a181934be5ccd604fca154eefe3286b26c4e",
      "\(hooksPath):stop:0:0":
        "sha256:95675e5ca4353d2f4147b8240ebd5ba752225bae1e363523c6ec75c8cd380aa6",
      "\(hooksPath):user_prompt_submit:0:0":
        "sha256:5dd630b99cb39a5f72cff53a8e2f3c9534627a0a085116c0aef105315f8e8ad2",
    ]

    #expect(state.mapValues(\.trusted_hash) == expectedTrustedHashes)
  }

  @Test
  func installPreservesExistingHookEnablementWhenTrusting() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let stopKey = "\(CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path):stop:0:0"
    try writeCodexConfig(
      """
      [hooks.state."\((stopKey.replacingOccurrences(of: "\"", with: "\\\"")))"]
      enabled = false
      """,
      homeDirectoryURL: homeDirectoryURL
    )

    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.installSupatermHooks()

    let state = try #require(codexConfigHookState(homeDirectoryURL: homeDirectoryURL)[stopKey])
    #expect(state.enabled == false)
    #expect(state.trusted_hash?.hasPrefix("sha256:") == true)
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

    let installer = CodexSettingsInstaller(
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

    let installer = CodexSettingsInstaller(
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
    #expect(
      Set(try #require(object["hooks"] as? [String: Any]).keys)
        == ["PostToolUse", "PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"]
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

    let installer = CodexSettingsInstaller(
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

    let installer = CodexSettingsInstaller(
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

    let installer = CodexSettingsInstaller(
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

  @Test
  func installRemovesSupatermCommandsFromOtherEvents() throws {
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

    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.installSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let hooks = try #require(object["hooks"] as? [String: Any])
    #expect(hooks["LegacyEvent"] == nil)
  }

  @Test
  func hasSupatermHooksMatchesAnySupatermSubstring() throws {
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

    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    #expect(try installer.hasSupatermHooks())
  }

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
                  "command": "echo supaterm bridge",
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

    let installer = CodexSettingsInstaller(
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
    #expect(try installer.hasSupatermHooks() == false)
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
                  "command": "echo supaterm bridge",
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

    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.removeSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    #expect(object["hooks"] == nil)
  }

  @Test
  func removeSupatermHooksRemovesTrustState() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeCodexConfig(
      """
      [hooks.state.external]
      enabled = false
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = CodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )

    try installer.installSupatermHooks()
    try installer.removeSupatermHooks()

    let state = try codexConfigHookState(homeDirectoryURL: homeDirectoryURL)
    #expect(Set(state.keys) == ["external"])
    #expect(state["external"]?.enabled == false)
  }

  @Test
  func installFailsWithoutOverwritingInvalidJSON() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let invalidJSON = """
      {
        "hooks":
      """
    try writeCodexSettings(invalidJSON, homeDirectoryURL: homeDirectoryURL)

    let installer = CodexSettingsInstaller(
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
    let installer = CodexSettingsInstaller(
      runEnableHooksCommand: {
        throw CodexSettingsInstallerError.codexUnavailable
      }
    )

    #expect(throws: CodexSettingsInstallerError.codexUnavailable) {
      try installer.installSupatermHooks()
    }
  }

  @Test
  func installFailsWhenCodexFeatureEnableCommandFails() {
    let installer = CodexSettingsInstaller(
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 1, standardError: "feature update failed") }
    )

    #expect(throws: CodexSettingsInstallerError.enableHooksFailed("feature update failed")) {
      try installer.installSupatermHooks()
    }
  }

  @Test
  func loginShellURLPrefersCurrentUserShell() {
    #expect(
      CodexSettingsInstaller.loginShellURL(
        environment: ["SHELL": "/bin/zsh"],
        currentUserShellPath: "/opt/homebrew/bin/fish"
      ).path == "/opt/homebrew/bin/fish"
    )
  }

  @Test
  func loginShellURLFallsBackToEnvironmentShell() {
    #expect(
      CodexSettingsInstaller.loginShellURL(
        environment: ["SHELL": "/bin/bash"],
        currentUserShellPath: nil
      ).path == "/bin/bash"
    )
  }

  @Test
  func enableHooksCommandArgumentsUseInteractiveLoginShell() {
    #expect(
      CodexSettingsInstaller.enableHooksCommandArguments()
        == ["-l", "-i", "-c", "codex features enable hooks"]
    )
  }

  @Test
  func availabilityCommandArgumentsUseInteractiveLoginShell() {
    #expect(
      CodexSettingsInstaller.availabilityCommandArguments()
        == ["-l", "-i", "-c", "command -v codex >/dev/null 2>&1"]
    )
  }
}

private func temporaryCodexHomeDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func writeCodexSettings(_ contents: String, homeDirectoryURL: URL) throws {
  let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try contents.write(to: settingsURL, atomically: true, encoding: .utf8)
}

private func writeCodexConfig(_ contents: String, homeDirectoryURL: URL) throws {
  let configURL = CodexSettingsInstaller.configURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: configURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try contents.write(to: configURL, atomically: true, encoding: .utf8)
}

private func codexSettingsObject(homeDirectoryURL: URL) throws -> [String: Any] {
  let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  let data = try Data(contentsOf: settingsURL)
  return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func codexEventGroupsValue(_ event: String, in object: [String: Any]) throws -> [[String: Any]] {
  let hooks = try #require(object["hooks"] as? [String: Any])
  return try #require(hooks[event] as? [[String: Any]])
}

private func codexConfigHookState(homeDirectoryURL: URL) throws -> [String: CodexHookStateFixture] {
  let configURL = CodexSettingsInstaller.configURL(homeDirectoryURL: homeDirectoryURL)
  let data = try Data(contentsOf: configURL)
  let config = try TOMLDecoder().decode(CodexConfigFixture.self, from: data)
  return config.hooks?.state ?? [:]
}

private struct CodexConfigFixture: Decodable {
  var hooks: CodexHooksFixture?
}

private struct CodexHooksFixture: Decodable {
  var state: [String: CodexHookStateFixture]?
}

private struct CodexHookStateFixture: Decodable {
  var enabled: Bool?
  var trusted_hash: String?
}
