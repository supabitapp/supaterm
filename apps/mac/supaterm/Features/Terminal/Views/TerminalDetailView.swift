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
        canEqualize: terminal.selectedTree?.isSplit ?? false,
        canSplit: terminal.selectedSurfaceView != nil,
        isSidebarCollapsed: store.isSidebarCollapsed,
        palette: palette,
        backgroundColor: terminal.terminalBackgroundColor,
        equalizePanes: {
          _ = store.send(.bindingMenuItemSelected(.equalizeSplits))
        },
        toggleSidebar: {
          withAnimation(.spring(response: 0.2, dampingFraction: 1.0)) {
            _ = store.send(.toggleSidebarButtonTapped)
          }
        },
        title: terminal.selectedPaneDisplayTitle,
        splitDown: {
          _ = store.send(.bindingMenuItemSelected(.newSplit(.down)))
        },
        splitRight: {
          _ = store.send(.bindingMenuItemSelected(.newSplit(.right)))
        }
      )
      TerminalDetailSurface(
        store: store,
        notificationColor: terminal.notificationAttentionColor,
        terminal: terminal,
        selectedTabID: selectedTabID
      )
    }
    .compositingGroup()
    .terminalPaneChrome(palette: palette)
  }
}

private struct TerminalDetailTopBar: View {
  let canEqualize: Bool
  let canSplit: Bool
  let isSidebarCollapsed: Bool
  let palette: TerminalPalette
  let backgroundColor: Color
  let equalizePanes: () -> Void
  let toggleSidebar: () -> Void
  let title: String
  let splitDown: () -> Void
  let splitRight: () -> Void

  var body: some View {
    HStack(spacing: 0) {
      ToolbarIconButton(
        symbol: "sidebar.left",
        palette: palette,
        accessibilityLabel: isSidebarCollapsed ? "Show sidebar" : "Hide sidebar",
        action: toggleSidebar
      )
      .help(isSidebarCollapsed ? "Show Sidebar" : "Hide Sidebar")

      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.leading, 8)

      Spacer(minLength: 8)
      HStack(spacing: 4) {
        ToolbarIconButton(
          symbol: "square.split.2x1",
          palette: palette,
          accessibilityLabel: "Split right",
          action: splitRight
        )
        .help("Split Right")
        .disabled(!canSplit)
        .opacity(canSplit ? 1 : 0.45)

        ToolbarIconButton(
          symbol: "square.split.1x2",
          palette: palette,
          accessibilityLabel: "Split down",
          action: splitDown
        )
        .help("Split Down")
        .disabled(!canSplit)
        .opacity(canSplit ? 1 : 0.45)

        ToolbarIconButton(
          symbol: "equal.square",
          palette: palette,
          accessibilityLabel: "Equalize panes",
          action: equalizePanes
        )
        .help("Equalize Panes")
        .disabled(!canEqualize)
        .opacity(canEqualize ? 1 : 0.45)
      }
    }
    .padding(.leading, 8)
    .padding(.trailing, 4)
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
  let notificationColor: Color
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    TerminalTabContentStack(tabs: terminal.tabs, selectedTabId: selectedTabID) { tabID in
      TerminalSurfacePaneView(
        notificationColor: notificationColor,
        store: store,
        terminal: terminal,
        tabID: tabID
      )
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct TerminalSurfacePaneView: View {
  let notificationColor: Color
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let tabID: TerminalTabID

  var body: some View {
    TerminalSplitTreeAXContainer(
      focusedSurfaceIDs: terminal.focusedNotifiedSurfaceIDs(in: tabID),
      notificationColor: notificationColor,
      tree: terminal.splitTree(for: tabID),
      unreadSurfaceIDs: terminal.unreadNotifiedSurfaceIDs(in: tabID)
    ) { operation in
      _ = store.send(.splitOperationRequested(tabID: tabID, operation: operation))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
