import ComposableArchitecture
import Foundation
import Sharing
import SupaTheme
import SupatermLicenseFeature
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

extension SnapshotCatalog {
  static let sidebarScenarios: [SnapshotScenario] = [
    scenario(
      "full",
      group: "Sidebar",
      title: "Full sidebar chrome",
      size: CGSize(width: 280, height: 560)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: nil
        )
      )
    },
    scenario(
      "full-group-hover",
      group: "Sidebar",
      title: "Full sidebar group hover",
      size: CGSize(width: 280, height: 560)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: SidebarChromeSnapshotContext.groupID
        )
      )
    },
    scenario(
      "overflow",
      group: "Sidebar",
      title: "Overflowing sidebar",
      size: CGSize(width: 280, height: 300)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: nil
        )
      )
    },
    scenario(
      "selected-before-new-tab",
      group: "Sidebar",
      title: "Selected tab before new tab",
      size: CGSize(width: 280, height: 220)
    ) { appearance in
      AnyView(
        SidebarChromeSnapshotFixture(
          appearance: appearance,
          fixedHoveredGroupID: nil,
          terminal: SidebarChromeSnapshotContext.selectedBeforeNewTabTerminal
        )
      )
    },
    scenario(
      "space-dots",
      group: "Sidebar",
      title: "Space page dots",
      size: CGSize(width: 280, height: 44)
    ) { appearance in
      AnyView(SpacePageDotsSnapshotFixture(appearance: appearance))
    },
    scenario(
      "space-dots-paging",
      group: "Sidebar",
      title: "Space page dots mid swipe",
      size: CGSize(width: 280, height: 44)
    ) { appearance in
      AnyView(SpacePageDotsSnapshotFixture(appearance: appearance, position: 1.4))
    },
    scenario(
      "window-controls",
      group: "Sidebar",
      title: "Window controls above selected tab",
      size: CGSize(width: 280, height: 160)
    ) { appearance in
      AnyView(
        SidebarWindowControlsSnapshotFixture(appearance: appearance)
      )
    },
    scenario(
      "window-controls-group",
      group: "Sidebar",
      title: "Window controls above selected group",
      size: CGSize(width: 560, height: 220)
    ) { appearance in
      AnyView(
        SidebarWindowControlsSnapshotFixture(
          appearance: appearance,
          terminal: SidebarChromeSnapshotContext.selectedGroupTerminal
        )
      )
    },
    scenario(
      "rest",
      group: "Sidebar Rows",
      title: "Resting shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000008",
            title: "supaterm - fish",
            paneTitles: ["fish"]
          )
        )
      )
    },
    scenario(
      "basic-selected",
      group: "Sidebar Rows",
      title: "Selected shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000001",
            title: "supaterm - fish",
            selection: .primary,
            isTitleLocked: true,
            paneTitles: ["fish"]
          )
        )
      )
    },
    scenario(
      "pinned-hover",
      group: "Sidebar Rows",
      title: "Pinned hover shortcut",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000002",
            title: "release-check",
            isPinned: true,
            isRowHovering: true,
            paneTitles: ["release-check"],
            shortcutHint: "⌘2",
            showsShortcutHint: true
          )
        )
      )
    },
    scenario(
      "agent-running-hover",
      group: "Sidebar Rows",
      title: "Hovered running coding agent",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000013",
            title: "Codex",
            isRowHovering: true,
            paneTitles: ["khoi/routine-ui"],
            paneAgentStatuses: [.working]
          )
        )
      )
    },
    scenario(
      "two-panes-hover",
      group: "Sidebar Rows",
      title: "Hovered tab with two panes",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000014",
            title: "Review authentication",
            isRowHovering: true,
            paneTitles: ["Codex auth", "swift test"],
            paneAgentStatuses: [.working, nil],
            paneHasAttention: [false, true]
          )
        )
      )
    },
    scenario(
      "secondary-selection",
      group: "Sidebar Rows",
      title: "Secondary selected shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000007",
            title: "supaterm - fish",
            selection: .secondary,
            paneTitles: ["fish"]
          )
        )
      )
    },
    scenario(
      "pressed",
      group: "Sidebar Rows",
      title: "Pressed shell tab",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000009",
            title: "supaterm - fish",
            isPressed: true,
            paneTitles: ["fish"]
          )
        )
      )
    },
    scenario(
      "unread-text",
      group: "Sidebar Rows",
      title: "Pane attention bells",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000003",
            title: "Build failures",
            paneTitles: [
              "swift build",
              "swift test",
            ],
            paneHasAttention: [true, true]
          )
        )
      )
    },
    scenario(
      "agent-attention-priority",
      group: "Sidebar Rows",
      title: "Agent state hides same-pane attention",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000012",
            title: "Agent and shell attention",
            paneTitles: ["Codex", "swift test"],
            paneAgentStatuses: [.working, nil],
            paneHasAttention: [true, true]
          )
        )
      )
    },
    scenario(
      "agent-running",
      group: "Sidebar Rows",
      title: "Running coding agent",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentRunning
        )
      )
    },
    scenario(
      "agent-running-narrow",
      group: "Sidebar Rows",
      title: "Running coding agent, narrow",
      size: CGSize(width: 220, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentRunning
        )
      )
    },
    scenario(
      "agent-running-multiple",
      group: "Sidebar Rows",
      title: "Running coding agents on two branches",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentRunningMultiple
        )
      )
    },
    scenario(
      "agent-six-panes",
      group: "Sidebar Rows",
      title: "Six coding agent panes",
      size: CGSize(width: 320, height: 170)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .sixAgents
        )
      )
    },
    scenario(
      "agent-needs-input",
      group: "Sidebar Rows",
      title: "Agent needs input",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentNeedsInput
        )
      )
    },
    scenario(
      "agent-needs-input-narrow",
      group: "Sidebar Rows",
      title: "Agent needs input, narrow",
      size: CGSize(width: 220, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentNeedsInput
        )
      )
    },
    scenario(
      "agent-done",
      group: "Sidebar Rows",
      title: "Agent done",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentDone
        )
      )
    },
    scenario(
      "agent-done-narrow",
      group: "Sidebar Rows",
      title: "Agent done, narrow",
      size: CGSize(width: 220, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: .agentDone
        )
      )
    },
    scenario(
      "progress-paused",
      group: "Sidebar Rows",
      title: "Paused terminal progress",
      size: CGSize(width: 320, height: 72)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000007",
            title: "Archive export",
            paneTitles: ["tar -czf release.tar.gz"],
            terminalProgress: TerminalSidebarTerminalProgress(fraction: 0.68, tone: .paused)
          )
        )
      )
    },
    scenario(
      "long-path-title",
      group: "Sidebar Rows",
      title: "Long path title",
      size: CGSize(width: 320, height: 94)
    ) { appearance in
      AnyView(
        SidebarRowSnapshotFixture(
          appearance: appearance,
          item: SidebarRowSnapshotItem(
            id: "10000000-0000-0000-0000-000000000008",
            title: SnapshotFixtureValues.workspace("apps/mac/supaterm/SnapshotCatalog"),
            paneTitles: [
              SnapshotFixtureValues.workspace("apps/mac/supaterm/SnapshotCatalog"),
              "swift run SnapshotCatalog",
            ],
            paneHasAttention: [false, true]
          )
        )
      )
    },
  ]
}

