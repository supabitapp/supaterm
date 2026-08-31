import Dispatch
import Foundation
import Synchronization
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalCommandExecutorIntegrationTests {
  @Test
  func liveManagerUsesIsolatedHomeOnlyInTestMode() {
    let defaultHome = URL(fileURLWithPath: "/Users/tester", isDirectory: true)
    let isolatedHome = URL(fileURLWithPath: "/tmp/supaterm-e2e-home", isDirectory: true)

    #expect(
      CodingAgentIntegrationManager.homeDirectoryURL(
        environment: [
          "SUPATERM_TEST_MODE": "1",
          SupatermCLIEnvironment.testHomeKey: isolatedHome.path,
        ],
        defaultHomeDirectoryURL: defaultHome
      ) == isolatedHome
    )
    #expect(
      CodingAgentIntegrationManager.homeDirectoryURL(
        environment: [SupatermCLIEnvironment.testHomeKey: isolatedHome.path],
        defaultHomeDirectoryURL: defaultHome
      ) == defaultHome
    )
  }

  @Test
  func setupWritesManagedClaudeHooksAndReportsHealth() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = try await commandExecutor.setupAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL)
    )

    #expect(result == SupatermAgentIntegrationResult(agent: .claude, health: .healthy))
    #expect(
      try claudeHookEventNames(homeDirectoryURL: homeDirectoryURL) == [
        "Notification", "PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "Stop",
        "SubagentStart", "SubagentStop", "UserPromptSubmit",
      ]
    )
  }

  @Test
  func setupSkipsUnavailableClaude() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    let result = try await commandExecutor.setupAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL, isAvailable: false)
    )

    #expect(result == SupatermAgentIntegrationResult(agent: .claude, health: .unavailable))
    #expect(
      !FileManager.default.fileExists(
        atPath: ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL).path
      )
    )
  }

  @Test
  func setupFailsWithoutOverwritingInvalidClaudeSettings() async throws {
    let homeDirectoryURL = try temporaryHookHome()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let invalidJSON = #"{ "hooks":"#
    try writeClaudeSettings(invalidJSON, homeDirectoryURL: homeDirectoryURL)
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)

    await #expect(throws: ClaudeSettingsInstallerError.invalidJSON) {
      try await commandExecutor.setupAgentIntegration(
        SupatermAgentIntegrationRequest(agent: .claude),
        manager: claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL)
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
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let manager = claudeIntegrationManager(homeDirectoryURL: homeDirectoryURL)
    _ = try await commandExecutor.setupAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: manager
    )

    let result = try await commandExecutor.removeAgentIntegration(
      SupatermAgentIntegrationRequest(agent: .claude),
      manager: manager
    )

    #expect(result == SupatermAgentIntegrationResult(agent: .claude, health: .absent))
    #expect(try claudeHookEventNames(homeDirectoryURL: homeDirectoryURL) == ["Notification"])
  }

  @Test
  func setupAndRemovalForwardTheRequestedAgent() async throws {
    let registry = TerminalWindowRegistry.test()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let recorder = AgentIntegrationRecorder()
    let manager = CodingAgentIntegrationManager(
      claude: recordingIntegration(.claude, recorder: recorder),
      codex: recordingIntegration(.codex, recorder: recorder),
      pi: recordingIntegration(.pi, recorder: recorder)
    )

    for agent in SupatermAgentKind.allCases {
      _ = try await commandExecutor.setupAgentIntegration(
        SupatermAgentIntegrationRequest(agent: agent),
        manager: manager
      )
      _ = try await commandExecutor.removeAgentIntegration(
        SupatermAgentIntegrationRequest(agent: agent),
        manager: manager
      )
    }

    #expect(recorder.setupAgents() == SupatermAgentKind.allCases)
    #expect(recorder.healthCheckedAgents() == SupatermAgentKind.allCases)
    #expect(recorder.removedAgents() == SupatermAgentKind.allCases)
  }

  @Test
  func managerBoundsConcurrentPiMutationPlans() throws {
    let homeDirectoryURL = try temporaryPiHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    try writePiPackageSources([], homeDirectoryURL: homeDirectoryURL)
    let firstMutationEntered = DispatchSemaphore(value: 0)
    let releaseFirstMutation = DispatchSemaphore(value: 0)
    let secondSetupFinished = DispatchSemaphore(value: 0)
    let claudeSetupFinished = DispatchSemaphore(value: 0)
    let availabilityChecks = Mutex(0)
    let mutationCount = Mutex(0)
    let successfulAgents = Mutex<[SupatermAgentKind]>([])
    let secondPiError = Mutex<CodingAgentIntegrationManagerError?>(nil)
    let unexpectedFailures = Mutex<[String]>([])
    let setupPi: @Sendable () throws -> CodingAgentIntegrationHealth = {
      try PiSettingsInstaller(
        homeDirectoryURL: homeDirectoryURL,
        checkPiAvailable: {
          availabilityChecks.withLock { $0 += 1 }
          return true
        },
        runPiMutation: { _, _ in
          let count = mutationCount.withLock {
            $0 += 1
            return $0
          }
          if count == 1 {
            firstMutationEntered.signal()
            releaseFirstMutation.wait()
          }
          return PiSettingsInstaller.CommandResult(status: 0)
        }
      ).setup()
    }
    let otherAgentIntegration = CodingAgentIntegrationManager.Integration(
      setup: { .absent },
      health: { .absent },
      repair: {},
      remove: {}
    )
    let manager = CodingAgentIntegrationManager(
      claude: otherAgentIntegration,
      codex: otherAgentIntegration,
      pi: CodingAgentIntegrationManager.Integration(
        setup: setupPi,
        health: { .absent },
        repair: {},
        remove: {}
      ),
      coordinationTimeout: 0.05
    )
    let operations = DispatchGroup()

    operations.enter()
    DispatchQueue.global().async {
      defer { operations.leave() }
      do {
        _ = try manager.setup(.pi)
        successfulAgents.withLock { $0.append(.pi) }
      } catch {
        unexpectedFailures.withLock { $0.append(error.localizedDescription) }
      }
    }
    #expect(firstMutationEntered.wait(timeout: .now() + 1) == .success)

    operations.enter()
    DispatchQueue.global().async {
      defer { operations.leave() }
      do {
        _ = try manager.setup(.pi)
        unexpectedFailures.withLock { $0.append("Second same-agent setup succeeded") }
      } catch let error as CodingAgentIntegrationManagerError {
        secondPiError.withLock { $0 = error }
      } catch {
        unexpectedFailures.withLock { $0.append(error.localizedDescription) }
      }
      secondSetupFinished.signal()
    }

    operations.enter()
    DispatchQueue.global().async {
      defer { operations.leave() }
      do {
        _ = try manager.setup(.claude)
        successfulAgents.withLock { $0.append(.claude) }
      } catch {
        unexpectedFailures.withLock { $0.append(error.localizedDescription) }
      }
      claudeSetupFinished.signal()
    }

    #expect(secondSetupFinished.wait(timeout: .now() + 1) == .success)
    #expect(claudeSetupFinished.wait(timeout: .now() + 1) == .success)
    #expect(secondPiError.withLock { $0 } == .busy(.pi))
    #expect(availabilityChecks.withLock { $0 } == 1)
    #expect(mutationCount.withLock { $0 } == 1)
    #expect(
      SupatermAgentIntegrationTiming.setupBudget
        + SupatermAgentIntegrationTiming.coordinationTimeout
        < SupatermAgentIntegrationTiming.serverReplyTimeout
    )
    releaseFirstMutation.signal()
    #expect(operations.wait(timeout: .now() + 2) == .success)

    #expect(unexpectedFailures.withLock { $0 }.isEmpty)
    #expect(Set(successfulAgents.withLock { $0 }) == [.claude, .pi])
  }
}

