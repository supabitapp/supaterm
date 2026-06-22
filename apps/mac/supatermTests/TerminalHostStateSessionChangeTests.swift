import Foundation
import Testing

@testable import SupatermTerminalFeature
@testable import SupatermTerminalModels
@testable import supaterm

@MainActor
struct TerminalHostStateSessionChangeTests {
  @Test
  func performCloseTabsFiresSingleSessionChange() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    let firstTabID = try #require(host.selectedTabID)
    let secondTabID = try #require(host.createTab(focusing: false))

    var sessionChangeCount = 0
    host.onSessionChange = { sessionChangeCount += 1 }

    host.performCloseTabs([firstTabID, secondTabID])

    #expect(sessionChangeCount == 1)
    #expect(host.trees.isEmpty)
  }

  @Test
  func performCloseTabsWithoutTabsFiresNoSessionChange() {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    var sessionChangeCount = 0
    host.onSessionChange = { sessionChangeCount += 1 }

    host.performCloseTabs([])

    #expect(sessionChangeCount == 0)
  }

  @Test
  func batchedSessionChangeRespectsOuterSuppression() {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    var sessionChangeCount = 0
    host.onSessionChange = { sessionChangeCount += 1 }

    host.withSessionChangesSuppressed {
      host.withBatchedSessionChange {
        host.sessionDidChange()
      }
    }

    #expect(sessionChangeCount == 0)
  }
}
