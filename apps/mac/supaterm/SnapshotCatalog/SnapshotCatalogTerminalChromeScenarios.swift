import AppKit
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
    scenario(
      "selection-statuses",
      group: "Horizontal Tabs",
      title: "Selection and status indicators",
      size: CGSize(width: 1120, height: 58)
    ) { appearance in
      AnyView(
        HorizontalTabStripSnapshotFixture(
          appearance: appearance,
          state: HorizontalTabStripSnapshotContext.selectionAndStatuses
        )
      )
    },
    scenario(
      "expanded-groups",
      group: "Horizontal Tabs",
      title: "Expanded colored group end state",
      size: CGSize(width: 1120, height: 58)
    ) { appearance in
      AnyView(
        HorizontalTabStripSnapshotFixture(
          appearance: appearance,
          state: HorizontalTabStripSnapshotContext.expandedGroups
        )
      )
    },
    scenario(
      "collapsed-groups",
      group: "Horizontal Tabs",
      title: "Collapsed colored group end state",
      size: CGSize(width: 760, height: 58)
    ) { appearance in
      AnyView(
        HorizontalTabStripSnapshotFixture(
          appearance: appearance,
          state: HorizontalTabStripSnapshotContext.collapsedGroups
        )
      )
    },
    scenario(
      "overflow",
      group: "Horizontal Tabs",
      title: "Pinned separator and overflow",
      size: CGSize(width: 520, height: 58)
    ) { appearance in
      AnyView(
        HorizontalTabStripSnapshotFixture(
          appearance: appearance,
          state: HorizontalTabStripSnapshotContext.overflow
        )
      )
    },
  ]
}

private struct HorizontalTabStripSnapshotState {
  let snapshot: TerminalTabSurfaceSnapshot
  let surface: TerminalHorizontalTabSurfacePresentation
}

private struct HorizontalTabStripSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let state: HorizontalTabStripSnapshotState

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    HorizontalTabStripSnapshotBridge(
      appearance: appearance,
      snapshot: state.snapshot,
      surface: state.surface,
      palette: palette
    )
    .frame(height: TerminalHorizontalTabMetrics.height)
    .padding(.horizontal, 8)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(ChromeBackgroundView(palette: palette))
    .environment(\.colorScheme, appearance.colorScheme)
  }
}

private struct HorizontalTabStripSnapshotBridge: NSViewControllerRepresentable {
  let appearance: SnapshotAppearance
  let snapshot: TerminalTabSurfaceSnapshot
  let surface: TerminalHorizontalTabSurfacePresentation
  let palette: Palette

  func makeNSViewController(context: Context) -> TerminalHorizontalTabStripController {
    TerminalHorizontalTabStripController(
      windowControllerID: SnapshotFixtureValues.uuid(
        "64000000-0000-0000-0000-000000000001"
      ),
      tabDragRegistry: TerminalTabDragRegistry(),
      captureRequest: { nil }
    )
  }

  func updateNSViewController(
    _ controller: TerminalHorizontalTabStripController,
    context: Context
  ) {
    controller.view.appearance = NSAppearance(
      named: appearance == .light ? .aqua : .darkAqua
    )
    controller.apply(
      snapshot: snapshot,
      surfacePresentation: surface,
      palette: palette,
      reduceMotion: true,
      actions: TerminalHorizontalTabStripController.Actions(
        closeTab: { _ in },
        newTab: {},
        selectTab: { _ in },
        toggleGroup: { _ in },
        performDrop: { _ in nil }
      )
    )
  }

  static func dismantleNSViewController(
    _ controller: TerminalHorizontalTabStripController,
    coordinator: Void
  ) {
    controller.cancelInteractions()
  }
}

