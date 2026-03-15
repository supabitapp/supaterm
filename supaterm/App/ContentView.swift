import ComposableArchitecture
import SwiftUI

struct ContentView: View {
  let store: StoreOf<AppFeature>
  @Bindable var terminal: TerminalHostState

  private var terminalStore: StoreOf<TerminalSceneFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  var body: some View {
    applyFocusedActions(
      content: TerminalView(
        store: terminalStore,
        terminal: terminal,
        updateStore: store.scope(state: \.update, action: \.update)
      )
      .task {
        store.send(.update(.task))
        terminalStore.send(.task)
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
      .focusedSceneValue(\.toggleSidebarAction, actions.toggleSidebar)
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
      newTerminal: {
        terminalStore.send(.newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id))
      },
      closeSurface: hasSurface
        ? {
          terminalStore.send(.closeSurfaceMenuItemSelected)
        } : nil,
      closeTab: hasTab
        ? {
          guard let selectedTabID = terminal.selectedTabID else { return }
          terminalStore.send(.closeTabRequested(selectedTabID))
        } : nil,
      nextTab: hasTab
        ? {
          terminalStore.send(.nextTabMenuItemSelected)
        } : nil,
      previousTab: hasTab
        ? {
          terminalStore.send(.previousTabMenuItemSelected)
        } : nil,
      selectTab: hasVisibleTabs
        ? {
          terminalStore.send(.selectTabMenuItemSelected($0))
        } : nil,
      selectLastTab: hasVisibleTabs
        ? {
          terminalStore.send(.selectLastTabMenuItemSelected)
        } : nil,
      toggleSidebar: {
        terminalStore.send(.toggleSidebarButtonTapped)
      },
      startSearch: hasSurface
        ? {
          terminalStore.send(.startSearchMenuItemSelected)
        } : nil,
      searchSelection: hasSurface
        ? {
          terminalStore.send(.searchSelectionMenuItemSelected)
        } : nil,
      navigateSearchNext: hasSurface
        ? {
          terminalStore.send(.navigateSearchNextMenuItemSelected)
        } : nil,
      navigateSearchPrevious: hasSurface
        ? {
          terminalStore.send(.navigateSearchPreviousMenuItemSelected)
        } : nil,
      endSearch: hasSurface
        ? {
          terminalStore.send(.endSearchMenuItemSelected)
        } : nil,
      splitBelow: hasSurface
        ? {
          terminalStore.send(.splitBelowMenuItemSelected)
        } : nil,
      splitRight: hasSurface
        ? {
          terminalStore.send(.splitRightMenuItemSelected)
        } : nil,
      equalizePanes: hasSurface
        ? {
          terminalStore.send(.equalizePanesMenuItemSelected)
        } : nil,
      togglePaneZoom: hasSurface
        ? {
          terminalStore.send(.togglePaneZoomMenuItemSelected)
        } : nil
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
    let toggleSidebar: (() -> Void)?
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
