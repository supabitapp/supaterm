import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct StartupAgentIntegrationRefresherTests {
  @Test
  func repairsOnlyPartialAndDriftedIntegrations() {
    let capture = StartupAgentIntegrationRefreshCapture()
    let refresher = StartupAgentIntegrationRefresher(
      operations: [
        operation(.claude, health: .partial, capture: capture),
        operation(.codex, health: .drifted, capture: capture),
        operation(.claude, health: .healthy, capture: capture),
        operation(.codex, health: .unavailable, capture: capture),
        operation(.claude, health: .unavailableInstalled, capture: capture),
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.repairIntegrations()

    #expect(capture.repairedAgents() == [.claude, .codex])
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

  private func operation(
    _ agent: SupatermManagedAgentKind,
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
  private var repairs: [SupatermManagedAgentKind] = []
  private var failures: [SupatermManagedAgentKind] = []

  func recordRepair(_ agent: SupatermManagedAgentKind) {
    lock.lock()
    repairs.append(agent)
    lock.unlock()
  }

  func recordFailure(_ agent: SupatermManagedAgentKind) {
    lock.lock()
    failures.append(agent)
    lock.unlock()
  }

  func repairedAgents() -> [SupatermManagedAgentKind] {
    lock.lock()
    let snapshot = repairs
    lock.unlock()
    return snapshot
  }

  func failedAgents() -> [SupatermManagedAgentKind] {
    lock.lock()
    let snapshot = failures
    lock.unlock()
    return snapshot
  }
}
