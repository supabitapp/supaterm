import ComposableArchitecture
import SwiftUI

struct TerminalDetailView: View {
  let store: StoreOf<TerminalSceneFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    TerminalDetailSurface(
      store: store,
      terminal: terminal,
      selectedTabID: selectedTabID
    )
    .compositingGroup()
    .terminalPaneChrome(palette: palette)
  }
}

private struct TerminalDetailSurface: View {
  let store: StoreOf<TerminalSceneFeature>
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    TerminalTabContentStack(tabs: terminal.tabs, selectedTabId: selectedTabID) { tabID in
      TerminalSurfacePaneView(
        store: store,
        terminal: terminal,
        tabID: tabID
      )
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct TerminalSurfacePaneView: View {
  let store: StoreOf<TerminalSceneFeature>
  let terminal: TerminalHostState
  let tabID: TerminalTabID

  var body: some View {
    TerminalSplitTreeAXContainer(tree: terminal.splitTree(for: tabID)) { operation in
      _ = store.send(.splitOperationRequested(tabID: tabID, operation: operation))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
