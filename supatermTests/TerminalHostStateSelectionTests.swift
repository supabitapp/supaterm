import Foundation
import Testing

@testable import supaterm

struct TerminalHostStateSelectionTests {
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
      windowActivity: .init(isKeyWindow: true, isVisible: true),
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
      windowActivity: .init(isKeyWindow: true, isVisible: true),
      focusedSurfaceID: paneID,
      surfaceID: paneID
    )

    #expect(!state.isSelectedTab)
    #expect(!state.isFocused)
  }
}