@MainActor
private enum HorizontalTabStripSnapshotContext {
  static var selectionAndStatuses: HorizontalTabStripSnapshotState {
    let pinned = tab(1, title: "Pinned docs")
    let selected = tab(2, title: "Release", isTitleLocked: true)
    let attention = tab(3, title: "Tests")
    let dirty = tab(4, title: "Editor", isDirty: true)
    let working = tab(5, title: "Review")
    let needsInput = tab(6, title: "Deploy")
    return state(
      rootItems: [
        rootTab(pinned, isPinned: true),
        rootTab(selected),
        rootTab(attention),
        rootTab(dirty),
        rootTab(working),
        rootTab(needsInput),
      ],
      selectedTabID: selected.id,
      presentations: [
        pinned.id: presentation(1, title: "docs"),
        selected.id: presentation(
          2,
          title: "swift build --configuration release",
          progress: TerminalTabProgress(fraction: 0.64, tone: .active)
        ),
        attention.id: presentation(3, title: "swift test", indicator: .attention),
        dirty.id: presentation(4, title: "Package.swift"),
        working.id: presentation(5, title: "Code review", indicator: .agent(.working)),
        needsInput.id: presentation(
          6,
          title: "Release approval",
          indicator: .agent(.needsInput)
        ),
      ]
    )
  }

  static var expandedGroups: HorizontalTabStripSnapshotState {
    let selected = tab(11, title: "Dashboard")
    let productTests = tab(12, title: "Product tests")
    let logs = tab(13, title: "Logs")
    let deploy = tab(14, title: "Deploy")
    let product = group(1, title: "Product", color: .blue, tabs: [selected, productTests])
    let operations = group(2, title: "Operations", color: .orange, tabs: [logs, deploy])
    return state(
      rootItems: [.group(product), .group(operations)],
      selectedTabID: selected.id,
      presentations: [
        selected.id: presentation(11, title: "Dashboard"),
        productTests.id: presentation(
          12,
          title: "swift test",
          progress: TerminalTabProgress(fraction: 1, tone: .paused)
        ),
        logs.id: presentation(13, title: "Production logs", indicator: .attention),
        deploy.id: presentation(14, title: "Deploy agent", indicator: .agent(.done)),
      ]
    )
  }

  static var collapsedGroups: HorizontalTabStripSnapshotState {
    let selected = tab(21, title: "Overview")
    let designTab = tab(22, title: "Design")
    let backendTab = tab(23, title: "Backend")
    let releaseTab = tab(24, title: "Release")
    let design = group(3, title: "Design", color: .purple, tabs: [designTab])
    let backend = group(4, title: "Backend", color: .green, tabs: [backendTab])
    let release = group(5, title: "Release", color: .red, tabs: [releaseTab])
    return state(
      rootItems: [.group(design), .group(backend), .group(release), rootTab(selected)],
      selectedTabID: selected.id,
      collapsedGroupIDs: [design.id, backend.id, release.id],
      presentations: [
        selected.id: presentation(21, title: "Overview"),
        designTab.id: presentation(22, title: "Design"),
        backendTab.id: presentation(23, title: "Backend", indicator: .attention),
        releaseTab.id: presentation(24, title: "Release"),
      ]
    )
  }

  static var overflow: HorizontalTabStripSnapshotState {
    let pinned = tab(31, title: "Pinned")
    let tabs = (32...38).map { tab($0, title: "Workspace \($0 - 31)") }
    return state(
      rootItems: [rootTab(pinned, isPinned: true)] + tabs.map { rootTab($0) },
      selectedTabID: tabs[2].id,
      presentations: Dictionary(
        uniqueKeysWithValues: ([pinned] + tabs).enumerated().map { index, item in
          (item.id, presentation(index + 31, title: item.title))
        }
      )
    )
  }

