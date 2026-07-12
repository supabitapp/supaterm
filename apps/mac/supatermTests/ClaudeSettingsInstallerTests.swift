import Foundation
import Testing

@testable import SupatermCLIShared

struct ClaudeSettingsInstallerTests {
  @Test
  func integrationHealthIsAbsentWithoutManagedHooks() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    #expect(
      try availableClaudeInstaller(homeDirectoryURL: homeDirectoryURL).integrationHealth()
        == .absent
    )
  }

  @Test
  func integrationHealthIsUnavailableWithoutClaude() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = ClaudeSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runAvailabilityCommand: {
        CodingAgentCommandResult(status: 127, standardError: "command not found")
      }
    )

    #expect(try installer.integrationHealth() == .unavailable)
  }

  @Test
  func integrationHealthKeepsInstalledHooksRemovableWithoutClaude() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeSettings(
      try SupatermClaudeHookSettings.jsonString(),
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = ClaudeSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runAvailabilityCommand: { CodingAgentCommandResult(status: 127) }
    )

    #expect(try installer.integrationHealth() == .unavailableInstalled)
  }

  @Test
  func integrationHealthDistinguishesPartialDriftedAndHealthyHooks() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let command = SupatermClaudeHookSettings.command.replacingOccurrences(of: "\"", with: "\\\"")
    let installer = availableClaudeInstaller(homeDirectoryURL: homeDirectoryURL)

    try writeSettings(
      """
      {
        "hooks": {
          "Stop": [{"hooks": [{"command": "\(command)", "timeout": 10, "type": "command"}]}]
        }
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    #expect(try installer.integrationHealth() == .partial)

    try writeSettings(
      """
      {
        "hooks": {
          "Stop": [{"hooks": [{"command": "\(command)", "timeout": 99, "type": "command"}]}]
        }
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    #expect(try installer.integrationHealth() == .drifted)

    try installer.installSupatermHooks()
    #expect(try installer.integrationHealth() == .healthy)
  }

  @Test
  func installCreatesMissingSettingsFile() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    let hooks = try #require(object["hooks"] as? [String: Any])
    #expect(
      Set(hooks.keys) == [
        "Notification", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop",
        "SubagentStart", "SubagentStop", "UserPromptSubmit",
      ])
  }

  @Test
  func installPreservesUnrelatedSettingsAndHooks() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeSettings(
      """
      {
        "theme": "dark",
        "hooks": {
          "Notification": [
            {
              "matcher": "",
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

    try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    #expect(object["theme"] as? String == "dark")

    let groups = try notificationGroupsValue(in: object)
    let commands =
      groups
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }

    #expect(commands.contains("echo keep"))
    #expect(commands.contains(SupatermClaudeHookSettings.command))
  }

  @Test
  func installCanonicalizesDriftedSupatermEntries() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeSettings(
      """
      {
        "hooks": {
          "PreToolUse": [
            {
              "matcher": "",
              "hooks": [
                {
                  "async": false,
                  "command": "\(SupatermClaudeHookSettings.command.replacingOccurrences(of: "\"", with: "\\\""))",
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

    try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    let groups = try preToolUseGroupsValue(in: object)
    let hooks = try #require(groups.last?["hooks"] as? [[String: Any]])
    let supatermHook = try #require(hooks.last)

    #expect(supatermHook["command"] as? String == SupatermClaudeHookSettings.command)
    #expect(supatermHook["timeout"] as? Int == 5)
    #expect(supatermHook["async"] as? Bool == true)
  }

  @Test
  func installCollapsesDuplicateSupatermEntries() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let escapedCommand = SupatermClaudeHookSettings.command.replacingOccurrences(of: "\"", with: "\\\"")
    try writeSettings(
      """
      {
        "hooks": {
          "Notification": [
            {
              "matcher": "",
              "hooks": [
                {
                  "command": "\(escapedCommand)",
                  "timeout": 10,
                  "type": "command"
                }
              ]
            },
            {
              "matcher": "",
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

    try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    let commands = try notificationGroupsValue(in: object)
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }
      .filter { $0 == SupatermClaudeHookSettings.command }

    #expect(commands.count == 1)
  }

  @Test
  func installReplacesExistingSupatermCommand() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let command = SupatermClaudeHookSettings.command.replacingOccurrences(of: "\"", with: "\\\"")

    try writeSettings(
      """
      {
        "hooks": {
          "SessionStart": [
            {
              "matcher": "",
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

    try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    let commands = try sessionStartGroupsValue(in: object)
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }

    #expect(
      commands.filter(AgentHookCommandOwnership.isSupatermManagedCommand).count == 1
    )
    #expect(commands.contains(SupatermClaudeHookSettings.command))
  }

  @Test
  func installPreservesUnownedCommandsContainingSupaterm() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeSettings(
      """
      {
        "hooks": {
          "CustomEvent": [
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

    try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    let hooks = try #require(object["hooks"] as? [String: Any])
    #expect(hooks["CustomEvent"] != nil)
  }

  @Test
  func integrationHealthIgnoresUnownedSupatermSubstring() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeSettings(
      """
      {
        "hooks": {
          "Notification": [
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

    let installer = availableClaudeInstaller(homeDirectoryURL: homeDirectoryURL)

    #expect(try installer.integrationHealth() == .absent)
  }

  @Test
  func removeSupatermHooksPreservesUnrelatedSettingsAndHooks() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeSettings(
      """
      {
        "theme": "dark",
        "hooks": {
          "Notification": [
            {
              "hooks": [
                {
                  "command": "\(SupatermClaudeHookSettings.command.replacingOccurrences(of: "\"", with: "\\\""))",
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

    let installer = ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL)
    try installer.removeSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    #expect(object["theme"] as? String == "dark")

    let commands = try notificationGroupsValue(in: object)
      .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
      .compactMap { $0["command"] as? String }

    #expect(commands == ["echo keep"])
    #expect(try availableClaudeInstaller(homeDirectoryURL: homeDirectoryURL).integrationHealth() == .absent)
  }

  @Test
  func removeSupatermHooksDropsEmptyHooksObject() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try writeSettings(
      """
      {
        "hooks": {
          "Notification": [
            {
              "hooks": [
                {
                  "command": "\(SupatermClaudeHookSettings.command.replacingOccurrences(of: "\"", with: "\\\""))",
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

    try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).removeSupatermHooks()

    let object = try settingsObject(homeDirectoryURL: homeDirectoryURL)
    #expect(object["hooks"] == nil)
  }

  @Test
  func installFailsWithoutOverwritingInvalidJSON() throws {
    let homeDirectoryURL = try temporaryHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    let invalidJSON = """
      {
        "hooks":
      """
    try writeSettings(invalidJSON, homeDirectoryURL: homeDirectoryURL)

    #expect(throws: ClaudeSettingsInstallerError.invalidJSON) {
      try ClaudeSettingsInstaller(homeDirectoryURL: homeDirectoryURL).installSupatermHooks()
    }

    let settingsURL = ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let contents = try String(contentsOf: settingsURL, encoding: .utf8)
    #expect(contents == invalidJSON)
  }

  @Test
  func availabilityCommandArgumentsCheckBothClaudeExecutables() {
    #expect(
      ClaudeSettingsInstaller.availabilityCommandArguments()
        == ["-l", "-i", "-c", "command -v claude >/dev/null 2>&1 || command -v claude-code >/dev/null 2>&1"]
    )
  }
}

private func temporaryHomeDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func availableClaudeInstaller(homeDirectoryURL: URL) -> ClaudeSettingsInstaller {
  ClaudeSettingsInstaller(
    homeDirectoryURL: homeDirectoryURL,
    runAvailabilityCommand: { CodingAgentCommandResult(status: 0) }
  )
}

private func writeSettings(_ contents: String, homeDirectoryURL: URL) throws {
  let settingsURL = ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try contents.write(to: settingsURL, atomically: true, encoding: .utf8)
}

private func settingsObject(homeDirectoryURL: URL) throws -> [String: Any] {
  let settingsURL = ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  let data = try Data(contentsOf: settingsURL)
  return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func notificationGroupsValue(in object: [String: Any]) throws -> [[String: Any]] {
  let hooks = try #require(object["hooks"] as? [String: Any])
  return try #require(hooks["Notification"] as? [[String: Any]])
}

private func preToolUseGroupsValue(in object: [String: Any]) throws -> [[String: Any]] {
  let hooks = try #require(object["hooks"] as? [String: Any])
  return try #require(hooks["PreToolUse"] as? [[String: Any]])
}

private func sessionStartGroupsValue(in object: [String: Any]) throws -> [[String: Any]] {
  let hooks = try #require(object["hooks"] as? [String: Any])
  return try #require(hooks["SessionStart"] as? [[String: Any]])
}
