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
      restoreTerminalLayoutEnabled: false
    )

    #expect(sessions.count == 1)
    #expect(sessions[0] == nil)
  }

  @Test
  func initialWindowSessionsPreservesSavedWindowOrder() {
    let first = TerminalWindowSession(
      selectedSpaceID: TerminalSpaceID(),
      spaces: []
    )
    let second = TerminalWindowSession(
      selectedSpaceID: TerminalSpaceID(),
      spaces: []
    )

    let sessions = AppDelegate.initialWindowSessions(
      from: TerminalSessionCatalog(windows: [first, second]),
      restoreTerminalLayoutEnabled: true
    )

    #expect(sessions == [first, second])
  }

  @Test
  func initialWindowRequestsInjectOnboardingIntoFirstBlankWindowOnFirstLaunch() {
    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: []),
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
    let session = TerminalWindowSession(
      selectedSpaceID: TerminalSpaceID(),
      spaces: []
    )

    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: [session]),
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
    let pinnedSurfaceID = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    let liveSurfaceID = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!)
    let projectID = TerminalProjectID()
    let tabID = TerminalTabID()
    let sessionCatalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          selectedSpaceID: spaceID,
          spaces: [
            TerminalWindowSpaceSession(
              id: spaceID,
              selectedTabID: tabID,
              projects: [
                TerminalWindowProjectSession(
                  id: projectID,
                  tabs: [
                    PersistedTerminalTab(
                      id: tabID,
                      session: TerminalTabSession(
                        lockedTitle: nil,
                        focusedPaneIndex: 0,
                        root: .leaf(
                          TerminalPaneLeafSession(id: persistedSurfaceID, workingDirectoryPath: nil)
                        )
                      )
                    )
                  ]
                )
              ]
            )
          ]
        )
      ]
    )
    let pinnedTabCatalog = TerminalPinnedTabCatalog(
      spaces: [
        PersistedPinnedTerminalTabsForSpace(
          id: spaceID,
          projects: [
            PersistedPinnedTerminalTabsForProject(
              id: projectID,
              tabs: [
                PersistedTerminalTab(
                  id: TerminalTabID(),
                  session: TerminalTabSession(
                    lockedTitle: nil,
                    focusedPaneIndex: 0,
                    root: .leaf(TerminalPaneLeafSession(id: pinnedSurfaceID, workingDirectoryPath: nil))
                  )
                )
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
        pinnedTabCatalog: pinnedTabCatalog,
        liveSurfaceIDs: [liveSurfaceID]
      ) == Set([persistedSurfaceID, pinnedSurfaceID, liveSurfaceID].map { ZmxSessionID.make(surfaceID: $0) })
    )
    #expect(
      AppDelegate.knownZmxSessionIDsForLaunchReaping(
        restoreTerminalLayoutEnabled: false,
        sessionCatalog: sessionCatalog,
        pinnedTabCatalog: pinnedTabCatalog,
        liveSurfaceIDs: [liveSurfaceID]
      ) == Set([pinnedSurfaceID, liveSurfaceID].map { ZmxSessionID.make(surfaceID: $0) })
    )
  }
}