  private static func state(
    rootItems: [TerminalTabRootItem],
    selectedTabID: TerminalTabID,
    collapsedGroupIDs: Set<TerminalTabGroupID> = [],
    presentations: [TerminalTabID: TerminalTabChromePresentation]
  ) -> HorizontalTabStripSnapshotState {
    HorizontalTabStripSnapshotState(
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSpaceID(
          rawValue: SnapshotFixtureValues.uuid("62000000-0000-0000-0000-000000000001")
        ),
        collection: TerminalTabCollectionSnapshot(
          rootItems: rootItems,
          selectedTabID: selectedTabID,
          topologyRevision: 1
        ),
        collapsedGroupIDs: collapsedGroupIDs
      ),
      surface: TerminalHorizontalTabSurfacePresentation(
        tabsByID: presentations,
        groupIconURLs: [:]
      )
    )
  }

  private static func tab(
    _ index: Int,
    title: String,
    isDirty: Bool = false,
    isTitleLocked: Bool = false
  ) -> TerminalTabItem {
    TerminalTabItem(
      id: TerminalTabID(rawValue: fixtureUUID(prefix: "60000000", index: index)),
      title: title,
      isDirty: isDirty,
      isTitleLocked: isTitleLocked
    )
  }

  private static func rootTab(
    _ tab: TerminalTabItem,
    isPinned: Bool = false
  ) -> TerminalTabRootItem {
    .tab(TerminalUngroupedTabItem(tab: tab, isPinned: isPinned))
  }

  private static func group(
    _ index: Int,
    title: String,
    color: ThemeTint,
    tabs: [TerminalTabItem]
  ) -> TerminalTabGroupItem {
    TerminalTabGroupItem(
      id: TerminalTabGroupID(rawValue: fixtureUUID(prefix: "61000000", index: index)),
      title: title,
      color: color,
      isPinned: false,
      tabs: tabs
    )
  }

  private static func presentation(
    _ index: Int,
    title: String,
    indicator: TerminalTabPanePresentation.Indicator? = nil,
    progress: TerminalTabProgress? = nil
  ) -> TerminalTabChromePresentation {
    TerminalTabChromePresentation(
      panes: [
        TerminalTabPanePresentation(
          id: fixtureUUID(prefix: "63000000", index: index),
          title: title,
          indicator: indicator,
          isFocused: true
        )
      ],
      progress: progress
    )
  }

  private static func fixtureUUID(prefix: String, index: Int) -> UUID {
    SnapshotFixtureValues.uuid(
      "\(prefix)-0000-0000-0000-\(String(format: "%012d", index))"
    )
  }
}

private struct AgentsPopoverSnapshotFixture: View {
  let appearance: SnapshotAppearance

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalAgentsPopoverView(
      items: TerminalHostState.WindowAgentPresentation.snapshotData,
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
  @State private var groupIconStore = TerminalTabGroupIconStore()
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
    HStack(spacing: 0) {
      TerminalSidebarView(
        store: SidebarChromeSnapshotContext.windowStore(),
        licenseStore: SidebarChromeSnapshotContext.licenseStore(),
        updateStore: SidebarChromeSnapshotContext.updateStore(),
        releaseAnnouncement: nil,
        palette: palette,
        terminal: SidebarChromeSnapshotContext.selectedGroupTerminal,
        groupIconStore: groupIconStore,
        isPagingActive: true,
        sidebarControllerCache: sidebarControllerCache,
        shouldPlayTabMoveHaptics: true,
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
  @State private var groupIconStore = TerminalTabGroupIconStore()
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

      TerminalSidebarSurfaceShell(palette: palette, isFloating: true) {
        TerminalSidebarView(
          store: SidebarChromeSnapshotContext.windowStore(),
          licenseStore: SidebarChromeSnapshotContext.licenseStore(),
          updateStore: SidebarChromeSnapshotContext.updateStore(),
          releaseAnnouncement: nil,
          palette: palette,
          terminal: SidebarChromeSnapshotContext.selectedGroupTerminal,
          groupIconStore: groupIconStore,
          isPagingActive: true,
          sidebarControllerCache: sidebarControllerCache,
          shouldPlayTabMoveHaptics: true,
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