private struct SidebarRowSnapshotItem {
  let id: String
  let title: String
  var selection: SelectableRowSelection = .none
  var isPinned = false
  var isRowHovering = false
  var isPressed = false
  var isTitleLocked = false
  var paneTitles: [String] = []
  var paneAgentStatuses: [TerminalHostState.TabAgentStatus?] = []
  var paneHasAttention: [Bool] = []
  var terminalProgress: TerminalSidebarTerminalProgress?
  var shortcutHint: String?
  var showsShortcutHint = false

  var tab: TerminalTabItem {
    TerminalTabItem(
      id: TerminalTabID(rawValue: SnapshotFixtureValues.uuid(id)),
      title: title,
      isTitleLocked: isTitleLocked
    )
  }

  var isSelected: Bool { selection != .none }

  var panes: [TerminalSidebarPanePresentation] {
    paneTitles.enumerated().map { index, title in
      let agentStatus = paneAgentStatuses.indices.contains(index) ? paneAgentStatuses[index] : nil
      let hasAttention = paneHasAttention.indices.contains(index) && paneHasAttention[index]
      return TerminalSidebarPanePresentation(
        id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012X", index + 1))!,
        title: title,
        indicator: agentStatus.map(TerminalSidebarPanePresentation.Indicator.agent)
          ?? (hasAttention ? .attention : nil)
      )
    }
  }

