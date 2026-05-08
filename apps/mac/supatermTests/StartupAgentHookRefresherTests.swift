import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct StartupAgentHookRefresherTests {
  @Test
  func refreshesOnlyInstalledHooks() {
    let capture = StartupAgentHookRefreshCapture()
    let refresher = StartupAgentHookRefresher(
      operations: [
        operation(.claude, installed: true, capture: capture),
        operation(.codex, installed: false, capture: capture),
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.refreshInstalledHooks()

    #expect(capture.installedAgents() == [.claude])
    #expect(capture.failedAgents().isEmpty)
  }

  @Test
  func skipsWhenNoHooksAreInstalled() {
    let capture = StartupAgentHookRefreshCapture()
    let refresher = StartupAgentHookRefresher(
      operations: [
        operation(.claude, installed: false, capture: capture),
        operation(.codex, installed: false, capture: capture),
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.refreshInstalledHooks()

    #expect(capture.installedAgents().isEmpty)
    #expect(capture.failedAgents().isEmpty)
  }

  @Test
  func logsFailureAndContinues() {
    let capture = StartupAgentHookRefreshCapture()
    let refresher = StartupAgentHookRefresher(
      operations: [
        Operation(
          agent: .claude,
          hasSupatermHooks: { true },
          installSupatermHooks: {
            throw StartupAgentHookRefreshError()
          }
        ),
        operation(.codex, installed: true, capture: capture),
      ],
      logFailure: { agent, _ in
        capture.recordFailure(agent)
      }
    )

    refresher.refreshInstalledHooks()

    #expect(capture.failedAgents() == [.claude])
    #expect(capture.installedAgents() == [.codex])
  }

  private func operation(
    _ agent: SupatermAgentKind,
    installed: Bool,
    capture: StartupAgentHookRefreshCapture
  ) -> Operation {
    Operation(
      agent: agent,
      hasSupatermHooks: { installed },
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
