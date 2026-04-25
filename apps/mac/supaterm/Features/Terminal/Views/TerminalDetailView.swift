import ComposableArchitecture
import Sharing
import SupatermSupport
import SwiftUI

struct TerminalDetailView: View {
  @Shared(.supatermSettings) private var supatermSettings = .default
  let store: StoreOf<TerminalWindowFeature>
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 0) {
      TerminalDetailTopBar(
        canEqualize: terminal.selectedTree?.isSplit ?? false,
        canSplit: terminal.selectedSurfaceView != nil,
        isPaneZoomed: terminal.selectedPaneIsZoomed,
        isSidebarCollapsed: store.isSidebarCollapsed,
        palette: palette,
        backgroundColor: terminal.terminalBackgroundColor,
        equalizePanes: {
          _ = store.send(.bindingMenuItemSelected(.equalizeSplits))
        },
        toggleSidebar: {
          TerminalMotion.animate(
            .spring(response: 0.2, dampingFraction: 1.0),
            reduceMotion: reduceMotion
          ) {
            _ = store.send(.toggleSidebarButtonTapped)
          }
        },
        title: terminal.selectedPaneDisplayTitle,
        splitDown: {
          _ = store.send(.bindingMenuItemSelected(.newSplit(.down)))
        },
        splitRight: {
          _ = store.send(.bindingMenuItemSelected(.newSplit(.right)))
        },
        togglePaneZoom: {
          _ = store.send(.bindingMenuItemSelected(.toggleSplitZoom))
        }
      )
      TerminalDetailSurface(
        store: store,
        dimmingColor: terminal.unfocusedSplitDimmingColor,
        dimmingOpacity: terminal.unfocusedSplitDimmingOpacity,
        focusedSurfaceID: terminal.currentFocusedSurfaceID(),
        notificationColor: terminal.notificationAttentionColor,
        showsGlowingPaneRing: supatermSettings.glowingPaneRingEnabled,
        splitDividerColor: terminal.splitDividerColor,
        terminal: terminal,
        selectedTabID: selectedTabID
      )
      if supatermSettings.bottomBarSettings.enabled {
        TerminalBarView(
          palette: palette,
          terminal: terminal
        )
      }
    }
    .compositingGroup()
    .terminalPaneChrome(palette: palette)
  }
}

private struct TerminalDetailTopBar: View {
  let canEqualize: Bool
  let canSplit: Bool
  let isPaneZoomed: Bool
  let isSidebarCollapsed: Bool
  let palette: TerminalPalette
  let backgroundColor: Color
  let equalizePanes: () -> Void
  let toggleSidebar: () -> Void
  let title: String
  let splitDown: () -> Void
  let splitRight: () -> Void
  let togglePaneZoom: () -> Void

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

        if canEqualize {
          SplitZoomButton(
            isPaneZoomed: isPaneZoomed,
            palette: palette,
            action: togglePaneZoom
          )
        }
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

private struct SplitZoomButton: View {
  let isPaneZoomed: Bool
  let palette: TerminalPalette
  let action: () -> Void

  @State private var isHovering = false

  private var symbol: String {
    isPaneZoomed ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"
  }

  private var helpText: String {
    isPaneZoomed ? "Reset Split Zoom" : "Zoom Split"
  }

  private var accessibilityLabel: String {
    isPaneZoomed ? "Reset split zoom" : "Zoom split"
  }

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(
          isPaneZoomed
            ? Color.accentColor
            : isHovering ? palette.secondaryText.opacity(0.8) : palette.secondaryText
        )
        .frame(width: 30, height: 30)
        .background(
          isPaneZoomed
            ? Color.accentColor.opacity(isHovering ? 0.18 : 0.12)
            : isHovering ? palette.secondaryText.opacity(0.2) : .clear,
          in: .rect(cornerRadius: 6)
        )
        .overlay {
          if isPaneZoomed {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
              .stroke(Color.accentColor.opacity(isHovering ? 0.32 : 0.22), lineWidth: 1)
          }
        }
        .accessibilityHidden(true)
    }
    .buttonStyle(.plain)
    .help(helpText)
    .accessibilityLabel(accessibilityLabel)
    .onHover { isHovering = $0 }
  }
}

private struct TerminalDetailSurface: View {
  let store: StoreOf<TerminalWindowFeature>
  let dimmingColor: Color
  let dimmingOpacity: Double
  let focusedSurfaceID: UUID?
  let notificationColor: Color
  let showsGlowingPaneRing: Bool
  let splitDividerColor: Color
  let terminal: TerminalHostState
  let selectedTabID: TerminalTabID

  var body: some View {
    TerminalSurfacePaneView(
      dimmingColor: dimmingColor,
      dimmingOpacity: dimmingOpacity,
      focusedSurfaceID: focusedSurfaceID,
      notificationColor: notificationColor,
      showsGlowingPaneRing: showsGlowingPaneRing,
      splitDividerColor: splitDividerColor,
      store: store,
      terminal: terminal,
      tabID: selectedTabID
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct TerminalSurfacePaneView: View {
  let dimmingColor: Color
  let dimmingOpacity: Double
  let focusedSurfaceID: UUID?
  let notificationColor: Color
  let showsGlowingPaneRing: Bool
  let splitDividerColor: Color
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let tabID: TerminalTabID

  var body: some View {
    TerminalSplitTreeAXContainer(
      dimmingColor: dimmingColor,
      dimmingOpacity: dimmingOpacity,
      focusedSurfaceID: focusedSurfaceID,
      notificationColor: notificationColor,
      showsGlowingPaneRing: showsGlowingPaneRing,
      splitDividerColor: splitDividerColor,
      tree: terminal.splitTree(for: tabID),
      unreadSurfaceIDs: terminal.unreadNotifiedSurfaceIDs(in: tabID)
    ) { operation in
      _ = store.send(.splitOperationRequested(tabID: tabID, operation: operation))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
