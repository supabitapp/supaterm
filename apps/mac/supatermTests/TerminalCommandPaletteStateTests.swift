import Foundation
import SupatermUpdateFeature
import Testing

@testable import supaterm

struct TerminalCommandPaletteStateTests {
  @Test
  func rowsBuildFromUpdatesFocusTargetsAndWindowContext() {
    let snapshot = makeSnapshot()
    let focusTarget = snapshot.focusTargets[1]
    let focusRowID = "focus:\(focusTarget.windowControllerID.uuidString):\(focusTarget.surfaceID.uuidString)"

    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)

    #expect(rows.first?.id == "update:\(snapshot.updateEntries[0].id)")
    #expect(rows.last?.id == "app:open-settings")
    #expect(rows.contains(where: { $0.id == focusRowID }))
    #expect(
      rows.contains(where: {
        $0.id == "terminal:split-right" && $0.shortcut == "⌘D"
      })
    )
    #expect(rows.allSatisfy { $0.leadingIcon != nil })
    #expect(!rows.contains(where: { $0.title == "New Tab" || $0.title == "New Window" }))
  }

  @Test
  func rowsUseSemanticPriority() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())

    #expect(
      rows.map(\.title) == [
        "Install and Relaunch",
        "Jump to Latest Unread",
        "Open Pull Request",
        "Fork Agent Session",
        "Copy Agent Session ID",
        "Toggle Agent Panel",
        "Workspace Beta",
        "Logs",
        "server.log",
        "Split Pane Right",
        "Split Pane Down",
        "Move Pane to a New Tab",
        "Zoom Pane",
        "Equalize Panes",
        "Pin Tab",
        "Edit Space",
        "Rename Tab",
        "Rename Pane",
        "Create Space",
        "Find in Terminal",
        "Clear Screen",
        "Clear Screen and Scrollback",
        "Close Other Tabs",
        "Close Pane",
        "Close Tab",
        "Toggle Sidebar",
        "Open Settings",
      ]
    )
  }

  @Test
  func rowsRouteClearScreenActionsSeparately() throws {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())
    let clearScreen = try #require(rows.first { $0.id == "terminal:clear-screen" })
    let clearScrollback = try #require(
      rows.first { $0.id == "terminal:clear-screen-and-scrollback" }
    )

    #expect(clearScreen.title == "Clear Screen")
    #expect(clearScreen.description == "Clear the screen without deleting scrollback.")
    #expect(clearScreen.command == .clearScreen)
    #expect(clearScrollback.title == "Clear Screen and Scrollback")
    #expect(clearScrollback.description == "Clear the screen and delete scrollback.")
    #expect(
      clearScrollback.command
        == .ghosttyBindingAction(TerminalCommandPalettePresentation.clearScreenAction)
    )
  }

  @Test
  func rowsShowUnpinForSelectedPinnedTab() {
    let snapshot = makeSnapshot(selectedTabIsPinned: true)

    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)
    let row = rows.first(where: {
      $0.id == "supaterm:toggle-pinned:\(snapshot.visibleTabs[0].id.rawValue.uuidString)"
    })

    #expect(row?.title == "Unpin Tab")
    #expect(row?.command == .togglePinned(snapshot.visibleTabs[0].id))
  }

  @Test
  func rowsHideMovePaneWhenSelectedTabIsNotSplit() {
    let source = makeSnapshot()
    let snapshot = TerminalCommandPaletteSnapshot(
      availableAppActions: source.availableAppActions,
      ghosttyShortcutDisplayByAction: source.ghosttyShortcutDisplayByAction,
      updateEntries: source.updateEntries,
      focusTargets: source.focusTargets,
      selectedSurfaceID: source.selectedSurfaceID,
      selectedTabPaneCount: 1,
      selectedPaneIsZoomed: source.selectedPaneIsZoomed,
      selectedSpaceID: source.selectedSpaceID,
      spaces: source.spaces,
      selectedTabID: source.selectedTabID,
      rootItems: source.rootItems
    )

    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)

    #expect(!rows.contains { $0.id == "terminal:move-pane-to-new-tab" })
  }

  @Test
  func whitespaceOnlyQueryReturnsEveryRowWithoutHighlights() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())

    let matches = TerminalCommandPalettePresentation.matches(
      in: rows,
      query: " \n\t "
    )

    #expect(matches.map(\.row) == rows)
    #expect(matches.map(\.matchedCharacters) == Array(repeating: [], count: matches.count))
  }

  @Test
  func queryIgnoresCase() {
    let matches = TerminalCommandPalettePresentation.matches(
      in: TerminalCommandPalettePresentation.rows(from: makeSnapshot()),
      query: "sPlIt pAnE rIgHt"
    )

    #expect(matches.map(\.row.command) == [.ghosttyBindingAction("new_split:right")])
  }

  @Test
  func queryTrimsOuterWhitespace() {
    let matches = TerminalCommandPalettePresentation.matches(
      in: TerminalCommandPalettePresentation.rows(from: makeSnapshot()),
      query: "  split pane right\n"
    )

    #expect(matches.map(\.row.command) == [.ghosttyBindingAction("new_split:right")])
  }

  @Test
  func exactMatchHighlightsEveryCharacter() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [makeRow(id: "split", title: "Split Right")],
      query: "Split Right"
    ).first

    #expect(match?.matchedCharacters == (0...10).map(TerminalCommandPaletteMatch.MatchedCharacter.title))
  }

  @Test
  func substringMatchHighlightsOnlyTheSubstring() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [makeRow(id: "split", title: "Split Right")],
      query: "lit Ri"
    ).first

    #expect(match?.matchedCharacters == (2...7).map(TerminalCommandPaletteMatch.MatchedCharacter.title))
  }

  @Test
  func subtitleMatchHighlightsSubtitleCharacters() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [makeRow(id: "config", title: "Open", subtitle: "Config File")],
      query: "config"
    ).first

    #expect(match?.matchedCharacters == (0...5).map(TerminalCommandPaletteMatch.MatchedCharacter.subtitle))
  }

  @Test
  func descriptionMatchHighlightsDisplayedDescription() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [
        makeRow(
          id: "config",
          title: "Open",
          description: "Open the configuration file."
        )
      ],
      query: "configuration"
    ).first

    #expect(
      match?.matchedCharacters == (9...21).map(TerminalCommandPaletteMatch.MatchedCharacter.description)
    )
    #expect(match?.displaySubtitle == "Open the configuration file.")
    #expect(match?.displaySubtitleMatchedCharacterOffsets == Array(9...21))
  }

  @Test
  func explicitSubtitleTakesDisplayPriorityOverDescription() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [
        makeRow(
          id: "config",
          title: "Open",
          subtitle: "Configuration",
          description: "Open the configuration file."
        )
      ],
      query: "open"
    ).first

    #expect(match?.displaySubtitle == "Configuration")
    #expect(match?.displaySubtitleMatchedCharacterOffsets == [])
  }

  @Test
  func descriptionMatchDisplaysAndHighlightsDescriptionInsteadOfSubtitle() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [
        makeRow(
          id: "config",
          title: "Open",
          subtitle: "Configuration",
          description: "Open the preferences file."
        )
      ],
      query: "preferences"
    ).first

    #expect(match?.displaySubtitle == "Open the preferences file.")
    #expect(match?.displaySubtitleMatchedCharacterOffsets == Array(9...19))
  }

  @Test
  func substringMatchCanSpanTitleAndSubtitle() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [makeRow(id: "config", title: "Open", subtitle: "Config")],
      query: "open config"
    ).first

    #expect(
      match?.matchedCharacters == (0...3).map(TerminalCommandPaletteMatch.MatchedCharacter.title)
        + (0...5).map(TerminalCommandPaletteMatch.MatchedCharacter.subtitle)
    )
  }

  @Test
  func wordInitialMatchFindsSplitPaneRight() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [makeRow(id: "split-right", title: "Split Pane Right")],
      query: "spr"
    ).first

    #expect(match?.row.title == "Split Pane Right")
    #expect(match?.matchedCharacters == [.title(0), .title(6), .title(11)])
  }

  @Test
  func matchingPreservesSourceOrdering() {
    let rows = [
      makeRow(id: "substring", title: "Walk"),
      makeRow(id: "initials", title: "Able Landing"),
      makeRow(id: "exact", title: "AL"),
    ]

    let matches = TerminalCommandPalettePresentation.matches(in: rows, query: "al")

    #expect(matches.map(\.id) == ["substring", "initials", "exact"])
  }

  @Test
  func matchingRanksTitleAboveSubtitleAboveDescription() {
    let rows = [
      makeRow(
        id: "description",
        title: "Execute",
        subtitle: "Actions",
        description: "Open Settings"
      ),
      makeRow(
        id: "subtitle",
        title: "Execute",
        subtitle: "Open Settings",
        description: "Manage preferences"
      ),
      makeRow(
        id: "title",
        title: "Open Settings",
        subtitle: "Actions",
        description: "Manage preferences"
      ),
    ]

    let matches = TerminalCommandPalettePresentation.matches(in: rows, query: "open settings")

    #expect(matches.map(\.id) == ["title", "subtitle", "description"])
  }

  @Test
  func matchingRanksTitleAndDescriptionBelowFullSubtitle() {
    let rows = [
      makeRow(
        id: "title-description",
        title: "Open",
        description: "Settings"
      ),
      makeRow(
        id: "subtitle",
        title: "Execute",
        subtitle: "Open Settings"
      ),
    ]

    let matches = TerminalCommandPalettePresentation.matches(in: rows, query: "open settings")

    #expect(matches.map(\.id) == ["subtitle", "title-description"])
  }

  @Test
  func unmatchedQueryReturnsNoRows() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())

    let matches = TerminalCommandPalettePresentation.matches(
      in: rows,
      query: "missing"
    )

    #expect(matches.isEmpty)
  }

  @Test
  func normalizedSelectionFallsBackToFirstVisibleRow() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())
    let matches = TerminalCommandPalettePresentation.matches(
      in: rows,
      query: "switch"
    )

    let selectedRowID = TerminalCommandPalettePresentation.normalizedSelection(
      "missing",
      in: matches
    )

    #expect(selectedRowID == matches.first?.id)
  }

  @Test
  func movedSelectionWrapsWithinFilteredRows() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())
    let matches = TerminalCommandPalettePresentation.matches(
      in: rows,
      query: "switch"
    )

    let wrappedBackward = TerminalCommandPalettePresentation.movedSelection(
      matches.first?.id,
      by: -1,
      in: matches
    )
    let wrappedForward = TerminalCommandPalettePresentation.movedSelection(
      matches.last?.id,
      by: 1,
      in: matches
    )

    #expect(wrappedBackward == matches.last?.id)
    #expect(wrappedForward == matches.first?.id)
  }

  @Test
  func rowForSlotUsesFilteredOrdering() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())
    let matches = TerminalCommandPalettePresentation.matches(
      in: rows,
      query: "switch"
    )

    let row = TerminalCommandPalettePresentation.rowForSlot(1, in: matches)

    #expect(row?.id == matches[0].id)
    #expect(row?.command == .selectSpace(makeSnapshot().spaces[1].id))
  }

  private func makeRow(
    id: String,
    title: String,
    subtitle: String? = nil,
    description: String? = nil
  ) -> TerminalCommandPaletteRow {
    TerminalCommandPaletteRow(
      id: id,
      title: title,
      subtitle: subtitle,
      description: description,
      leadingIcon: nil,
      badge: nil,
      emphasis: false,
      shortcut: nil,
      command: .ghosttyBindingAction(id)
    )
  }

  private var visibleTabs: [TerminalTabItem] = [
    TerminalTabItem(
      id: TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000010")!),
      title: "Main"
    ),
    TerminalTabItem(
      id: TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000011")!),
      title: "Logs"
    ),
  ]

  private func makeSnapshot(selectedTabIsPinned: Bool = false) -> TerminalCommandPaletteSnapshot {
    let selectedSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
    let otherSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
    let visibleTabs = self.visibleTabs

    return TerminalCommandPaletteSnapshot(
      availableAppActions: [
        .copyAgentSessionID,
        .forkAgentSession,
        .jumpToLatestUnread,
        .openPullRequest,
        .openSettings,
        .toggleAgentPanel,
      ],
      ghosttyShortcutDisplayByAction: [
        "new_split:right": "⌘D",
        "open_config": "⌘,",
      ],
      updateEntries: [
        TerminalCommandPaletteUpdateEntry(
          id: "update-available:install",
          title: "Install and Relaunch",
          subtitle: "Update Available",
          description: "Supaterm 1.2.3 is ready to download and install.",
          leadingIcon: "shippingbox.fill",
          badge: "1.2.3",
          emphasis: true,
          action: .install
        )
      ],
      focusTargets: [
        TerminalCommandPaletteFocusTarget(
          windowControllerID: UUID(uuidString: "00000000-0000-0000-0000-000000000201")!,
          surfaceID: UUID(uuidString: "00000000-0000-0000-0000-000000000202")!,
          title: "ping 1.1.1.1",
          subtitle: "~/Projects/network"
        ),
        TerminalCommandPaletteFocusTarget(
          windowControllerID: UUID(uuidString: "00000000-0000-0000-0000-000000000203")!,
          surfaceID: UUID(uuidString: "00000000-0000-0000-0000-000000000204")!,
          title: "server.log",
          subtitle: "/tmp/logs"
        ),
      ],
      selectedSurfaceID: UUID(uuidString: "00000000-0000-0000-0000-000000000202")!,
      selectedTabPaneCount: 2,
      selectedPaneIsZoomed: false,
      selectedSpaceID: selectedSpaceID,
      spaces: [
        TerminalSpaceItem(id: selectedSpaceID, name: "Workspace Alpha"),
        TerminalSpaceItem(id: otherSpaceID, name: "Workspace Beta"),
      ],
      selectedTabID: visibleTabs[0].id,
      rootItems: [
        .tab(
          TerminalUngroupedTabItem(
            tab: visibleTabs[0],
            isPinned: selectedTabIsPinned
          )
        ),
        .tab(TerminalUngroupedTabItem(tab: visibleTabs[1], isPinned: false)),
      ]
    )
  }
}
