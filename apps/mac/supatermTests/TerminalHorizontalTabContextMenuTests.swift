import AppKit
import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalHorizontalTabContextMenuTests {
  @Test
  func selectedTabsUseTheOrderedBatchMenu() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try Fixture()
      let selectionState = fixture.terminal.spaceManager.displayedInstance.tabSelectionState
      selectionState.toggle(
        fixture.groupedTabID,
        primaryTabID: fixture.trailingTabID
      )
      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .tab(fixture.groupedTabID),
          snapshot: fixture.snapshot,
          surface: .empty,
          terminal: fixture.terminal,
          selectionState: selectionState
        )
      )

      #expect(
        menu.items.map(\.title) == [
          "Pin 2 Tabs",
          "New Group with 2 Tabs",
          "Move to Group",
          "",
          "Close 2 Tabs",
          "Close Other Tabs",
          "Close Tabs to Left",
          "Close Tabs to Right",
        ]
      )
      #expect(menu.item(withTitle: "Pin 2 Tabs")?.state == .off)
      #expect(menu.item(withTitle: "Close Tabs to Left")?.isEnabled == true)
      #expect(menu.item(withTitle: "Close Tabs to Right")?.isEnabled == false)
    }
  }

  @Test
  func mixedBatchPinStateIsShownAndDisabled() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try Fixture()
      fixture.terminal.togglePinned(fixture.rootTabID)
      let snapshot = fixture.terminal.spaceManager.displayedInstance.tabSurfaceSnapshot
      let selectionState = fixture.terminal.spaceManager.displayedInstance.tabSelectionState
      selectionState.toggle(
        fixture.rootTabID,
        primaryTabID: fixture.trailingTabID
      )
      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .tab(fixture.rootTabID),
          snapshot: snapshot,
          surface: .empty,
          terminal: fixture.terminal,
          selectionState: selectionState
        )
      )
      let pinItem = try #require(menu.item(withTitle: "Pin 2 Tabs"))

      #expect(pinItem.state == .mixed)
      #expect(pinItem.isEnabled == false)
    }
  }

  @Test
  func tabMenuPreservesSupportedSectionOrder() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try Fixture()
      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .tab(fixture.groupedTabID),
          snapshot: fixture.snapshot,
          surface: fixture.surface(paneCount: 2, for: fixture.groupedTabID),
          terminal: fixture.terminal
        )
      )

      #expect(
        menu.items.map(\.title) == [
          "New Tab",
          "",
          "Pin Tab",
          "",
          "Move All Panes to New Tabs",
          "",
          "Move to New Group",
          "Remove from Group",
          "Move to Group...",
          "",
          "Change Tab Title...",
          "",
          "Close",
          "Close Others",
          "Close Tabs to Left",
          "Close Tabs to Right",
        ]
      )
      #expect(menu.item(withTitle: "Move to Group...")?.isEnabled == false)
      #expect(menu.item(withTitle: "Close Tabs to Left")?.isEnabled == true)
      #expect(menu.item(withTitle: "Close Tabs to Right")?.isEnabled == true)
    }
  }

  @Test
  func horizontalCloseCommandsEnableForTheirSide() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try Fixture()
      let expectedStates = [
        (fixture.rootTabID, false, true),
        (fixture.groupedTabID, true, true),
        (fixture.trailingTabID, true, false),
      ]

      for (tabID, leftIsEnabled, rightIsEnabled) in expectedStates {
        let menu = try #require(
          TerminalHorizontalTabContextMenu.menu(
            for: .tab(tabID),
            snapshot: fixture.snapshot,
            surface: .empty,
            terminal: fixture.terminal
          )
        )

        #expect(menu.item(withTitle: "Close Tabs to Left")?.isEnabled == leftIsEnabled)
        #expect(menu.item(withTitle: "Close Tabs to Right")?.isEnabled == rightIsEnabled)
      }

      let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
      let tabID = terminal.spaceManager.tabCollection.createTab(title: "Only")
      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .tab(tabID),
          snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
          surface: .empty,
          terminal: terminal
        )
      )

      #expect(menu.item(withTitle: "Close Others")?.isEnabled == false)
      #expect(menu.item(withTitle: "Close Tabs to Left")?.isEnabled == false)
      #expect(menu.item(withTitle: "Close Tabs to Right")?.isEnabled == false)
    }
  }

  @Test
  func horizontalCloseActionsTargetTabsOnTheNamedSide() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try Fixture()
      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .tab(fixture.groupedTabID),
          snapshot: fixture.snapshot,
          surface: .empty,
          terminal: fixture.terminal
        )
      )
      let stream = fixture.terminal.eventStream()
      var iterator = stream.makeAsyncIterator()

      #expect(try perform(menu, title: "Close Tabs to Left"))
      #expect(
        try #require(await iterator.next())
          == .closeRequested(
            TerminalCloseRequest(
              target: .tabs([fixture.rootTabID]),
              needsConfirmation: false
            )
          )
      )

      #expect(try perform(menu, title: "Close Tabs to Right"))
      #expect(
        try #require(await iterator.next())
          == .closeRequested(
            TerminalCloseRequest(
              target: .tabs([fixture.groupedSiblingTabID, fixture.trailingTabID]),
              needsConfirmation: false
            )
          )
      )
    }
  }

  @Test
  func newTabInheritsTheContextualTabSurface() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let root = FileManager.default.temporaryDirectory.appending(
        path: UUID().uuidString,
        directoryHint: .isDirectory
      )
      let contextualDirectory = root.appending(path: "contextual", directoryHint: .isDirectory)
      let selectedDirectory = root.appending(path: "selected", directoryHint: .isDirectory)
      try FileManager.default.createDirectory(
        at: contextualDirectory,
        withIntermediateDirectories: true
      )
      try FileManager.default.createDirectory(
        at: selectedDirectory,
        withIntermediateDirectories: true
      )
      defer { try? FileManager.default.removeItem(at: root) }

      let terminal = TerminalHostState.test(
        runtime: try makeGhosttyRuntime("confirm-close-surface = false"),
        createsLiveTerminalSurfaces: true,
        zmxSessionsEnabled: false
      )
      terminal.ensureInitialTab(
        focusing: true,
        workingDirectoryPath: contextualDirectory.path(percentEncoded: false)
      )
      let contextualTabID = try #require(terminal.selectedTabID)
      let selectedTabID = try #require(
        terminal.createTab(
          focusing: true,
          workingDirectoryPath: selectedDirectory.path(percentEncoded: false)
        )
      )
      #expect(terminal.selectedTabID == selectedTabID)

      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .tab(contextualTabID),
          snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
          surface: .empty,
          terminal: terminal
        )
      )

      #expect(try perform(menu, title: "New Tab"))
      #expect(terminal.selectedTabID != contextualTabID)
      #expect(terminal.selectedTabID != selectedTabID)
      let contextualPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        contextualDirectory.path(percentEncoded: false)
      )
      #expect(await waitUntil { terminal.selectedSurfaceState?.pwd == contextualPath })
    }
  }

  @Test
  func groupedChildPinExtractsAndPinsTheTab() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try Fixture()
      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .tab(fixture.groupedTabID),
          snapshot: fixture.snapshot,
          surface: .empty,
          terminal: fixture.terminal
        )
      )

      #expect(try perform(menu, title: "Pin Tab"))

      let collection = fixture.terminal.spaceManager.tabCollection
      #expect(collection.pinnedRootItems.map(\.id) == [.tab(fixture.groupedTabID)])
      #expect(collection.tabIDs(in: fixture.groupID) == [fixture.groupedSiblingTabID])
    }
  }

  @Test
  func groupMenuPreservesSupportedSectionOrderAndRunsExpansion() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = try Fixture()
      let menu = try #require(
        TerminalHorizontalTabContextMenu.menu(
          for: .group(fixture.groupID),
          snapshot: fixture.snapshot,
          surface: .empty,
          terminal: fixture.terminal
        )
      )

      #expect(
        menu.items.map(\.title) == [
          "Pin Group",
          "",
          "New Tab in Group",
          "Ungroup",
          "",
          "Rename Group",
          "Color",
          "Collapse Group",
          "",
          "Close Group",
        ]
      )
      #expect(try perform(menu, title: "Collapse Group"))
      #expect(fixture.terminal.collapsedTabGroupIDs.contains(fixture.groupID))
    }
  }

  private func perform(_ menu: NSMenu, title: String) throws -> Bool {
    let item = try #require(menu.item(withTitle: title))
    return NSApplication.shared.sendAction(
      try #require(item.action),
      to: item.target,
      from: item
    )
  }

  private struct Fixture {
    let rootTabID: TerminalTabID
    let groupedTabID: TerminalTabID
    let groupedSiblingTabID: TerminalTabID
    let trailingTabID: TerminalTabID
    let groupID: TerminalTabGroupID
    let snapshot: TerminalTabSurfaceSnapshot
    let terminal: TerminalHostState

    init() throws {
      let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
      let manager = terminal.spaceManager.tabCollection
      let rootTabID = manager.createTab(title: "Root")
      let groupedTabID = manager.createTab(title: "Grouped")
      let groupedSiblingTabID = manager.createTab(title: "Grouped Sibling")
      let groupID = try #require(
        terminal.createGroup(
          title: "Work",
          containing: [groupedTabID, groupedSiblingTabID]
        )
      ).groupID
      let trailingTabID = manager.createTab(title: "Trailing")
      self.rootTabID = rootTabID
      self.groupedTabID = groupedTabID
      self.groupedSiblingTabID = groupedSiblingTabID
      self.trailingTabID = trailingTabID
      self.groupID = groupID
      snapshot = terminal.spaceManager.displayedInstance.tabSurfaceSnapshot
      self.terminal = terminal
    }

    func surface(
      paneCount: Int,
      for tabID: TerminalTabID
    ) -> TerminalHorizontalTabSurfacePresentation {
      TerminalHorizontalTabSurfacePresentation(
        tabsByID: [
          tabID: TerminalTabChromePresentation(
            panes: (0..<paneCount).map { index in
              TerminalTabPanePresentation(
                id: UUID(),
                title: "Pane \(index + 1)",
                indicator: nil
              )
            },
            progress: nil
          )
        ],
        groupIconURLs: [:]
      )
    }
  }
}

extension TerminalHorizontalTabSurfacePresentation {
  fileprivate static let empty = Self(tabsByID: [:], groupIconURLs: [:])
}
