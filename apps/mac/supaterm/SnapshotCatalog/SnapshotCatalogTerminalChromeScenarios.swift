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
      AnyView(TerminalChromeSnapshotFixture(appearance: appearance))
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
      name: SidebarChromeSnapshotContext.selectedProjectTerminal.displayedSpace.name,
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
  @State private var sidebarControllerCache = TerminalSidebarControllerCache(
    windowControllerID: UUID(),
    tabDragRegistry: TerminalTabDragRegistry(),
    captureRequest: { nil }
  )

  private var palette: Palette {
    Palette(
      colorScheme: appearance.colorScheme,
      tint: SidebarChromeSnapshotContext.selectedProjectTerminal.displayedSpace.color
    )
  }

  var body: some View {
    HStack(spacing: 0) {
      TerminalSidebarView(
        store: SidebarChromeSnapshotContext.windowStore(),
        updateStore: SidebarChromeSnapshotContext.updateStore(),
        releaseAnnouncement: nil,
        palette: palette,
        terminal: SidebarChromeSnapshotContext.selectedProjectTerminal,
        isPagingActive: true,
        sidebarControllerCache: sidebarControllerCache,
        dismissReleaseAnnouncement: {}
      )
      .frame(width: 228)

      detail
    }
    .coordinateSpace(name: TerminalCoordinateSpace.split)
    .environment(SidebarChromeSnapshotContext.commandHold)
    .environment(SidebarChromeSnapshotContext.ghosttyShortcuts)
    .background(ChromeBackgroundView(palette: palette))
  }

  @ViewBuilder
  private var detail: some View {
    if let selectedTabID = SidebarChromeSnapshotContext.selectedProjectTerminal.selectedTabID {
      TerminalDetailView(
        store: SidebarChromeSnapshotContext.windowStore(),
        palette: palette,
        terminal: SidebarChromeSnapshotContext.selectedProjectTerminal,
        selectedTabID: selectedTabID
      )
    } else {
      Color.clear
    }
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
      tint: SidebarChromeSnapshotContext.selectedProjectTerminal.displayedSpace.color
    )
  }

  var body: some View {
    ZStack(alignment: .leading) {
      if let selectedTabID = SidebarChromeSnapshotContext.selectedProjectTerminal.selectedTabID {
        TerminalDetailView(
          store: SidebarChromeSnapshotContext.windowStore(),
          palette: palette,
          terminal: SidebarChromeSnapshotContext.selectedProjectTerminal,
          selectedTabID: selectedTabID
        )
      } else {
        Color.clear
      }

      TerminalSidebarSurfaceShell(palette: palette, isFloating: true) {
        TerminalSidebarView(
          store: SidebarChromeSnapshotContext.windowStore(),
          updateStore: SidebarChromeSnapshotContext.updateStore(),
          releaseAnnouncement: nil,
          palette: palette,
          terminal: SidebarChromeSnapshotContext.selectedProjectTerminal,
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
