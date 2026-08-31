import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

struct StartupAgentIntegrationRefresherTests {
  @Test
  func repairsOnlyPartialAndDriftedIntegrations() {
    let capture = StartupAgentIntegrationRefreshCapture()
    let refresher = StartupAgentIntegrationRefresher(
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

    refresher.repairIntegrations()

    #expect(capture.repairedAgents() == [.claude, .codex, .pi])
    #expect(capture.failedAgents().isEmpty)
  }

  @Test
  func logsFailureAndContinues() {
    let capture = StartupAgentIntegrationRefreshCapture()
    let refresher = StartupAgentIntegrationRefresher(
      operations: [
        Operation(
          agent: .claude,
          health: { .partial },
          repair: {
            throw StartupAgentIntegrationRefreshError()
          }
        ),
        operation(.codex, health: .drifted, capture: capture),
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.repairIntegrations()

    #expect(capture.failedAgents() == [.claude])
    #expect(capture.repairedAgents() == [.codex])
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
    let capture = StartupAgentIntegrationRefreshCapture()
    let refresher = StartupAgentIntegrationRefresher(
      operations: [
        Operation(
          agent: .pi,
          health: {
            try PiSettingsInstaller(
              homeDirectoryURL: homeDirectoryURL,
              checkPiAvailable: { true },
              runPiCommand: { _, _ in PiSettingsInstaller.CommandResult(status: 0) }
            ).integrationHealth()
          },
          repair: {
            capture.recordRepair(.pi)
          }
        )
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.repairIntegrations()

    #expect(capture.repairedAgents().isEmpty)
    #expect(capture.failedAgents().isEmpty)
  }

  private func operation(
    _ agent: SupatermAgentKind,
    health: CodingAgentIntegrationHealth,
    capture: StartupAgentIntegrationRefreshCapture
  ) -> Operation {
    Operation(
      agent: agent,
      health: { health },
      repair: {
        capture.recordRepair(agent)
      }
    )
  }
}

private typealias Operation = StartupAgentIntegrationRefresher.Operation

private struct StartupAgentIntegrationRefreshError: Error {}

nonisolated private final class StartupAgentIntegrationRefreshCapture: @unchecked Sendable {
  private let lock = NSLock()
  private var repairs: [SupatermAgentKind] = []
  private var failures: [SupatermAgentKind] = []

  func recordRepair(_ agent: SupatermAgentKind) {
    lock.lock()
    repairs.append(agent)
    lock.unlock()
  }

  func recordFailure(_ agent: SupatermAgentKind) {
    lock.lock()
    failures.append(agent)
    lock.unlock()
  }

  func repairedAgents() -> [SupatermAgentKind] {
    lock.lock()
    let snapshot = repairs
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
