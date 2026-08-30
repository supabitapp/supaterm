import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

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
  func installedBridgeForwardsHookWithoutPaneEnvironment() throws {
    let temporaryDirectory = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    let homeDirectoryURL = temporaryDirectory.appendingPathComponent(
      "Codex user's home",
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: homeDirectoryURL, withIntermediateDirectories: true)
    let executableURL = homeDirectoryURL.appendingPathComponent("sp", isDirectory: false)
    let argumentsURL = homeDirectoryURL.appendingPathComponent("arguments", isDirectory: false)
    let inputURL = homeDirectoryURL.appendingPathComponent("input", isDirectory: false)
    try writeExecutable(
      at: executableURL,
      script: "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOOK_ARGUMENTS_PATH\"\ncat > \"$HOOK_INPUT_PATH\"\n"
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      cliPath: executableURL.path,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) }
    )
    try installer.installSupatermHooks()
    let payload = Data(#"{"hook_event_name":"SessionStart"}"#.utf8)
    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let groups = try codexEventGroupsValue("SessionStart", in: object)
    let hooks = try #require(groups.first?["hooks"] as? [[String: Any]])
    let command = try #require(hooks.first?["command"] as? String)

    for shellPath in ["/bin/sh", "/bin/bash", "/bin/zsh", "/opt/homebrew/bin/fish"]
    where FileManager.default.isExecutableFile(atPath: shellPath) {
      try runHookCommand(
        command,
        shellPath: shellPath,
        environment: [
          "HOME": homeDirectoryURL.appendingPathComponent("other-home").path,
          "HOOK_ARGUMENTS_PATH": argumentsURL.path,
          "HOOK_INPUT_PATH": inputURL.path,
        ],
        payload: payload
      )

      #expect(
        try String(contentsOf: argumentsURL, encoding: .utf8).split(separator: "\n").map(String.init)
          == [
            "agent", "receive-agent-hook", "--agent", "codex", "--pid", String(getpid()),
          ],
        Comment(rawValue: shellPath)
      )
      #expect(try Data(contentsOf: inputURL) == payload, Comment(rawValue: shellPath))
    }
  }

  @Test
  func installIsIdempotent() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodexSettingsInstaller.CommandResult(status: 0, standardError: "") }
    )
    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)

    try installer.installSupatermHooks()
    let firstInstall = try Data(contentsOf: settingsURL)
    try installer.installSupatermHooks()
    let secondInstall = try Data(contentsOf: settingsURL)

    #expect(secondInstall == firstInstall)
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
    #expect(commands.contains(canonicalCodexHookCommand(homeDirectoryURL: homeDirectoryURL)))
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

  @Test
  func installReplacesLegacySupatermHooks() throws {
    let homeDirectoryURL = try temporaryCodexHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let legacyCommand = legacySupatermHookCommand(agent: "codex")
    try writeCodexSettingsObject(
      [
        "hooks": [
          "SessionStart": [
            [
              "hooks": [["command": legacyCommand, "timeout": 10, "type": "command"]]
            ]
          ]
        ]
      ],
      homeDirectoryURL: homeDirectoryURL
    )
    let installer = testCodexSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runEnableHooksCommand: { CodingAgentCommandResult(status: 0) }
    )

    try installer.installSupatermHooks()

    let object = try codexSettingsObject(homeDirectoryURL: homeDirectoryURL)
    let hooks = try #require(object["hooks"] as? [String: Any])
    let commands = hooks.values
      .compactMap { $0 as? [[String: Any]] }
      .flatMap { $0 }
      .compactMap { $0["hooks"] as? [[String: Any]] }
      .flatMap { $0 }
      .compactMap { $0["command"] as? String }
    let canonicalCommand = canonicalCodexHookCommand(homeDirectoryURL: homeDirectoryURL)
    #expect(commands.count == canonicalCodexHookEvents.count)
    #expect(commands.allSatisfy { $0 == canonicalCommand })
    #expect(!commands.contains(legacyCommand))
  }
}
