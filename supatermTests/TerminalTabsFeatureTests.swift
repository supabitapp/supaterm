import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalTabsFeatureTests {
  @Test
  func initialStateMatchesStarterContent() {
    let state = TerminalTabsFeature.State()

    #expect(state.pinnedTabs.map(\.title) == ["Command Deck", "Sessions", "Profiles"])
    #expect(state.regularTabs.map(\.title) == ["Workspace Notes", "Build Output", "Window Styling", "Search Results"])
    #expect(state.selectedTab.title == "Command Deck")
  }

  @Test
  func newTabAppendsRegularTabAndSelectsIt() async {
    let store = TestStore(initialState: TerminalTabsFeature.State()) {
      TerminalTabsFeature()
    } withDependencies: {
      $0.uuid = .incrementing
    }

    await store.send(.newTabButtonTapped) {
      let newTab = TerminalTabsFeature.Tab.makeNewTab(
        id: UUID(uuidString: "00000000-0000-0000-0000-000000000000")!
      )
      $0.tabs.append(newTab)
      $0.selectedTabID = newTab.id
    }
  }

  @Test
  func closingSelectedTabSelectsNextVisibleNeighbor() async {
    let initialState = TerminalTabsFeature.State(
      selectedTabID: TerminalTabsFeature.State().regularTabs[1].id
    )
    let store = TestStore(initialState: initialState) {
      TerminalTabsFeature()
    }
    let closingID = store.state.selectedTabID
    let expectedSelection = store.state.visibleTabs[5].id

    await store.send(.closeButtonTapped(closingID)) {
      $0.tabs.remove(id: closingID)
      $0.selectedTabID = expectedSelection
    }
  }

  @Test
  func closingLastTabCreatesReplacement() async {
    let onlyTab = TerminalTabsFeature.Tab(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49999")!,
      title: "Only Tab",
      symbol: "terminal",
      isPinned: false,
    )
    let initialState = TerminalTabsFeature.State(
      tabs: [onlyTab],
      selectedTabID: onlyTab.id
    )
    let store = TestStore(initialState: initialState) {
      TerminalTabsFeature()
    } withDependencies: {
      $0.uuid = .incrementing
    }

    await store.send(.closeButtonTapped(onlyTab.id)) {
      $0.tabs.remove(id: onlyTab.id)
      let replacement = TerminalTabsFeature.Tab.makeNewTab(
        id: UUID(uuidString: "00000000-0000-0000-0000-000000000000")!
      )
      $0.tabs.append(replacement)
      $0.selectedTabID = replacement.id
      $0.draggedTabID = nil
    }
  }

  @Test
  func pinToggleMovesRegularTabIntoPinnedSection() async {
    let initialState = TerminalTabsFeature.State(
      selectedTabID: TerminalTabsFeature.State().regularTabs[0].id
    )
    let store = TestStore(initialState: initialState) {
      TerminalTabsFeature()
    }
    let movedID = store.state.selectedTabID

    await store.send(.pinToggled(movedID)) {
      var tab = $0.tabs[id: movedID]!
      var pinned = $0.pinnedTabs
      var regular = $0.regularTabs
      regular.removeAll { $0.id == movedID }
      tab.isPinned = true
      pinned.append(tab)
      $0.tabs = IdentifiedArray(uniqueElements: pinned + regular)
    }
  }

  @Test
  func reorderWithinSectionPreservesSetAndChangesOrder() async {
    let store = TestStore(initialState: TerminalTabsFeature.State()) {
      TerminalTabsFeature()
    }
    let draggedID = store.state.regularTabs[2].id
    let targetID = store.state.regularTabs[0].id

    await store.send(.dragMovedBeforeTab(draggedID: draggedID, targetID: targetID)) {
      let dragged = $0.tabs[id: draggedID]!
      var pinned = $0.pinnedTabs
      var regular = $0.regularTabs
      regular.removeAll { $0.id == draggedID }
      regular.insert(dragged, at: 0)
      $0.tabs = IdentifiedArray(uniqueElements: pinned + regular)
    }
  }

  @Test
  func movingBetweenSectionsUpdatesMembershipAndPosition() async {
    let store = TestStore(initialState: TerminalTabsFeature.State()) {
      TerminalTabsFeature()
    }
    let draggedID = store.state.regularTabs[1].id
    let targetID = store.state.pinnedTabs[1].id

    await store.send(.dragMovedBeforeTab(draggedID: draggedID, targetID: targetID)) {
      var dragged = $0.tabs[id: draggedID]!
      var pinned = $0.pinnedTabs
      var regular = $0.regularTabs
      regular.removeAll { $0.id == draggedID }
      dragged.isPinned = true
      pinned.insert(dragged, at: 1)
      $0.tabs = IdentifiedArray(uniqueElements: pinned + regular)
    }
  }

  @Test
  func commandZeroSelectsTenthVisibleTab() async {
    var state = TerminalTabsFeature.State()
    for _ in 0..<3 {
      state.tabs.append(
        .makeNewTab(id: UUID())
      )
    }
    state.selectedTabID = state.tabs[0].id

    let store = TestStore(initialState: state) {
      TerminalTabsFeature()
    }
    let expectedID = store.state.visibleTabs[9].id

    await store.send(.tabShortcutPressed(10)) {
      $0.selectedTabID = expectedID
    }
  }
}
