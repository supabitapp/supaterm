import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>
  @Bindable var terminal: TerminalHostState

  var body: some View {
    applyFocusedActions(
      content: TerminalView(store: store, terminal: terminal)
        .task {
          store.send(.update(.task))
        },
      actions: makeFocusedActions()
    )
  }

  private func applyFocusedActions<Content: View>(
    content: Content,
    actions: FocusedActions
  ) -> some View {
    content
      .focusedSceneValue(\.newTerminalAction, actions.newTerminal)
      .focusedSceneValue(\.closeSurfaceAction, actions.closeSurface)
      .focusedSceneValue(\.closeTabAction, actions.closeTab)
      .focusedSceneValue(\.nextTabAction, actions.nextTab)
      .focusedSceneValue(\.previousTabAction, actions.previousTab)
      .focusedSceneValue(\.selectTabAction, actions.selectTab)
      .focusedSceneValue(\.selectLastTabAction, actions.selectLastTab)
      .focusedSceneValue(\.startSearchAction, actions.startSearch)
      .focusedSceneValue(\.searchSelectionAction, actions.searchSelection)
      .focusedSceneValue(\.navigateSearchNextAction, actions.navigateSearchNext)
      .focusedSceneValue(\.navigateSearchPreviousAction, actions.navigateSearchPrevious)
      .focusedSceneValue(\.endSearchAction, actions.endSearch)
      .focusedSceneValue(\.splitBelowAction, actions.splitBelow)
      .focusedSceneValue(\.splitRightAction, actions.splitRight)
      .focusedSceneValue(\.equalizePanesAction, actions.equalizePanes)
      .focusedSceneValue(\.togglePaneZoomAction, actions.togglePaneZoom)
  }

  private func makeFocusedActions() -> FocusedActions {
    let hasTab = terminal.selectedTabID != nil
    let hasSurface = terminal.selectedSurfaceView != nil
    let hasVisibleTabs = !terminal.visibleTabs.isEmpty

    return FocusedActions(
      newTerminal: { _ = terminal.createTab() },
      closeSurface: hasSurface ? { _ = terminal.closeFocusedSurface() } : nil,
      closeTab: hasTab ? { _ = terminal.requestCloseSelectedTab() } : nil,
      nextTab: hasTab ? { terminal.nextTab() } : nil,
      previousTab: hasTab ? { terminal.previousTab() } : nil,
      selectTab: hasVisibleTabs ? { terminal.selectTab(slot: $0) } : nil,
      selectLastTab: hasVisibleTabs ? { terminal.selectLastTab() } : nil,
      startSearch: hasSurface ? { _ = terminal.startSearch() } : nil,
      searchSelection: hasSurface ? { _ = terminal.searchSelection() } : nil,
      navigateSearchNext: hasSurface ? { _ = terminal.navigateSearchNext() } : nil,
      navigateSearchPrevious: hasSurface ? { _ = terminal.navigateSearchPrevious() } : nil,
      endSearch: hasSurface ? { _ = terminal.endSearch() } : nil,
      splitBelow: hasSurface ? { _ = terminal.splitBelow() } : nil,
      splitRight: hasSurface ? { _ = terminal.splitRight() } : nil,
      equalizePanes: hasSurface ? { _ = terminal.equalizePanes() } : nil,
      togglePaneZoom: hasSurface ? { _ = terminal.togglePaneZoom() } : nil
    )
  }

  private struct FocusedActions {
    let newTerminal: (() -> Void)?
    let closeSurface: (() -> Void)?
    let closeTab: (() -> Void)?
    let nextTab: (() -> Void)?
    let previousTab: (() -> Void)?
    let selectTab: ((Int) -> Void)?
    let selectLastTab: (() -> Void)?
    let startSearch: (() -> Void)?
    let searchSelection: (() -> Void)?
    let navigateSearchNext: (() -> Void)?
    let navigateSearchPrevious: (() -> Void)?
    let endSearch: (() -> Void)?
    let splitBelow: (() -> Void)?
    let splitRight: (() -> Void)?
    let equalizePanes: (() -> Void)?
    let togglePaneZoom: (() -> Void)?
  }
}
