import AppKit
import Foundation
import SupatermCLIShared
import SupatermSupport
import Testing

@testable import supaterm

@MainActor
struct AppDelegateTests {
  @Test
  func terminationPlanSkipsConfirmationWithoutTerminalWindows() {
    let plan = AppDelegate.terminationPlan(
      hasTerminalWindow: false,
      bypassesQuitConfirmation: false
    ) {
      Issue.record("confirmation should not be shown")
      return .cancel
    }

    #expect(plan.reply == .terminateNow)
    #expect(!plan.terminatesSessions)
  }

  @Test
  func terminationPlanConfirmsHiddenQuit() {
    let plan = AppDelegate.terminationPlan(
      hasTerminalWindow: true,
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
      hasTerminalWindow: true,
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
      hasTerminalWindow: true,
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
      hasTerminalWindow: true,
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
      hasTerminalWindow: true,
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
      hasTerminalWindow: true,
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
  func initialWindowRequestsFallBackToSingleBlankWindow() {
    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: []),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: Date(timeIntervalSince1970: 123),
      cliPath: nil
    )

    #expect(requests == [.newShell(spaceID: nil, startupCommand: nil)])
  }

  @Test
  func initialWindowRequestsFallBackToSingleBlankWindowWhenRestoreIsDisabled() {
    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(
        windows: [emptyWindowSession(spaceID: TerminalSpaceID())]
      ),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: false,
      lastAppLaunchedDate: Date(timeIntervalSince1970: 123),
      cliPath: nil
    )

