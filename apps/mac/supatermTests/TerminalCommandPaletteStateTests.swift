import Foundation
import Testing

@testable import supaterm

struct TerminalCommandPaletteStateTests {
  @Test
  func rowsBuildFromGhosttyCommandsAndWindowContext() {
    let snapshot = makeSnapshot()

    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)

    #expect(
      rows.map(\.id) == [
        "ghostty:new_split:right",
        "ghostty:open_config",
        "supaterm:toggle-sidebar",
        "supaterm:submit-github-issue",
        "supaterm:create-space",
        "supaterm:rename-space:\(snapshot.spaces[0].id.rawValue.uuidString)",
        "supaterm:toggle-pinned:\(snapshot.visibleTabs[0].id.rawValue.uuidString)",
        "supaterm:space:\(snapshot.spaces[1].id.rawValue.uuidString)",
        "supaterm:tab:\(snapshot.visibleTabs[1].id.rawValue.uuidString)",
      ]
    )
    #expect(rows[0].shortcut == "⌘D")
    #expect(rows[1].shortcut == "⌘,")
    #expect(rows[3].command == .submitGitHubIssue)
  }

  @Test
  func rowsShowUnpinForSelectedPinnedTab() {
    let snapshot = makeSnapshot(selectedTabIsPinned: true)

    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)
    let row = rows.first(where: {
      $0.id == "supaterm:toggle-pinned:\(snapshot.visibleTabs[0].id.rawValue.uuidString)"
    })

    #expect(row?.title == "Unpin Tab")
    #expect(row?.symbol == "pin.slash")
    #expect(row?.command == .togglePinned(snapshot.visibleTabs[0].id))
  }

  @Test
  func typoQueryMatchesGhosttyRows() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())

    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      in: rows,
      query: "splt rigt"
    )

    #expect(visibleRows.first?.command == .ghosttyBindingAction("new_split:right"))
  }

  @Test
  func normalizedSelectionFallsBackToFirstVisibleRow() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())
    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      in: rows,
      query: "switch"
    )

    let selectedRowID = TerminalCommandPalettePresentation.normalizedSelection(
      "missing",
      in: visibleRows
    )

    #expect(selectedRowID == visibleRows.first?.id)
  }

  @Test
  func rowForSlotUsesFilteredOrdering() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())
    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      in: rows,
      query: "switch"
    )

    let row = TerminalCommandPalettePresentation.rowForSlot(2, in: visibleRows)

    #expect(row?.id == visibleRows[1].id)
    #expect(row?.command == .selectSpace(makeSnapshot().spaces[1].id))
  }

  private var visibleTabs: [TerminalTabItem] = [
    .init(
      id: TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000010")!), title: "Main", icon: nil),
    .init(
      id: TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000011")!), title: "Logs",
      icon: "doc.plaintext"),
  ]

  private func makeSnapshot(selectedTabIsPinned: Bool = false) -> TerminalCommandPaletteSnapshot {
    let selectedSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
    let otherSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
    var visibleTabs = self.visibleTabs
    visibleTabs[0].isPinned = selectedTabIsPinned

    return .init(
      ghosttyCommands: [
        .init(
          title: "Split Right",
          description: "Split the focused terminal to the right.",
          action: "new_split:right",
          actionKey: "new_split"
        ),
        .init(
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
      selectedSpaceID: selectedSpaceID,
      spaces: [
        .init(id: selectedSpaceID, name: "Workspace Alpha"),
        .init(id: otherSpaceID, name: "Workspace Beta"),
      ],
      selectedTabID: visibleTabs[0].id,
      visibleTabs: visibleTabs
    )
  }
}