  static var agentRunning: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000004",
      title: "Codex",
      paneTitles: ["khoi/routine-ui-what-happened | Thinking | Tasks 5/5"],
      paneAgentStatuses: [.working]
    )
  }

  static var agentRunningMultiple: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000010",
      title: "Review authentication",
      paneTitles: ["Codex auth", "Review token expiry"],
      paneAgentStatuses: [.working, .done]
    )
  }

  static var sixAgents: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000011",
      title: "Coding agents",
      paneTitles: ["Codex 1", "Codex 2", "Codex 3", "Review 1", "Review 2", "Review 3"],
      paneAgentStatuses: [.working, .done, .needsInput, .working, .done, .needsInput]
    )
  }

  static var agentNeedsInput: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000005",
      title: "Release note pass",
      paneTitles: ["Review agent"],
      paneAgentStatuses: [.needsInput]
    )
  }

  static var agentDone: Self {
    SidebarRowSnapshotItem(
      id: "10000000-0000-0000-0000-000000000006",
      title: "Docs audit",
      paneTitles: ["Codex"],
      paneAgentStatuses: [.done]
    )
  }
}

private struct SidebarRowSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let item: SidebarRowSnapshotItem
  var outerPadding: CGFloat = 10

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    let closeButtonPlacement = TerminalSidebarTabCloseButton.Placement(
      lineCount: TerminalSidebarTabSummaryView.visibleLineCount(tab: item.tab, panes: item.panes)
    )
    TerminalSidebarTabSummaryView(
      tab: item.tab,
      palette: palette,
      isSelected: item.isSelected,
      isPinned: item.isPinned,
      panes: item.panes,
      terminalProgress: item.terminalProgress,
      shortcutHint: item.shortcutHint,
      showsShortcutHint: item.showsShortcutHint,
      isRowHovering: item.isRowHovering
    )
    .lineLimit(10)
    .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      rowAppearance.fill(
        selection: item.selection,
        isPressed: item.isPressed,
        isHovering: item.isRowHovering
      )
    )
    .modifier(
      SelectableRowChrome(
        selection: item.selection,
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        appearance: rowAppearance,
        showsSelectionEdge: true
      )
    )
    .overlay(alignment: closeButtonPlacement.alignment) {
      if item.isRowHovering {
        TerminalSidebarTabCloseButton(
          palette: palette,
          isSelected: item.isSelected,
          placement: closeButtonPlacement,
          action: {}
        )
      }
    }
    .padding(outerPadding)
    .background(palette.detailBackground)
  }

  private var rowAppearance: SelectableRowStyle.ResolvedAppearance {
    SelectableRowStyle.Appearance.sidebar.resolve(palette: palette)
  }
}

@MainActor
enum SidebarChromeSnapshotContext {
  static let commandHold = CommandHoldObserver()
  static let ghosttyShortcuts = GhosttyShortcutManager(runtime: nil)
  static let groupID = TerminalTabGroupID(
    rawValue: SnapshotFixtureValues.uuid("50000000-0000-0000-0000-000000000001")
  )
  static let regularGroupID = TerminalTabGroupID(
    rawValue: SnapshotFixtureValues.uuid("50000000-0000-0000-0000-000000000002")
  )

