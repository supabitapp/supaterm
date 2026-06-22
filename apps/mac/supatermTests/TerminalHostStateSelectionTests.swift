import Foundation
import Testing

@testable import SupatermTerminalFeature
@testable import SupatermTerminalModels
@testable import supaterm

struct TerminalHostStateSelectionTests {
  @Test
  func selectedTabIDAfterCreatingTabUsesTargetTabWhenFocusRequested() {
    let currentSelectedSpaceID = TerminalSpaceID()
    let targetSpaceID = TerminalSpaceID()
    let currentSelectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingTabIn: targetSpaceID,
      targetTabID: targetTabID,
      focusRequested: true,
      currentSelectedSpaceID: currentSelectedSpaceID,
      currentSelectedTabID: currentSelectedTabID
    )

    #expect(selectedTabID == targetTabID)
  }

  @Test
  func selectedTabIDAfterCreatingTabKeepsCurrentTabWhenTargetSpaceIsSelected() {
    let targetSpaceID = TerminalSpaceID()
    let currentSelectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingTabIn: targetSpaceID,
      targetTabID: targetTabID,
      focusRequested: false,
      currentSelectedSpaceID: targetSpaceID,
      currentSelectedTabID: currentSelectedTabID
    )

    #expect(selectedTabID == currentSelectedTabID)
  }

  @Test
  func selectedTabIDAfterCreatingTabUsesTargetTabWhenTargetSpaceIsNotSelected() {
    let currentSelectedSpaceID = TerminalSpaceID()
    let targetSpaceID = TerminalSpaceID()
    let currentSelectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()

    let selectedTabID = TerminalHostState.selectedTabID(
      afterCreatingTabIn: targetSpaceID,
      targetTabID: targetTabID,
      focusRequested: false,
      currentSelectedSpaceID: currentSelectedSpaceID,
      currentSelectedTabID: currentSelectedTabID
    )

    #expect(selectedTabID == targetTabID)
  }

  @Test
  func shouldSyncFocusDuringTabCreationWhenFocusRequested() {
    let currentSelectedSpaceID = TerminalSpaceID()
    let targetSpaceID = TerminalSpaceID()

    let synchronizesFocus = TerminalHostState.shouldSyncFocusDuringTabCreation(
      targetSpaceID: targetSpaceID,
      focusRequested: true,
      currentSelectedSpaceID: currentSelectedSpaceID
    )

    #expect(synchronizesFocus)
  }

  @Test
  func shouldSyncFocusDuringTabCreationWhenTargetSpaceIsNotSelected() {
    let currentSelectedSpaceID = TerminalSpaceID()
    let targetSpaceID = TerminalSpaceID()

    let synchronizesFocus = TerminalHostState.shouldSyncFocusDuringTabCreation(
      targetSpaceID: targetSpaceID,
      focusRequested: false,
      currentSelectedSpaceID: currentSelectedSpaceID
    )

    #expect(synchronizesFocus)
  }

  @Test
  func shouldNotSyncFocusDuringBackgroundTabCreationInSelectedSpace() {
    let targetSpaceID = TerminalSpaceID()

    let synchronizesFocus = TerminalHostState.shouldSyncFocusDuringTabCreation(
      targetSpaceID: targetSpaceID,
      focusRequested: false,
      currentSelectedSpaceID: targetSpaceID
    )

    #expect(!synchronizesFocus)
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
  func newTabSelectionStateReportsSelectedSpaceAndFocusedForSelectedTabInActiveWindow() {
    let spaceID = TerminalSpaceID()
    let tabID = TerminalTabID()
    let paneID = UUID()

    let state = TerminalHostState.newTabSelectionState(
      TerminalHostState.NewTabSelectionInput(
        selectedSpaceID: spaceID,
        targetSpaceID: spaceID,
        selectedTabID: tabID,
        targetTabID: tabID,
        windowActivity: WindowActivityState(isKeyWindow: true, isVisible: true),
        focusedSurfaceID: paneID,
        surfaceID: paneID
      )
    )

    #expect(state.isSelectedSpace)
    #expect(state.isSelectedTab)
    #expect(state.isFocused)
  }

  @Test
  func newTabSelectionStateReportsSelectedSpaceWithoutSelectedTabWhenAnotherTabRemainsSelected() {
    let spaceID = TerminalSpaceID()
    let selectedTabID = TerminalTabID()
    let targetTabID = TerminalTabID()
    let paneID = UUID()

    let state = TerminalHostState.newTabSelectionState(
      TerminalHostState.NewTabSelectionInput(
        selectedSpaceID: spaceID,
        targetSpaceID: spaceID,
        selectedTabID: selectedTabID,
        targetTabID: targetTabID,
        windowActivity: WindowActivityState(isKeyWindow: true, isVisible: true),
        focusedSurfaceID: paneID,
        surfaceID: paneID
      )
    )

    #expect(state.isSelectedSpace)
    #expect(!state.isSelectedTab)
    #expect(!state.isFocused)
  }

  @Test
  func newTabSelectionStateReportsUnselectedSpaceWhenAnotherSpaceRemainsSelected() {
    let selectedSpaceID = TerminalSpaceID()
    let targetSpaceID = TerminalSpaceID()
    let targetTabID = TerminalTabID()
    let paneID = UUID()

    let state = TerminalHostState.newTabSelectionState(
      TerminalHostState.NewTabSelectionInput(
        selectedSpaceID: selectedSpaceID,
        targetSpaceID: targetSpaceID,
        selectedTabID: targetTabID,
        targetTabID: targetTabID,
        windowActivity: WindowActivityState(isKeyWindow: true, isVisible: true),
        focusedSurfaceID: paneID,
        surfaceID: paneID
      )
    )

    #expect(!state.isSelectedSpace)
    #expect(!state.isSelectedTab)
    #expect(!state.isFocused)
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
