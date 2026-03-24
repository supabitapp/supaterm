import AppKit
import Foundation
import GhosttyKit
import Testing

@testable import supaterm

@MainActor
struct GhosttyRuntimeTests {
  @Test
  func dispatchAppActionRoutesSupportedActions() {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    defer {
      app.delegate = previousDelegate
    }

    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_NEW_WINDOW, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_CLOSE_ALL_WINDOWS, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_CHECK_FOR_UPDATES, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_OPEN_CONFIG, action: .init())))
    #expect(GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_QUIT, action: .init())))

    #expect(delegate.newWindowCount == 1)
    #expect(delegate.closeAllWindowsCount == 1)
    #expect(delegate.checkForUpdatesCount == 1)
    #expect(delegate.openConfigCount == 1)
    #expect(delegate.quitCount == 1)
  }

  @Test
  func dispatchAppActionReturnsFalseForUnsupportedActions() {
    #expect(!GhosttyRuntime.dispatchAppAction(.init(tag: GHOSTTY_ACTION_PRESENT_TERMINAL, action: .init())))
  }
}