  static let terminal: TerminalHostState = {
    let spaces = ["supaterm", "research", "ops"].enumerated().map { index, name in
      TerminalSpaceItem(
        id: TerminalSpaceID(
          rawValue: SnapshotFixtureValues.uuid("30000000-0000-0000-0000-00000000000\(index + 1)")
        ),
        name: name
      )
    }
    let terminal = makeTerminal(space: spaces[0], spaces: spaces)
    let regularGroupTab = tab("43", title: "supaterm - fish")
    let selectedGroupTab = tab("44", title: "release-check")
    let rootItems = [
      rootTab("41", title: "dotfiles", isPinned: true),
      rootTab("42", title: "notes", isPinned: true),
      TerminalTabRootItem.group(
        TerminalTabGroupItem(
          id: groupID,
          title: "Release",
          color: .neutral,
          isPinned: true,
          tabs: [
            selectedGroupTab,
            tab("45", title: "agent playground"),
          ]
        )
      ),
      TerminalTabRootItem.group(
        TerminalTabGroupItem(
          id: regularGroupID,
          title: "Product",
          color: .red,
          isPinned: false,
          tabs: [regularGroupTab]
        )
      ),
    ]
    terminal.spaceManager.restoreRootItems(
      rootItems,
      selectedTabID: selectedGroupTab.id,
      in: spaces[0].id
    )
    return terminal
  }()

  static let selectedBeforeNewTabTerminal: TerminalHostState = {
    let space = TerminalSpaceItem(
      id: TerminalSpaceID(
        rawValue: SnapshotFixtureValues.uuid("30000000-0000-0000-0000-000000000004")
      ),
      name: "supaterm"
    )
    let terminal = makeTerminal(space: space, spaces: [space])
    let selectedTab = tab("46", title: "Home / X")
    terminal.spaceManager.restoreRootItems(
      [
        .tab(
          TerminalUngroupedTabItem(
            tab: selectedTab,
            isPinned: false
          )
        )
      ],
      selectedTabID: selectedTab.id,
      in: space.id
    )
    return terminal
  }()

  static let selectedGroupTerminal: TerminalHostState = {
    let space = TerminalSpaceItem(
      id: TerminalSpaceID(
        rawValue: SnapshotFixtureValues.uuid("30000000-0000-0000-0000-000000000005")
      ),
      name: "supaterm",
      color: .green
    )
    let terminal = makeTerminal(space: space, spaces: [space])
    let selectedTab = tab("47", title: "/Users/Developer/code/github.com/supabitapp/supaterm")
    terminal.spaceManager.restoreRootItems(
      [
        .group(
          TerminalTabGroupItem(
            id: TerminalTabGroupID(
              rawValue: SnapshotFixtureValues.uuid("50000000-0000-0000-0000-000000000003")
            ),
            title: "🎨 Supaterm",
            color: .yellow,
            isPinned: false,
            tabs: [selectedTab]
          )
        )
      ],
      selectedTabID: selectedTab.id,
      in: space.id
    )
    terminal.trees[selectedTab.id] = SplitTree(root: nil, zoomed: nil)
    return terminal
  }()

  static let spacePageDotSpaces: [TerminalSpaceItem] = {
    let colors: [ThemeTint] = [.blue, .green, .orange, .purple]
    return ["supaterm", "research", "ops", "docs"].enumerated().map { index, name in
      TerminalSpaceItem(
        id: TerminalSpaceID(
          rawValue: SnapshotFixtureValues.uuid("30000000-0000-0000-0000-00000000001\(index)")
        ),
        name: name,
        color: colors[index]
      )
    }
  }()

  static func windowStore() -> StoreOf<TerminalWindowFeature> {
    Store(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }
  }

  static func licenseStore() -> StoreOf<LicenseFeature> {
    let runtime = LicenseRuntime.preview()
    return Store(initialState: LicenseFeature.State(runtime: runtime)) {
      LicenseFeature(runtime: runtime)
    }
  }

