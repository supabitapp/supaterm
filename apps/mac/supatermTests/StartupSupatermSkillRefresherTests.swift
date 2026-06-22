import Foundation
import Testing

@testable import supaterm

struct StartupSupatermSkillRefresherTests {
  @Test
  func refreshesInstalledSkill() {
    let capture = StartupSupatermSkillRefreshCapture()
    let refresher = StartupSupatermSkillRefresher(
      hasSupatermSkillInstalled: { true },
      installSupatermSkill: {
        capture.recordInstall()
      },
      logFailure: { _ in
        capture.recordFailure()
      }
    )

    refresher.refreshInstalledSkill()

    #expect(capture.installCount() == 1)
    #expect(capture.failureCount() == 0)
  }

  @Test
  func skipsWhenNoSkillIsInstalled() {
    let capture = StartupSupatermSkillRefreshCapture()
    let refresher = StartupSupatermSkillRefresher(
      hasSupatermSkillInstalled: { false },
      installSupatermSkill: {
        capture.recordInstall()
      },
      logFailure: { _ in
        capture.recordFailure()
      }
    )

    refresher.refreshInstalledSkill()

    #expect(capture.installCount() == 0)
    #expect(capture.failureCount() == 0)
  }

  @Test
  func logsFailure() {
    let capture = StartupSupatermSkillRefreshCapture()
    let refresher = StartupSupatermSkillRefresher(
      hasSupatermSkillInstalled: { true },
      installSupatermSkill: {
        capture.recordInstall()
        throw StartupSupatermSkillRefreshError()
      },
      logFailure: { _ in
        capture.recordFailure()
      }
    )

    refresher.refreshInstalledSkill()

    #expect(capture.installCount() == 1)
    #expect(capture.failureCount() == 1)
  }
}

private struct StartupSupatermSkillRefreshError: Error {}

nonisolated private final class StartupSupatermSkillRefreshCapture: @unchecked Sendable {
  private let lock = NSLock()
  private var installs = 0
  private var failures = 0

  func recordInstall() {
    lock.lock()
    installs += 1
    lock.unlock()
  }

  func recordFailure() {
    lock.lock()
    failures += 1
    lock.unlock()
  }

  func installCount() -> Int {
    lock.lock()
    let value = installs
    lock.unlock()
    return value
  }

  func failureCount() -> Int {
    lock.lock()
    let value = failures
    lock.unlock()
    return value
  }
}
