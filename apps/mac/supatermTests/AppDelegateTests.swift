import AppKit
import Foundation
import SupatermCLIShared
import SupatermSupport
import Testing

@testable import supaterm

@MainActor
struct AppDelegateTests {
  @Test
  func terminationPlanSkipsConfirmationWithoutVisibleAppWindows() {
    let plan = AppDelegate.terminationPlan(
      hasVisibleAppWindows: false,
      bypassesQuitConfirmation: false
    ) {
      Issue.record("confirmation should not be shown")
      return .cancel
    }

    #expect(plan.reply == .terminateNow)
    #expect(!plan.terminatesSessions)
  }

  @Test
  func terminationPlanAlwaysConfirmsVisibleQuit() {
    let plan = AppDelegate.terminationPlan(
      hasVisibleAppWindows: true,
      bypassesQuitConfirmation: false
    ) {
      .cancel
    }

    #expect(plan.reply == .terminateCancel)
    #expect(!plan.terminatesSessions)
  }

  @Test
  func terminationPlanPreservesSessionsWhenConfirmationRequestsIt() {
    let plan = AppDelegate.terminationPlan(
      hasVisibleAppWindows: true,
      bypassesQuitConfirmation: false
    ) {
      .quitPreservingSessions
    }

    #expect(plan.reply == .terminateNow)
    #expect(!plan.terminatesSessions)
  }

  @Test
  func terminationPlanTerminatesSessionsWhenConfirmationRequestsIt() {
    let plan = AppDelegate.terminationPlan(
      hasVisibleAppWindows: true,
      bypassesQuitConfirmation: false
    ) {
      .quitTerminatingSessions
    }

    #expect(plan.reply == .terminateNow)
    #expect(plan.terminatesSessions)
  }

  @Test
  func terminationPlanSkipsConfirmationWhenUpdateBypassesQuitConfirmation() {
    let plan = AppDelegate.terminationPlan(
      hasVisibleAppWindows: true,
      bypassesQuitConfirmation: true
    ) {
      Issue.record("confirmation should not be shown")
      return .cancel
    }

    #expect(plan.reply == .terminateNow)
    #expect(!plan.terminatesSessions)
  }

  @Test
  func terminationPlanSkipsConfirmationWhenBypassedQuitTerminatesSessions() {
    let plan = AppDelegate.terminationPlan(
      hasVisibleAppWindows: true,
      bypassesQuitConfirmation: true,
      terminatesSessionsOnQuit: true
    ) {
      Issue.record("confirmation should not be shown")
      return .cancel
    }

    #expect(plan.reply == .terminateNow)
    #expect(plan.terminatesSessions)
  }

  @Test
  func terminationPlanConfirmsWhenSessionsTerminateByDefault() {
    let plan = AppDelegate.terminationPlan(
      hasVisibleAppWindows: true,
      bypassesQuitConfirmation: false,
      terminatesSessionsOnQuit: true
    ) {
      .cancel
    }

    #expect(plan.reply == .terminateCancel)
    #expect(!plan.terminatesSessions)
  }

  @Test
  func quitConfirmationContentOffersTerminateOverrideWhenSessionsArePreservedByDefault() {
    let content = QuitConfirmationContent(terminatesSessions: false)

    #expect(content.buttonTitles == ["Cancel", "Quit and Terminate Sessions", "Quit"])
  }

  @Test
  func quitConfirmationContentOmitsTerminateOverrideWhenSessionsTerminateByDefault() {
    let content = QuitConfirmationContent(terminatesSessions: true)

    #expect(content.buttonTitles == ["Cancel", "Quit and Terminate Sessions"])
  }

  @Test
  func quitConfirmationReturnKeyPreservesSessionsWhenQuitIsVisible() {
    let content = QuitConfirmationContent(terminatesSessions: false)

    #expect(content.returnKeyDecision(modifierFlags: []) == .quitPreservingSessions)
  }

  @Test
  func quitConfirmationShiftReturnTerminatesSessions() {
    let content = QuitConfirmationContent(terminatesSessions: false)

    #expect(content.returnKeyDecision(modifierFlags: [.shift]) == .quitTerminatingSessions)
  }

  @Test
  func quitConfirmationReturnKeyTerminatesSessionsWhenQuitIsHidden() {
    let content = QuitConfirmationContent(terminatesSessions: true)

    #expect(content.returnKeyDecision(modifierFlags: []) == .quitTerminatingSessions)
  }

  @Test
  func quitConfirmationReturnKeyIgnoresCommandControlAndOption() {
    let content = QuitConfirmationContent(terminatesSessions: false)

    #expect(content.returnKeyDecision(modifierFlags: [.command]) == nil)
    #expect(content.returnKeyDecision(modifierFlags: [.control]) == nil)
    #expect(content.returnKeyDecision(modifierFlags: [.option]) == nil)
    #expect(content.returnKeyDecision(modifierFlags: [.shift, .command]) == nil)
  }

  @Test
  func initialWindowSessionsFallsBackToSingleBlankWindow() {
    let sessions = AppDelegate.initialWindowSessions(
      from: TerminalSessionCatalog(windows: []),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: true
    )

    #expect(sessions.count == 1)
    #expect(sessions[0] == nil)
  }