  private static func makeTerminal(
    space: TerminalSpaceItem,
    spaces: [TerminalSpaceItem]
  ) -> TerminalHostState {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: spaces)
      }
      return TerminalHostState.test(managesTerminalSurfaces: false, spaceID: space.id)
    }
  }

  static func updateStore() -> StoreOf<UpdateFeature> {
    Store(
      initialState: UpdateFeature.State(canCheckForUpdates: true, phase: .idle)
    ) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient = .testValue
    }
  }

  private static func rootTab(
    _ id: String,
    title: String,
    isPinned: Bool = false
  ) -> TerminalTabRootItem {
    .tab(
      TerminalUngroupedTabItem(
        tab: tab(id, title: title),
        isPinned: isPinned
      )
    )
  }

  private static func tab(
    _ id: String,
    title: String
  ) -> TerminalTabItem {
    TerminalTabItem(
      id: TerminalTabID(
        rawValue: SnapshotFixtureValues.uuid("40000000-0000-0000-0000-0000000000\(id)")
      ),
      title: title
    )
  }
}

private struct SpacePageDotsSnapshotFixture: View {
  let appearance: SnapshotAppearance
  var position: Double?

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalNativeSpaceDots(
      configuration: TerminalNativeSpaceDotsConfiguration(
        palette: palette,
        spaces: SidebarChromeSnapshotContext.spacePageDotSpaces,
        selectionPosition: position ?? 1,
        select: { _ in },
        edit: { _ in },
        delete: { _ in },
        newTab: { _ in },
        reorder: { _, _ in },
        dropTab: { _, _ in false }
      )
    )
    .fixedSize()
    .frame(maxWidth: .infinity)
    .padding(.leading, TerminalSidebarLayout.cardHorizontalInsets.leading)
    .padding(.trailing, TerminalSidebarLayout.cardHorizontalInsets.trailing)
    .frame(maxHeight: .infinity)
    .background(palette.windowBackgroundTint)
    .background(palette.detailBackground)
  }
}

private struct SidebarChromeSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let fixedHoveredGroupID: TerminalTabGroupID?
  var terminal = SidebarChromeSnapshotContext.terminal
  @State private var sidebarControllerCache = TerminalSidebarControllerCache(
    windowControllerID: UUID(),
    tabDragRegistry: TerminalTabDragRegistry(),
    captureRequest: { nil }
  )

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalSidebarChromeView(
      store: SidebarChromeSnapshotContext.windowStore(),
      licenseStore: SidebarChromeSnapshotContext.licenseStore(),
      updateStore: SidebarChromeSnapshotContext.updateStore(),
      releaseAnnouncement: nil,
      palette: palette,
      terminal: terminal,
      isPagingActive: false,
      sidebarControllerCache: sidebarControllerCache,
      fixedHoveredGroupID: fixedHoveredGroupID,
      shouldPlayTabMoveHaptics: true,
      dismissReleaseAnnouncement: {}
    )
    .environment(SidebarChromeSnapshotContext.commandHold)
    .environment(SidebarChromeSnapshotContext.ghosttyShortcuts)
    .padding(.bottom, 8)
    .background(palette.windowBackgroundTint)
    .background(palette.detailBackground)
  }
}

private struct SidebarWindowControlsSnapshotFixture: View {
  let appearance: SnapshotAppearance
  var terminal = SidebarChromeSnapshotContext.selectedBeforeNewTabTerminal
  @State private var sidebarControllerCache = TerminalSidebarControllerCache(
    windowControllerID: UUID(),
    tabDragRegistry: TerminalTabDragRegistry(),
    captureRequest: { nil }
  )

  private var palette: Palette {
    Palette(colorScheme: appearance.colorScheme)
  }

  var body: some View {
    TerminalSidebarView(
      store: SidebarChromeSnapshotContext.windowStore(),
      licenseStore: SidebarChromeSnapshotContext.licenseStore(),
      updateStore: SidebarChromeSnapshotContext.updateStore(),
      releaseAnnouncement: nil,
      palette: palette,
      terminal: terminal,
      isPagingActive: false,
      sidebarControllerCache: sidebarControllerCache,
      shouldPlayTabMoveHaptics: true,
      dismissReleaseAnnouncement: {}
    )
    .environment(SidebarChromeSnapshotContext.commandHold)
    .environment(SidebarChromeSnapshotContext.ghosttyShortcuts)
    .background(palette.windowBackgroundTint)
    .background(palette.detailBackground)
  }
}
