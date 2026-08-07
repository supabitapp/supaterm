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
  ]
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
    TerminalNativeSpaceSwitcher(
      configuration: TerminalNativeSpaceSwitcherConfiguration(
        palette: palette,
        spaces: SidebarChromeSnapshotContext.selectedGroupTerminal.spaces,
        selectedSpaceID: SidebarChromeSnapshotContext.selectedGroupTerminal.displayedSpaceID,
        shortcutOverrides: [:],
        select: { _ in },
        create: {},
        edit: { _ in },
        delete: { _ in },
        reorder: { _, _ in },
        dropTab: { _, _ in false }
      )
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
  @State private var sidebarControllerCache = TerminalSidebarControllerCache()

  private var palette: Palette {
    Palette(
      colorScheme: appearance.colorScheme,
      tint: SidebarChromeSnapshotContext.selectedGroupTerminal.displayedSpace.color
    )
  }

  var body: some View {
    HStack(spacing: 0) {
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
    if let selectedTabID = SidebarChromeSnapshotContext.selectedGroupTerminal.selectedTabID {
      TerminalDetailView(
        store: SidebarChromeSnapshotContext.windowStore(),
        palette: palette,
        terminal: SidebarChromeSnapshotContext.selectedGroupTerminal,
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
  @State private var sidebarControllerCache = TerminalSidebarControllerCache()

  private var palette: Palette {
    Palette(
      colorScheme: appearance.colorScheme,
      tint: SidebarChromeSnapshotContext.selectedGroupTerminal.displayedSpace.color
    )
  }

  var body: some View {
    ZStack(alignment: .leading) {
      if let selectedTabID = SidebarChromeSnapshotContext.selectedGroupTerminal.selectedTabID {
        TerminalDetailView(
          store: SidebarChromeSnapshotContext.windowStore(),
          palette: palette,
          terminal: SidebarChromeSnapshotContext.selectedGroupTerminal,
          selectedTabID: selectedTabID
        )
      } else {
        Color.clear
      }

      TerminalFloatingSidebarShell(palette: palette) {
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
