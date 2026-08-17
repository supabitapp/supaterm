import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalCommandExecutorHookTests {
  @Test
  func installWritesManagedClaudeHooksAndReportsHealth() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = try await commandExecutor.hooksInstall(
      SupatermAgentHookTargetRequest(agent: .claude),
      installer: claudeHookInstaller(homeDirectoryURL: homeDirectoryURL)
    )

    #expect(result == SupatermAgentHookHealth(agent: .claude, health: .healthy))
    #expect(
      try claudeHookEventNames(homeDirectoryURL: homeDirectoryURL) == [
        "Notification", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop",
        "SubagentStart", "SubagentStop", "UserPromptSubmit",
      ]
    )
  }

  @Test
  func installReportsUnavailableInstalledWithoutClaude() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = try await commandExecutor.hooksInstall(
      SupatermAgentHookTargetRequest(agent: .claude),
      installer: claudeHookInstaller(homeDirectoryURL: homeDirectoryURL, isAvailable: false)
    )

    #expect(result == SupatermAgentHookHealth(agent: .claude, health: .unavailableInstalled))
  }

  @Test
  func installFailsWithoutOverwritingInvalidClaudeSettings() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let invalidJSON = #"{ "hooks":"#
    try writeClaudeSettings(invalidJSON, homeDirectoryURL: homeDirectoryURL)
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)

    await #expect(throws: ClaudeSettingsInstallerError.invalidJSON) {
      try await commandExecutor.hooksInstall(
        SupatermAgentHookTargetRequest(agent: .claude),
        installer: claudeHookInstaller(homeDirectoryURL: homeDirectoryURL)
      )
    }

    #expect(
      try String(
        contentsOf: ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL),
        encoding: .utf8
      ) == invalidJSON
    )
  }

  @Test
  func removeDropsManagedClaudeHooksAndKeepsTheRest() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writeClaudeSettings(
      """
      {
        "hooks": {
          "Notification": [
            {"hooks": [{"command": "echo keep", "timeout": 30, "type": "command"}]}
          ]
        }
      }
      """,
      homeDirectoryURL: homeDirectoryURL
    )
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let installer = claudeHookInstaller(homeDirectoryURL: homeDirectoryURL)
    _ = try await commandExecutor.hooksInstall(
      SupatermAgentHookTargetRequest(agent: .claude),
      installer: installer
    )

    let result = try await commandExecutor.hooksRemove(
      SupatermAgentHookTargetRequest(agent: .claude),
      installer: installer
    )

    #expect(result == SupatermAgentHookHealth(agent: .claude, health: .absent))
    #expect(try claudeHookEventNames(homeDirectoryURL: homeDirectoryURL) == ["Notification"])
  }

  @Test
  func installAndRemoveForwardTheRequestedAgent() async throws {
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let recorder = AgentHookInstallRecorder()
    let installer = CodingAgentHookInstaller(
      integrationHealth: { _ in .absent },
      installSupatermHooks: { recorder.recordInstall($0) },
      removeSupatermHooks: { recorder.recordRemove($0) }
    )

    for agent in SupatermAgentKind.allCases {
      _ = try await commandExecutor.hooksInstall(
        SupatermAgentHookTargetRequest(agent: agent),
        installer: installer
      )
      _ = try await commandExecutor.hooksRemove(
        SupatermAgentHookTargetRequest(agent: agent),
        installer: installer
      )
    }

    #expect(recorder.installedAgents() == SupatermAgentKind.allCases)
    #expect(recorder.removedAgents() == SupatermAgentKind.allCases)
  }
}

private func claudeHookInstaller(
  homeDirectoryURL: URL,
  isAvailable: Bool = true
) -> CodingAgentHookInstaller {
  let makeInstaller: @Sendable () -> ClaudeSettingsInstaller = {
    ClaudeSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runAvailabilityCommand: { CodingAgentCommandResult(status: isAvailable ? 0 : 127) }
    )
  }
  return CodingAgentHookInstaller(
    integrationHealth: { _ in try makeInstaller().integrationHealth() },
    installSupatermHooks: { _ in try makeInstaller().installSupatermHooks() },
    removeSupatermHooks: { _ in try makeInstaller().removeSupatermHooks() }
  )
}

private func temporaryHookHome() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func writeClaudeSettings(_ contents: String, homeDirectoryURL: URL) throws {
  let settingsURL = ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data(contents.utf8).write(to: settingsURL)
}

private func claudeHookEventNames(homeDirectoryURL: URL) throws -> [String] {
  let data = try Data(
    contentsOf: ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  )
  let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  let hooks = try #require(object["hooks"] as? [String: Any])
  return hooks.keys.sorted()
}

nonisolated private final class AgentHookInstallRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var installs: [SupatermAgentKind] = []
  private var removes: [SupatermAgentKind] = []

  func recordInstall(_ agent: SupatermAgentKind) {
    lock.lock()
    installs.append(agent)
    lock.unlock()
  }

  func recordRemove(_ agent: SupatermAgentKind) {
    lock.lock()
    removes.append(agent)
    lock.unlock()
  }

  func installedAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = installs
    lock.unlock()
    return snapshot
  }

  func removedAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = removes
    lock.unlock()
    return snapshot
  }
}
