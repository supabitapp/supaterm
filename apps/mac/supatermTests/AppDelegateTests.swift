import AppKit
import Foundation
import Testing

@testable import supaterm

@MainActor
struct AppDelegateTests {
  @Test
  func terminateReplySkipsConfirmationWithoutVisibleAppWindows() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: false,
      needsQuitConfirmation: true,
      bypassesQuitConfirmation: false
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplySkipsConfirmationWhenNoTerminalNeedsIt() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: true,
      needsQuitConfirmation: false,
      bypassesQuitConfirmation: false
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplyCancelsWhenConfirmationIsDeclined() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: true,
      needsQuitConfirmation: true,
      bypassesQuitConfirmation: false
    ) {
      false
    }

    #expect(reply == .terminateCancel)
  }

  @Test
  func terminateReplyTerminatesWhenConfirmationIsAccepted() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: true,
      needsQuitConfirmation: true,
      bypassesQuitConfirmation: false
    ) {
      true
    }

    #expect(reply == .terminateNow)
  }

  @Test
  func terminateReplySkipsConfirmationWhenUpdateBypassesQuitConfirmation() {
    let reply = AppDelegate.terminateReply(
      hasVisibleAppWindows: true,
      needsQuitConfirmation: true,
      bypassesQuitConfirmation: true
    ) {
      Issue.record("confirmation should not be shown")
      return false
    }

    #expect(reply == .terminateNow)
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
        .init(
          session: nil,
          startupCommand: #"sp onboard; exec "${SHELL:-/bin/zsh}" -l"#,
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
        .init(
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
        .init(
          session: session,
          startupCommand: nil,
        )
      ]
    )
  }

  @Test
  func pendingTerminationSessionCatalogCapturesLiveSnapshotOnlyWhenTerminating() {
    let liveWindowSession = TerminalWindowSession(
      selectedSpaceID: TerminalSpaceID(),
      spaces: []
    )
    let liveSessionCatalog = TerminalSessionCatalog(
      windows: [liveWindowSession]
    )

    #expect(
      AppDelegate.pendingTerminationSessionCatalog(
        for: .terminateNow,
        liveSessionCatalog: liveSessionCatalog
      ) == liveSessionCatalog
    )
    #expect(
      AppDelegate.pendingTerminationSessionCatalog(
        for: .terminateCancel,
        liveSessionCatalog: liveSessionCatalog
      ) == nil
    )
  }

  @Test
  func persistedSessionCatalogPrefersPreTerminationSnapshotOverClosingWindowsSnapshot() {
    let preservedWindowSession = TerminalWindowSession(
      selectedSpaceID: TerminalSpaceID(),
      spaces: []
    )
    let preservedSessionCatalog = TerminalSessionCatalog(
      windows: [preservedWindowSession]
    )
    let closingWindowsSessionCatalog = TerminalSessionCatalog(windows: [])

    #expect(
      !AppDelegate.shouldSaveLiveSession(
        suppressesSessionSave: false,
        pendingTerminationSessionCatalog: preservedSessionCatalog
      )
    )
    #expect(
      AppDelegate.persistedSessionCatalog(
        liveSessionCatalog: closingWindowsSessionCatalog,
        pendingTerminationSessionCatalog: preservedSessionCatalog
      ) == preservedSessionCatalog
    )
  }
}
