import ComposableArchitecture
import Foundation
import Sharing
import SupaTheme
import SupatermLicenseFeature
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

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

  static func updateStore(phase: UpdatePhase = .idle) -> StoreOf<UpdateFeature> {
    Store(
      initialState: UpdateFeature.State(canCheckForUpdates: true, phase: phase)
    ) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient = .testValue
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

struct SpacePageDotsSnapshotFixture: View {
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

struct SidebarChromeSnapshotFixture: View {
  let appearance: SnapshotAppearance
  let fixedHoveredGroupID: TerminalTabGroupID?
  var terminal = SidebarChromeSnapshotContext.terminal
  var updatePhase: UpdatePhase = .idle
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
      updateStore: SidebarChromeSnapshotContext.updateStore(phase: updatePhase),
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

struct SidebarWindowControlsSnapshotFixture: View {
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
