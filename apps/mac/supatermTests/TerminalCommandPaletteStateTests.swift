import Foundation
import SupatermUpdateFeature
import Testing

@testable import supaterm

struct TerminalCommandPaletteStateTests {
  @Test
  func rowsBuildFromUpdatesFocusTargetsAndWindowContext() {
    let snapshot = makeSnapshot()
    let focusRowID =
      "focus:\(snapshot.focusTargets[0].windowControllerID.uuidString):\(snapshot.focusTargets[0].surfaceID.uuidString)"

    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)

    #expect(rows.first?.id == "supaterm:create-space")
    #expect(rows.last?.id == "update:\(snapshot.updateEntries[0].id)")
    #expect(rows.contains(where: { $0.id == focusRowID }))
    #expect(
      rows.contains(where: {
        $0.id == "ghostty:new_split:right" && $0.shortcut == "⌘D"
      })
    )
    #expect(rows.contains(where: { $0.command == .submitGitHubIssue }))
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
      query: "sPlIt rIgHt"
    )

    #expect(matches.map(\.row.command) == [.ghosttyBindingAction("new_split:right")])
  }

  @Test
  func queryTrimsOuterWhitespace() {
    let matches = TerminalCommandPalettePresentation.matches(
      in: TerminalCommandPalettePresentation.rows(from: makeSnapshot()),
      query: "  split right\n"
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
  func wordInitialMatchFindsNewTabInWindow() {
    let match = TerminalCommandPalettePresentation.matches(
      in: [makeRow(id: "new-tab", title: "New Tab in Window")],
      query: "ntw"
    ).first

    #expect(match?.row.title == "New Tab in Window")
    #expect(match?.matchedCharacters == [.title(0), .title(4), .title(11)])
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

    let row = TerminalCommandPalettePresentation.rowForSlot(2, in: matches)

    #expect(row?.id == matches[1].id)
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
      ghosttyCommands: [
        GhosttyCommand(
          title: "Split Right",
          description: "Split the focused terminal to the right.",
          action: "new_split:right",
          actionKey: "new_split"
        ),
        GhosttyCommand(
          title: "Open Config",
          description: "Open the configuration file.",
          action: "open_config",
          actionKey: "open_config"
        ),
      ],
      ghosttyShortcutDisplayByAction: [
        "new_split:right": "⌘D",
        "open_config": "⌘,",
      ],
      hasFocusedSurface: true,
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
