import SupaTheme
import SwiftUI

struct TerminalPaneTopBar: View {
  let canEqualize: Bool
  let isPaneZoomed: Bool
  let isSidebarCollapsed: Bool
  let showsSidebarAttentionIndicator: Bool
  let showsSidebarButton: Bool
  let palette: Palette
  let backgroundColor: Color
  let paneID: UUID
  let equalizePanes: () -> Void
  let toggleSidebar: () -> Void
  let title: String
  let splitDown: () -> Void
  let splitRight: () -> Void
  let togglePaneZoom: () -> Void

  private var accessibilityNamespace: String {
    "terminal.pane-toolbar.\(paneID.uuidString)"
  }

  private var sidebarAccessibilityLabel: String {
    if showsSidebarAttentionIndicator {
      return "Show sidebar, unread notifications"
    }
    return isSidebarCollapsed ? "Show sidebar" : "Hide sidebar"
  }

  var body: some View {
    HStack(spacing: 0) {
      if showsSidebarButton {
        ToolbarIconButton(
          symbol: "sidebar.left",
          palette: palette,
          accessibilityLabel: sidebarAccessibilityLabel,
          showsAttentionIndicator: showsSidebarAttentionIndicator,
          action: toggleSidebar
        )
        .help(isSidebarCollapsed ? "Show Sidebar" : "Hide Sidebar")
        .accessibilityIdentifier("\(accessibilityNamespace).sidebar")
      }

      Text(title)
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.leading, showsSidebarButton ? 8 : 4)
        .layoutPriority(1)

      Spacer(minLength: 8)

      TerminalPaneToolbarControls(
        accessibilityNamespace: accessibilityNamespace,
        canEqualize: canEqualize,
        isPaneZoomed: isPaneZoomed,
        palette: palette,
        equalizePanes: equalizePanes,
        splitDown: splitDown,
        splitRight: splitRight,
        togglePaneZoom: togglePaneZoom
      )
    }
    .padding(.leading, showsSidebarButton ? 8 : 4)
    .padding(.trailing, 4)
    .frame(
      maxWidth: .infinity,
      minHeight: TerminalChromeMetrics.detailToolbarHeight,
      maxHeight: TerminalChromeMetrics.detailToolbarHeight,
      alignment: .leading
    )
    .background {
      Rectangle()
        .fill(backgroundColor)
    }
    .overlay(alignment: .bottom) {
      Rectangle()
        .fill(palette.detailStroke)
        .frame(height: 1)
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Pane toolbar")
    .accessibilityIdentifier(accessibilityNamespace)
  }
}

private struct TerminalPaneToolbarControls: View {
  let accessibilityNamespace: String
  let canEqualize: Bool
  let isPaneZoomed: Bool
  let palette: Palette
  let equalizePanes: () -> Void
  let splitDown: () -> Void
  let splitRight: () -> Void
  let togglePaneZoom: () -> Void

  private var zoomSymbol: String {
    isPaneZoomed ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right"
  }

  private var zoomTitle: String {
    isPaneZoomed ? "Reset Split Zoom" : "Zoom Split"
  }

  private var zoomAccessibilityLabel: String {
    isPaneZoomed ? "Reset split zoom" : "Zoom split"
  }

  var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 4) {
        ToolbarIconButton(
          symbol: "square.split.2x1",
          palette: palette,
          accessibilityLabel: "Split right",
          action: splitRight
        )
        .help("Split Right")
        .accessibilityIdentifier("\(accessibilityNamespace).split-right")

        ToolbarIconButton(
          symbol: "square.split.1x2",
          palette: palette,
          accessibilityLabel: "Split down",
          action: splitDown
        )
        .help("Split Down")
        .accessibilityIdentifier("\(accessibilityNamespace).split-down")

        ToolbarIconButton(
          symbol: "equal.square",
          palette: palette,
          accessibilityLabel: "Equalize panes",
          action: equalizePanes
        )
        .help("Equalize Panes")
        .disabled(!canEqualize)
        .opacity(canEqualize ? 1 : 0.45)
        .accessibilityIdentifier("\(accessibilityNamespace).equalize")

        if canEqualize {
          ToolbarIconButton(
            symbol: zoomSymbol,
            palette: palette,
            accessibilityLabel: zoomAccessibilityLabel,
            isSelected: isPaneZoomed,
            fontSize: 13,
            action: togglePaneZoom
          )
          .help(zoomTitle)
          .accessibilityIdentifier("\(accessibilityNamespace).zoom")
        }
      }
      .fixedSize(horizontal: true, vertical: false)

      Menu {
        Button("Split Right", systemImage: "square.split.2x1", action: splitRight)
        Button("Split Down", systemImage: "square.split.1x2", action: splitDown)
        Button("Equalize Panes", systemImage: "equal.square", action: equalizePanes)
          .disabled(!canEqualize)
        if canEqualize {
          Button(
            zoomTitle,
            systemImage: zoomSymbol,
            action: togglePaneZoom
          )
        }
      } label: {
        Image(systemName: "ellipsis.circle")
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 30, height: 30)
          .accessibilityHidden(true)
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
      .help("Pane Actions")
      .accessibilityLabel("Pane actions")
      .accessibilityIdentifier("\(accessibilityNamespace).actions")
    }
  }
}