    #expect(requests == [.newShell(spaceID: nil, startupCommand: nil)])
  }

  @Test
  func initialWindowRequestsPreserveSavedWindowOrder() {
    let firstSpaceID = TerminalSpaceID()
    let secondSpaceID = TerminalSpaceID()
    let first = emptyWindowSession(spaceID: firstSpaceID)
    let second = emptyWindowSession(spaceID: secondSpaceID)

    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: [first, second]),
      validSpaceIDs: [firstSpaceID, secondSpaceID],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: nil,
      cliPath: nil
    )

    #expect(
      requests == [
        .restore(first),
        .restore(second),
      ]
    )
  }

  @Test
  func initialWindowRequestsDropDirectOnlyWindowsWithoutZmx() {
    let spaceID = TerminalSpaceID()

    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(
        windows: [windowSession(spaceID: spaceID, restoreMode: .existingSession)]
      ),
      validSpaceIDs: [spaceID],
      restoreTerminalLayoutEnabled: true,
      allowsExistingSessions: false,
      lastAppLaunchedDate: nil,
      cliPath: nil
    )

    #expect(requests.isEmpty)
  }

  @Test
  func initialWindowRequestsIgnoreUnavailableSessionsInInvalidSpaces() {
    let invalidSpaceID = TerminalSpaceID()

    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(
        windows: [windowSession(spaceID: invalidSpaceID, restoreMode: .existingSession)]
      ),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: true,
      allowsExistingSessions: false,
      lastAppLaunchedDate: Date(timeIntervalSince1970: 123),
      cliPath: nil
    )

    #expect(requests == [.newShell(spaceID: nil, startupCommand: nil)])
  }

  @Test
  func initialWindowRequestsInjectOnboardingIntoFirstBlankWindowOnFirstLaunch() throws {
    let socketPath = try #require(SupatermProcessSocketEndpoint.current()?.path)
    let cliPath = "/Applications/Supaterm Preview.app/Contents/MacOS/sp"
    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: []),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: nil,
      cliPath: cliPath
    )

    #expect(
      requests == [
        .newShell(
          spaceID: nil,
          startupCommand: .shell(
            "'/Applications/Supaterm Preview.app/Contents/MacOS/sp' onboard --socket "
              + SupatermShellCommand.escapedToken(socketPath)
          )
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
      lastAppLaunchedDate: Date(timeIntervalSince1970: 123),
      cliPath: "/Applications/Supaterm.app/Contents/MacOS/sp"
    )

    #expect(
      requests == [
        .newShell(spaceID: nil, startupCommand: nil)
      ]
    )
  }

  @Test
  func initialWindowRequestsSkipOnboardingWithoutBundledCLI() {
    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: []),
      validSpaceIDs: [],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: nil,
      cliPath: nil
    )

    #expect(
      requests == [
        .newShell(spaceID: nil, startupCommand: nil)
      ]
    )
  }

  @Test
  func initialWindowRequestsDoNotInjectOnboardingIntoRestoredWindows() {
    let spaceID = TerminalSpaceID()
    let session = windowSession(spaceID: spaceID, restoreMode: .shell)

    let requests = AppDelegate.initialWindowRequests(
      from: TerminalSessionCatalog(windows: [session]),
      validSpaceIDs: [spaceID],
      restoreTerminalLayoutEnabled: true,
      lastAppLaunchedDate: nil,
      cliPath: "/Applications/Supaterm.app/Contents/MacOS/sp"
    )

    #expect(
      requests == [
        .restore(session)
      ]
    )
  }

  @Test
  func launchReaperKnownSessionsSpanHiddenSpacesAndLiveSurfaces() {
    let persistedSurfaceID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    let hiddenSurfaceID = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    let liveSurfaceID = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    let spaceID = TerminalSpaceID(rawValue: UUID(uuidString: "44444444-4444-4444-4444-444444444444")!)
    let hiddenSpaceID = TerminalSpaceID(
      rawValue: UUID(uuidString: "77777777-7777-7777-7777-777777777777")!
    )
    let firstTabID = TerminalTabID(rawValue: UUID(uuidString: "55555555-5555-5555-5555-555555555555")!)
    let hiddenTabID = TerminalTabID(rawValue: UUID(uuidString: "66666666-6666-6666-6666-666666666666")!)
    let sessionCatalog = TerminalSessionCatalog(
      windows: [
        TerminalWindowSession(
          displayedSpaceID: spaceID,
          spaces: [
            TerminalSpaceSession(
              spaceID: spaceID,
              selectedTabID: firstTabID,
              tabs: [
                TerminalTabSession(
                  id: firstTabID,
                  isPinned: false,
                  lockedTitle: nil,
                  focusedPaneIndex: 0,
                  root: .leaf(
                    TerminalPaneLeafSession(id: persistedSurfaceID, workingDirectoryPath: nil)
                  )
                )
              ]
            ),
            TerminalSpaceSession(
              spaceID: hiddenSpaceID,
              selectedTabID: hiddenTabID,
              tabs: [
                TerminalTabSession(
                  id: hiddenTabID,
                  isPinned: true,
                  lockedTitle: nil,
                  focusedPaneIndex: 0,
                  root: .leaf(
                    TerminalPaneLeafSession(id: hiddenSurfaceID, workingDirectoryPath: nil)
                  )
                )
              ]
            ),
          ]
        )
      ]
    )
    #expect(
      AppDelegate.knownZmxSurfaceIDsForLaunchReaping(
        restoreTerminalLayoutEnabled: true,
        sessionCatalog: sessionCatalog,
        liveSurfaceIDs: [liveSurfaceID]
      ) == Set([persistedSurfaceID, hiddenSurfaceID, liveSurfaceID])
    )
    #expect(
      AppDelegate.knownZmxSurfaceIDsForLaunchReaping(
        restoreTerminalLayoutEnabled: false,
        sessionCatalog: sessionCatalog,
        liveSurfaceIDs: [liveSurfaceID]
      ) == [liveSurfaceID]
    )
  }

  private func emptyWindowSession(spaceID: TerminalSpaceID) -> TerminalWindowSession {
    TerminalWindowSession(
      displayedSpaceID: spaceID,
      spaces: [
        TerminalSpaceSession(
          spaceID: spaceID,
          selectedTabID: nil,
          tabs: []
        )
      ]
    )
  }

  private func windowSession(
    spaceID: TerminalSpaceID,
    restoreMode: TerminalPaneRestoreMode
  ) -> TerminalWindowSession {
    let tabID = TerminalTabID()
    return TerminalWindowSession(
      displayedSpaceID: spaceID,
      spaces: [
        TerminalSpaceSession(
          spaceID: spaceID,
          selectedTabID: tabID,
          tabs: [
            TerminalTabSession(
              id: tabID,
              isPinned: false,
              lockedTitle: nil,
              focusedPaneIndex: 0,
              root: .leaf(
                TerminalPaneLeafSession(
                  workingDirectoryPath: nil,
                  restoreMode: restoreMode
                )
              )
            )
          ]
        )
      ]
    )
  }
}
