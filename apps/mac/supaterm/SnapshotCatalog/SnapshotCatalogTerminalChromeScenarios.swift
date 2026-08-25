import SupaTheme
import SwiftUI

extension SnapshotCatalog {
  static let terminalChromeScenarios: [SnapshotScenario] = [
    scenario(
      "space-switcher",
      group: "Terminal Chrome",
      title: "Window Space switcher",
      size: CGSize(width: 360, height: 64)
    ) { appearance in
      AnyView(TerminalWindowHeaderSnapshotFixture(appearance: appearance))
    },
    scenario(
      "space-switcher-hover",
      group: "Terminal Chrome",
      title: "Window Space switcher hover",
      size: CGSize(width: 240, height: 48)
    ) { appearance in
      AnyView(SpaceSwitcherHoverSnapshotFixture(appearance: appearance))
    },
    scenario(
      "agents-popover",
      group: "Terminal Chrome",
      title: "Agents popover",
      size: CGSize(width: 300, height: 230)
    ) { appearance in
      AnyView(AgentsPopoverSnapshotFixture(appearance: appearance))
    },
    scenario(
      "detail-pane",
      group: "Terminal Chrome",
      title: "Sidebar and detail pane",
      size: CGSize(width: 760, height: 420)
    ) { appearance in
      AnyView(
        TerminalChromeSnapshotFixture(
          appearance: appearance,
          paneTitles: ["supaterm"],
          terminal: SidebarChromeSnapshotContext.selectedGroupTerminal
        )
      )
    },
    scenario(
      "split-panes",
      group: "Terminal Chrome",
      title: "Four-pane split grid",
      size: CGSize(width: 1200, height: 700)
    ) { appearance in
      AnyView(
        TerminalChromeSnapshotFixture(
          appearance: appearance,
          paneTitles: [
            "build — supaterm",
            "tests — supaterm",
            "server — supaterm",
            "docs — supaterm",
          ],
          terminal: SidebarChromeSnapshotContext.selectedGroupTerminal
        )
      )
    },
    scenario(
      "floating-sidebar",
      group: "Terminal Chrome",
      title: "Floating sidebar",
      size: CGSize(width: 760, height: 420)
    ) { appearance in
      AnyView(FloatingSidebarSnapshotFixture(appearance: appearance))
    },
    scenario(
      "split-drop-target",
      group: "Terminal Chrome",
      title: "Split drop target",
      size: CGSize(width: 760, height: 420)
    ) { appearance in
      AnyView(SplitDropTargetSnapshotFixture(appearance: appearance))
    },
  ]
}

private struct AgentsPopoverSnapshotFixture: View {
  let appearance: SnapshotAppearance

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalAgentsPopoverView(
      items: TerminalAgentsPopoverItem.dummyData,
      palette: palette
    )
    .background {
      ChromeBackgroundView(
        palette: palette,
        material: .popover,
        blendingMode: .withinWindow
      )
    }
    .compositingGroup()
    .clipShape(.rect(cornerRadius: 12))
    .shadow(color: palette.shadow, radius: 12, y: 6)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(palette.windowBackgroundTint)
    .environment(\.colorScheme, appearance.colorScheme)
  }
}

@MainActor
private struct TerminalWindowHeaderSnapshotFixture: View {
  let appearance: SnapshotAppearance

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalWindowHeader(
      store: SidebarChromeSnapshotContext.windowStore(),
      palette: palette,
      terminal: SidebarChromeSnapshotContext.terminal
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(palette.windowBackgroundTint)
    .environment(\.colorScheme, appearance.colorScheme)
  }
}

private struct SpaceSwitcherHoverSnapshotFixture: View {
  let appearance: SnapshotAppearance

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalSpaceSwitcherLabel(
      palette: palette,
      name: SidebarChromeSnapshotContext.selectedGroupTerminal.displayedSpace.name,
      isHovered: true
    )
    .padding(10)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .background(palette.windowBackgroundTint)
    .environment(\.colorScheme, appearance.colorScheme)
  }
}

@MainActor
private struct TerminalChromeSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let paneTitles: [String]
  let terminal: TerminalHostState
  @State private var sidebarControllerCache = TerminalSidebarControllerCache(
    windowControllerID: UUID(),
    tabDragRegistry: TerminalTabDragRegistry(),
    captureRequest: { nil }
  )

  private var palette: Palette {
    Palette(
      colorScheme: appearance.colorScheme,
      tint: terminal.displayedSpace.color
    )
  }

  var body: some View {
    HStack(spacing: 0) {
      TerminalSidebarView(
        store: SidebarChromeSnapshotContext.windowStore(),
        updateStore: SidebarChromeSnapshotContext.updateStore(),
        releaseAnnouncement: nil,
        palette: palette,
        terminal: terminal,
        isPagingActive: true,
        sidebarControllerCache: sidebarControllerCache,
        dismissReleaseAnnouncement: {}
      )
      .frame(width: 228)

      TerminalPaneChromeSnapshotFixture(palette: palette, titles: paneTitles)
    }
    .coordinateSpace(name: TerminalCoordinateSpace.split)
    .environment(SidebarChromeSnapshotContext.commandHold)
    .environment(SidebarChromeSnapshotContext.ghosttyShortcuts)
    .background(ChromeBackgroundView(palette: palette))
  }

}