private func claudeIntegrationManager(
  homeDirectoryURL: URL,
  isAvailable: Bool = true
) -> CodingAgentIntegrationManager {
  let makeInstaller: @Sendable () -> ClaudeSettingsInstaller = {
    ClaudeSettingsInstaller(
      homeDirectoryURL: homeDirectoryURL,
      runAvailabilityCommand: { CodingAgentCommandResult(status: isAvailable ? 0 : 127) }
    )
  }
  let integration = CodingAgentIntegrationManager.Integration(
    setup: { try makeInstaller().setup() },
    health: { try makeInstaller().integrationHealth() },
    repair: { try makeInstaller().installSupatermHooks() },
    remove: { try makeInstaller().removeSupatermHooks() }
  )
  return CodingAgentIntegrationManager(
    claude: integration,
    codex: integration,
    pi: integration
  )
}

private func recordingIntegration(
  _ agent: SupatermAgentKind,
  recorder: AgentIntegrationRecorder
) -> CodingAgentIntegrationManager.Integration {
  CodingAgentIntegrationManager.Integration(
    setup: {
      recorder.recordSetup(agent)
      return .healthy
    },
    health: {
      recorder.recordHealthCheck(agent)
      return .absent
    },
    repair: {},
    remove: { recorder.recordRemove(agent) }
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

nonisolated private final class AgentIntegrationRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private var setups: [SupatermAgentKind] = []
  private var healthChecks: [SupatermAgentKind] = []
  private var removes: [SupatermAgentKind] = []

  func recordSetup(_ agent: SupatermAgentKind) {
    lock.lock()
    setups.append(agent)
    lock.unlock()
  }

  func recordHealthCheck(_ agent: SupatermAgentKind) {
    lock.lock()
    healthChecks.append(agent)
    lock.unlock()
  }

  func recordRemove(_ agent: SupatermAgentKind) {
    lock.lock()
    removes.append(agent)
    lock.unlock()
  }

  func setupAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = setups
    lock.unlock()
    return snapshot
  }

  func removedAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = removes
    lock.unlock()
    return snapshot
  }

  func healthCheckedAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = healthChecks
    lock.unlock()
    return snapshot
  }
}
