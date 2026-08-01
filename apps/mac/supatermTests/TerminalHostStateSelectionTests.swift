import Foundation
import Testing

@testable import supaterm

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
    let tabID = TerminalTabID()
    let paneID = UUID()

    let state = TerminalHostState.newPaneSelectionState(
      selectedTabID: tabID,
      targetTabID: tabID,
      windowActivity: WindowActivityState(isKeyWindow: true, isVisible: true),
      focusedSurfaceID: paneID,
      surfaceID: paneID
    )

    #expect(state.isSelectedTab)
    #expect(state.isFocused)
  }

  @Test
  func newPaneSelectionStateReportsSelectedButUnfocusedForInactiveWindow() {
    let tabID = TerminalTabID()
    let paneID = UUID()

    let state = TerminalHostState.newPaneSelectionState(
      selectedTabID: tabID,
      targetTabID: tabID,
      windowActivity: .inactive,
      focusedSurfaceID: paneID,
      surfaceID: paneID
    )

    #expect(state.isSelectedTab)
    #expect(!state.isFocused)
  }

  @Test
  func newPaneSelectionStateReportsUnselectedWhenAnotherTabRemainsSelected() {
    let selectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()
    let paneID = UUID()

    let state = TerminalHostState.newPaneSelectionState(
      selectedTabID: selectedTabID,
      targetTabID: targetTabID,
      windowActivity: WindowActivityState(isKeyWindow: true, isVisible: true),
      focusedSurfaceID: paneID,
      surfaceID: paneID
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
}