  @Test
  func initialWindowSessionsFallsBackToSingleBlankWindowWhenRestoreIsDisabled() {
    let sessions = AppDelegate.initialWindowSessions(
      from: TerminalSessionCatalog(
        windows: [TerminalWindowSession(selectedSpaceID: TerminalSpaceID(), spaces: [])]
      ),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: false
    )

    #expect(sessions.count == 1)
    #expect(sessions[0] == nil)
  }

  @Test
  func initialWindowSessionsPreservesSavedWindowOrder() {
    let firstSpaceID = TerminalSpaceID()
    let secondSpaceID = TerminalSpaceID()
    let first = TerminalWindowSession(
      selectedSpaceID: firstSpaceID,
      spaces: [emptySpaceSession(id: firstSpaceID)]
    )
    let second = TerminalWindowSession(
      selectedSpaceID: secondSpaceID,
      spaces: [emptySpaceSession(id: secondSpaceID)]
    )

    let sessions = AppDelegate.initialWindowSessions(
      from: TerminalSessionCatalog(windows: [first, second]),
      validSpaceIDs: [firstSpaceID, secondSpaceID],
      restoreTerminalLayoutEnabled: true
    )

    #expect(sessions == [first, second])
  }

  @Test
  func initialWindowRequestsInjectOnboardingIntoFirstBlankWindowOnFirstLaunch() {
    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: []),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: nil
    )

    #expect(
      requests == [
        AppDelegate.LaunchWindowRequest(
          session: nil,
          startupCommand: SupatermShellCommand.interactiveStartupCommand(for: "sp onboard"),
        )
      ]
    )
  }

  @Test
  func initialWindowRequestsSkipOnboardingAfterFirstLaunch() {
    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: []),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: Date(timeIntervalSince1970: 123)
    )

    #expect(
      requests == [
        AppDelegate.LaunchWindowRequest(
          session: nil,
          startupCommand: nil,
        )
      ]
    )
  }

  @Test
  func initialWindowRequestsDoNotInjectOnboardingIntoRestoredWindows() {
    let spaceID = TerminalSpaceID()
    let session = TerminalWindowSession(
      selectedSpaceID: spaceID,
      spaces: [emptySpaceSession(id: spaceID)]
    )

    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: [session]),
      validSpaceIDs: [spaceID],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: nil
    )

    #expect(
      requests == [
        AppDelegate.LaunchWindowRequest(
          session: session,
          startupCommand: nil,
        )
      ]
    )
  }

  @Test
  func launchReaperKnownSessionsIncludesLiveSurfaces() {
    let persistedSurfaceID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    let secondPersistedSurfaceID = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    let liveSurfaceID = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!)
    let firstTabID = TerminalTabID(rawValue: UUID(uuidString: "55555555-5555-5555-5555-555555555555")!)
    let secondTabID = TerminalTabID(rawValue: UUID(uuidString: "66666666-6666-6666-6666-666666666666")!)
    let sessionCatalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          selectedSpaceID: spaceID,
          spaces: [
            TerminalWindowSpaceSession(
              id: spaceID,
              selectedTabID: firstTabID,
              nodes: [
                TerminalTabNodeSession(
                  item: .tab(secondTabID),
                  parent: .root(isPinned: true),
                  order: 0
                ),
                TerminalTabNodeSession(
                  item: .tab(firstTabID),
                  parent: .root(isPinned: false),
                  order: 0
                ),
              ],
              groups: [],
              collapsedGroupIDs: [],
              tabs: [
                TerminalTabSession(
                  id: firstTabID,
                  lockedTitle: nil,
                  focusedPaneIndex: 0,
                  root: .leaf(
                    TerminalPaneLeafSession(id: persistedSurfaceID, workingDirectoryPath: nil)
                  )
                ),
                TerminalTabSession(
                  id: secondTabID,
                  lockedTitle: nil,
                  focusedPaneIndex: 0,
                  root: .leaf(
                    TerminalPaneLeafSession(
                      id: secondPersistedSurfaceID,
                      workingDirectoryPath: nil
                    )
                  )
                ),
              ]
            )
          ]
        )
      ]
    )
    #expect(
      AppDelegate.knownZmxSessionIDsForLaunchReaping(
        restoreTerminalLayoutEnabled: true,
        sessionCatalog: sessionCatalog,
        liveSurfaceIDs: [liveSurfaceID]
      ) == Set([persistedSurfaceID, secondPersistedSurfaceID, liveSurfaceID].map { ZmxSessionID.make(surfaceID: $0) })
    )
    #expect(
      AppDelegate.knownZmxSessionIDsForLaunchReaping(
        restoreTerminalLayoutEnabled: false,
        sessionCatalog: sessionCatalog,
        liveSurfaceIDs: [liveSurfaceID]
      ) == Set([liveSurfaceID].map { ZmxSessionID.make(surfaceID: $0) })
    )
  }

  private func emptySpaceSession(id: TerminalSpaceID) -> TerminalWindowSpaceSession {
    TerminalWindowSpaceSession(
      id: id,
      selectedTabID: nil,
      nodes: [],
      groups: [],
      collapsedGroupIDs: [],
      tabs: []
    )
  }
}