@MainActor
private struct FloatingSidebarSnapshotFixture: View {
  let appearance: SnapshotAppearance
  @State private var sidebarControllerCache = TerminalSidebarControllerCache(
    windowControllerID: UUID(),
    tabDragRegistry: TerminalTabDragRegistry(),
    captureRequest: { nil }
  )

  private var palette: Palette {
    Palette(
      colorScheme: appearance.colorScheme,
      tint: SidebarChromeSnapshotContext.selectedGroupTerminal.displayedSpace.color
    )
  }

  var body: some View {
    ZStack(alignment: .leading) {
      TerminalPaneChromeSnapshotFixture(palette: palette, titles: ["supaterm"])

      TerminalSidebarSurfaceShell(palette: palette, isFloating: true) {
        TerminalSidebarView(
          store: SidebarChromeSnapshotContext.windowStore(),
          updateStore: SidebarChromeSnapshotContext.updateStore(),
          releaseAnnouncement: nil,
          palette: palette,
          terminal: SidebarChromeSnapshotContext.selectedGroupTerminal,
          isPagingActive: true,
          sidebarControllerCache: sidebarControllerCache,
          dismissReleaseAnnouncement: {}
        )
      }
      .frame(width: 228)
    }
    .environment(SidebarChromeSnapshotContext.commandHold)
    .environment(SidebarChromeSnapshotContext.ghosttyShortcuts)
    .background(ChromeBackgroundView(palette: palette))
    .environment(\.colorScheme, appearance.colorScheme)
  }
}

private struct TerminalPaneChromeSnapshotFixture: View {
  let palette: Palette
  let titles: [String]

  private var isSplit: Bool {
    titles.count > 1
  }

  var body: some View {
    Group {
      if titles.count == 4 {
        HStack(spacing: 0) {
          VStack(spacing: 0) {
            pane(index: 0, title: titles[0])
            pane(index: 2, title: titles[2])
          }
          VStack(spacing: 0) {
            pane(index: 1, title: titles[1])
            pane(index: 3, title: titles[3])
          }
        }
      } else {
        HStack(spacing: 0) {
          ForEach(Array(titles.enumerated()), id: \.offset) { index, title in
            pane(index: index, title: title)
          }
        }
      }
    }
    .background(isSplit ? Color.clear : palette.detailBackground)
  }

  private func pane(index: Int, title: String) -> some View {
    VStack(spacing: 0) {
      TerminalPaneTopBar(
        canEqualize: isSplit,
        isPaneZoomed: false,
        isSidebarCollapsed: false,
        showsSidebarAttentionIndicator: false,
        showsSidebarButton: index == 0,
        palette: palette,
        backgroundColor: palette.detailBackground,
        paneID: SnapshotFixtureValues.uuid(
          "60000000-0000-0000-0000-00000000000\(index)"
        ),
        equalizePanes: {},
        toggleSidebar: {},
        title: title,
        splitDown: {},
        splitRight: {},
        togglePaneZoom: {}
      )
      palette.detailBackground
    }
    .compositingGroup()
    .clipShape(
      RoundedRectangle(
        cornerRadius: isSplit ? TerminalChromeMetrics.paneCornerRadius : 0,
        style: .continuous
      )
    )
    .shadow(
      color: palette.detailShadow.opacity(isSplit ? 1 : 0),
      radius: 2,
      x: 0,
      y: 1
    )
    .padding(paneInsets(index: index))
  }

  private func paneInsets(index: Int) -> EdgeInsets {
    guard isSplit else {
      return EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0)
    }
    var outerEdges = TerminalSplitTreeView.OuterEdges.all
    let horizontalBranch: TerminalSplitTreeView.OuterEdgeBranch =
      index.isMultiple(of: 2)
      ? .left
      : .right
    outerEdges = outerEdges.child(horizontalBranch, in: .horizontal)
    if titles.count == 4 {
      let verticalBranch: TerminalSplitTreeView.OuterEdgeBranch = index < 2 ? .left : .right
      outerEdges = outerEdges.child(verticalBranch, in: .vertical)
    }
    return outerEdges.paneInsets(
      outer: TerminalChromeMetrics.paneInset,
      inner: TerminalChromeMetrics.paneGap / 2
    )
  }
}

private struct SplitDropTargetSnapshotFixture: View {
  let appearance: SnapshotAppearance

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    SplitDropTargetSnapshotView(appearance: appearance)
      .background(ChromeBackgroundView(palette: palette))
      .environment(\.colorScheme, appearance.colorScheme)
  }
}

private struct SplitDropTargetSnapshotView: NSViewRepresentable {
  let appearance: SnapshotAppearance

  func makeNSView(context: Context) -> TerminalTabSplitDropOverlayView {
    TerminalTabSplitDropOverlayView()
  }

  func updateNSView(_ nsView: TerminalTabSplitDropOverlayView, context: Context) {
    nsView.appearance = NSAppearance(
      named: appearance == .light ? .aqua : .darkAqua
    )
    nsView.layoutSubtreeIfNeeded()
    nsView.render(
      .right,
      color: Palette(colorScheme: appearance.colorScheme).accent
    )
  }
}
