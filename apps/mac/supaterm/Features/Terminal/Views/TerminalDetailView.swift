import ComposableArchitecture
import SwiftUI

struct TerminalDetailView: View {
  let store: StoreOf<TerminalWindowFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    VStack(spacing: 0) {
      TerminalDetailTopBar(
        palette: palette,
        backgroundColor: terminal.terminalBackgroundColor,
        title: terminal.selectedPaneDisplayTitle
      )
      TerminalDetailSurface(
        store: store,
        terminal: terminal,
        selectedTabID: selectedTabID
      )
    }
    .compositingGroup()
    .terminalPaneChrome(palette: palette)
  }
}

private struct TerminalDetailTopBar: View {
  let palette: TerminalPalette
  let backgroundColor: Color
  let title: String

  var body: some View {
    HStack(spacing: 0) {
      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity, minHeight: 36, maxHeight: 36, alignment: .leading)
    .background(backgroundColor)
    .overlay(alignment: .bottom) {
      Rectangle()
        .fill(palette.detailStroke)
        .frame(height: 1)
    }
  }
}

private struct TerminalDetailSurface: View {
  let store: StoreOf<TerminalWindowFeature>
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
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let tabID: TerminalTabID

  var body: some View {
    TerminalSplitTreeAXContainer(
      tree: terminal.splitTree(for: tabID),
      unreadSurfaceIDs: terminal.unreadNotifiedSurfaceIDs(in: tabID)
    ) { operation in
      _ = store.send(.splitOperationRequested(tabID: tabID, operation: operation))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
