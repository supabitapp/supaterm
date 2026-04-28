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
  func substringQueryMatchesGhosttyRows() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())

    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      in: rows,
      query: "split right"
    )

    #expect(visibleRows.first?.command == .ghosttyBindingAction("new_split:right"))
  }

  @Test
  func unmatchedQueryReturnsNoRows() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())

    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      in: rows,
      query: "missing"
    )

    #expect(visibleRows.isEmpty)
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
  func movedSelectionWrapsWithinFilteredRows() {
    let rows = TerminalCommandPalettePresentation.rows(from: makeSnapshot())
    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      in: rows,
      query: "switch"
    )

    let wrappedBackward = TerminalCommandPalettePresentation.movedSelection(
      visibleRows.first?.id,
      by: -1,
      in: visibleRows
    )
    let wrappedForward = TerminalCommandPalettePresentation.movedSelection(
      visibleRows.last?.id,
      by: 1,
      in: visibleRows
    )

    #expect(wrappedBackward == visibleRows.last?.id)
    #expect(wrappedForward == visibleRows.first?.id)
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
    TerminalTabItem(
      id: TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000010")!),
      title: "Main",
      icon: nil
    ),
    TerminalTabItem(
      id: TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000011")!),
      title: "Logs",
      icon: "doc.plaintext"
    ),
  ]

  private func makeSnapshot(selectedTabIsPinned: Bool = false) -> TerminalCommandPaletteSnapshot {
    let selectedSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
    let otherSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
    var visibleTabs = self.visibleTabs
    visibleTabs[0].isPinned = selectedTabIsPinned

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
      visibleTabs: visibleTabs
    )
  }
}
