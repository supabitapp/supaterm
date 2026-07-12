import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct StartupAgentHookRefresherTests {
  @Test
  func repairsOnlyPartialAndDriftedIntegrations() {
    let capture = StartupAgentHookRefreshCapture()
    let refresher = StartupAgentHookRefresher(
      operations: [
        operation(.claude, health: .partial, capture: capture),
        operation(.codex, health: .drifted, capture: capture),
        operation(.pi, health: .drifted, capture: capture),
        operation(.pi, health: .absent, capture: capture),
        operation(.claude, health: .healthy, capture: capture),
        operation(.codex, health: .unavailable, capture: capture),
        operation(.claude, health: .unavailableInstalled, capture: capture),
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.refreshInstalledHooks()

    #expect(capture.installedAgents() == [.claude, .codex, .pi])
    #expect(capture.failedAgents().isEmpty)
  }

  @Test
  func logsFailureAndContinues() {
    let capture = StartupAgentHookRefreshCapture()
    let refresher = StartupAgentHookRefresher(
      operations: [
        Operation(
          agent: .claude,
          integrationHealth: { .partial },
          installSupatermHooks: {
            throw StartupAgentHookRefreshError()
          }
        ),
        operation(.codex, health: .drifted, capture: capture),
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.refreshInstalledHooks()

    #expect(capture.failedAgents() == [.claude])
    #expect(capture.installedAgents() == [.codex])
  }

  @Test
  func preservesLocalPiDevelopmentPackage() throws {
    let homeDirectoryURL = try FileManager.default.url(
      for: .itemReplacementDirectory,
      in: .userDomainMask,
      appropriateFor: FileManager.default.temporaryDirectory,
      create: true
    )
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let settingsURL = PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data(
      #"{"packages":["../../code/supaterm/integrations/supaterm-skills"]}"#.utf8
    ).write(to: settingsURL)
    let capture = StartupAgentHookRefreshCapture()
    let refresher = StartupAgentHookRefresher(
      operations: [
        Operation(
          agent: .pi,
          integrationHealth: {
            try PiSettingsInstaller(
              homeDirectoryURL: homeDirectoryURL,
              checkPiAvailable: { true },
              runPiCommand: { _ in PiSettingsInstaller.CommandResult(status: 0) }
            ).integrationHealth()
          },
          installSupatermHooks: {
            capture.recordInstall(.pi)
          }
        )
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.refreshInstalledHooks()

    #expect(capture.installedAgents().isEmpty)
    #expect(capture.failedAgents().isEmpty)
  }

  private func operation(
    _ agent: SupatermAgentKind,
    health: CodingAgentIntegrationHealth,
    capture: StartupAgentHookRefreshCapture
  ) -> Operation {
    Operation(
      agent: agent,
      integrationHealth: { health },
      installSupatermHooks: {
        capture.recordInstall(agent)
      }
    )
  }
}

private typealias Operation = StartupAgentHookRefresher.Operation

private struct StartupAgentHookRefreshError: Error {}

nonisolated private final class StartupAgentHookRefreshCapture: @unchecked Sendable {
  private let lock = NSLock()
  private var installs: [SupatermAgentKind] = []
  private var failures: [SupatermAgentKind] = []

  func recordInstall(_ agent: SupatermAgentKind) {
    lock.lock()
    installs.append(agent)
    lock.unlock()
  }

  func recordFailure(_ agent: SupatermAgentKind) {
    lock.lock()
    failures.append(agent)
    lock.unlock()
  }

  func installedAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = installs
    lock.unlock()
    return snapshot
  }

  func failedAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = failures
    lock.unlock()
    return snapshot
  }
}
