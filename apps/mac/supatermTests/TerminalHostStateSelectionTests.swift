import AppKit
import Foundation
import GhosttyKit
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateSelectionTests {
  @Test
  func selectedTabIDAfterCreatingTabUsesTargetTabWhenFocusRequested() {
    let currentSelectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingTab: targetTabID,
      focusRequested: true,
      currentSelectedTabID: currentSelectedTabID
    )

    #expect(selectedTabID == targetTabID)
  }

  @Test
  func selectedTabIDAfterCreatingTabKeepsCurrentTabWithoutFocus() {
    let currentSelectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingTab: targetTabID,
      focusRequested: false,
      currentSelectedTabID: currentSelectedTabID
    )

    #expect(selectedTabID == currentSelectedTabID)
  }

  @Test
  func selectedTabIDAfterCreatingFirstTabUsesTargetTabWithoutFocus() {
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingTab: targetTabID,
      focusRequested: false,
      currentSelectedTabID: nil
    )

    #expect(selectedTabID == targetTabID)
  }

  @Test
  func selectedTabIDAfterCreatingPaneUsesTargetTabWhenFocusRequested() {
    let currentSelectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingPaneIn: targetTabID,
      focusRequested: true,
      currentSelectedTabID: currentSelectedTabID
    )

    #expect(selectedTabID == targetTabID)
  }

  @Test
  func selectedTabIDAfterCreatingPaneKeepsCurrentTabWhenFocusNotRequested() {
    let currentSelectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingPaneIn: targetTabID,
      focusRequested: false,
      currentSelectedTabID: currentSelectedTabID
    )

    #expect(selectedTabID == currentSelectedTabID)
  }

  @Test
  func newPaneSelectionStateReportsFocusedOnlyForSelectedPaneInActiveWindow() {
    let (surface, window) = makeFirstResponderSurface()
    defer {
      surface.closeSurface()
      window.contentView = nil
    }

    let state = TerminalHostState.newPaneSelectionState(
      isSelectedTab: true,
      isPaneVisible: true,
      windowActivity: WindowActivityState(isKeyWindow: true, isVisible: true),
      focusedSurfaceID: surface.id,
      surface: surface
    )

    #expect(state.isSelectedTab)
    #expect(state.isFocused)
  }

  @Test
  func newPaneSelectionStateReportsSelectedButUnfocusedForInactiveWindow() {
    let (surface, window) = makeFirstResponderSurface()
    defer {
      surface.closeSurface()
      window.contentView = nil
    }

    let state = TerminalHostState.newPaneSelectionState(
      isSelectedTab: true,
      isPaneVisible: true,
      windowActivity: .inactive,
      focusedSurfaceID: surface.id,
      surface: surface
    )

    #expect(state.isSelectedTab)
    #expect(!state.isFocused)
  }

  @Test
  func newPaneSelectionStateReportsUnselectedWhenAnotherTabRemainsSelected() {
    let (surface, window) = makeFirstResponderSurface()
    defer {
      surface.closeSurface()
      window.contentView = nil
    }

    let state = TerminalHostState.newPaneSelectionState(
      isSelectedTab: false,
      isPaneVisible: false,
      windowActivity: WindowActivityState(isKeyWindow: true, isVisible: true),
      focusedSurfaceID: surface.id,
      surface: surface
    )

    #expect(!state.isSelectedTab)
    #expect(!state.isFocused)
  }

  @Test
  func focusHistoryStartsWithoutPrevious() {
    let surfaceID = UUID()

    let history = TerminalHostState.FocusHistory(current: surfaceID)

    #expect(history.current == surfaceID)
    #expect(history.previous == nil)
  }

  @Test
  func focusHistoryIgnoresRefocusOfCurrentSurface() {
    let first = UUID()
    let second = UUID()
    var history = TerminalHostState.FocusHistory(current: first)
    history.updateCurrent(second)

    history.updateCurrent(second)

    #expect(history.current == second)
    #expect(history.previous == first)
  }

  @Test
  func focusHistoryShiftsCurrentIntoPrevious() {
    let first = UUID()
    let second = UUID()
    let third = UUID()
    var history = TerminalHostState.FocusHistory(current: first)

    history.updateCurrent(second)
    #expect(history.previous == first)

    history.updateCurrent(third)
    #expect(history.current == third)
    #expect(history.previous == second)
  }

  private func makeFirstResponderSurface() -> (GhosttySurfaceView, NSWindow) {
    initializeGhosttyForTests()
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled],
      backing: .buffered,
      defer: false
    )
    window.contentView = surface
    window.makeFirstResponder(surface)
    return (surface, window)
  }
}
