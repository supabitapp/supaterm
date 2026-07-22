import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite {
  @Suite struct CommandMatrixTests {
    @Test(.timeLimit(.minutes(5)))
    func selectSpaceUpdatesSelection() async throws {
      try await withTestSpace { app, space in
        let snapshot = try app.debugSnapshot()
        let window = try #require(snapshot.windows.first)
        let otherSpace = try #require(window.spaces.first { $0.id != space.spaceID })

        let selectedOther = try app.send(
          .selectSpace(SupatermSpaceTargetRequest(spaceID: otherSpace.id)),
          as: SupatermSelectSpaceResult.self
        )
        #expect(selectedOther.isSelectedSpace)
        #expect(selectedOther.target.spaceID == otherSpace.id)

        let selectedBack = try app.send(
          .selectSpace(SupatermSpaceTargetRequest(spaceID: space.spaceID)),
          as: SupatermSelectSpaceResult.self
        )
        #expect(selectedBack.target.spaceID == space.spaceID)

        let after = try app.debugSnapshot()
        let spaces = try #require(after.windows.first).spaces
        #expect(spaces.first { $0.id == space.spaceID }?.isSelected == true)
        #expect(spaces.first { $0.id == otherSpace.id }?.isSelected == false)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func selectTabAndFocusPane() async throws {
      try await withTestSpace { app, space in
        let secondTab = try makeTab(app, in: space)
        #expect(secondTab.isSelectedTab)

        let selectedFirst = try app.send(
          .selectTab(SupatermTabTargetRequest(tabID: space.tab.tabID)),
          as: SupatermSelectTabResult.self
        )
        #expect(selectedFirst.isSelectedTab)
        #expect(selectedFirst.target.tabID == space.tab.tabID)
        #expect(try app.debugTab(space.tab.tabID)?.isSelected == true)
        #expect(try app.debugTab(secondTab.tabID)?.isSelected == false)

        let split = try makeSplit(app, in: space)
        let focusedOriginal = try app.send(
          .focusPane(SupatermPaneTargetRequest(paneID: space.tab.paneID)),
          as: SupatermFocusPaneResult.self
        )
        #expect(focusedOriginal.target.paneID == space.tab.paneID)
        #expect(try app.debugPane(space.tab.paneID)?.isFocused == true)
        #expect(try app.debugPane(split.paneID)?.isFocused == false)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func nextPreviousLastTabRoundTrip() async throws {
      try await withTestSpace { app, space in
        let second = try makeTab(app, in: space)
        let third = try makeTab(app, in: space)

        _ = try app.send(
          .selectTab(SupatermTabTargetRequest(tabID: space.tab.tabID)),
          as: SupatermSelectTabResult.self
        )

        let navigation = SupatermTabNavigationRequest(spaceID: space.spaceID)
        let next = try app.send(.nextTab(navigation), as: SupatermSelectTabResult.self)
        #expect(next.target.tabID == second.tabID)

        let nextAgain = try app.send(.nextTab(navigation), as: SupatermSelectTabResult.self)
        #expect(nextAgain.target.tabID == third.tabID)

        let previous = try app.send(.previousTab(navigation), as: SupatermSelectTabResult.self)
        #expect(previous.target.tabID == second.tabID)

        let last = try app.send(.lastTab(navigation), as: SupatermSelectTabResult.self)
        #expect(last.target.tabID == third.tabID)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func nextPreviousLastSpaceRoundTrip() async throws {
      try await withTestSpace { app, space in
        let navigation = SupatermSpaceNavigationRequest(spaceID: space.spaceID)

        let next = try app.send(.nextSpace(navigation), as: SupatermSelectSpaceResult.self)
        #expect(next.target.spaceID != space.spaceID)

        let previous = try app.send(
          .previousSpace(SupatermSpaceNavigationRequest(spaceID: next.target.spaceID)),
          as: SupatermSelectSpaceResult.self
        )
        #expect(previous.target.spaceID == space.spaceID)

        let last = try app.send(
          .lastSpace(SupatermSpaceNavigationRequest(spaceID: previous.target.spaceID)),
          as: SupatermSelectSpaceResult.self
        )
        #expect(last.target.spaceID == next.target.spaceID)

        _ = try app.send(
          .selectSpace(SupatermSpaceTargetRequest(spaceID: space.spaceID)),
          as: SupatermSelectSpaceResult.self
        )
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func renameTabLocksTitle() async throws {
      try await withTestSpace { app, space in
        let title = "locked-\(space.token)"
        let renamed = try app.send(
          .renameTab(
            SupatermRenameTabRequest(
              target: SupatermTabTargetRequest(tabID: space.tab.tabID),
              title: title
            )
          ),
          as: SupatermRenameTabResult.self
        )
        #expect(renamed.isTitleLocked)
        #expect(renamed.target.title == title)

        try app.type("echo churn\n", into: space.pane)
        try await app.waitForCapture(space.pane, contains: "churn")

        let tab = try #require(try app.debugTab(space.tab.tabID))
        #expect(tab.title == title)
        #expect(tab.isTitleLocked)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func renameSpace() async throws {
      try await withTestSpace { app, space in
        let name = "renamed-\(space.token)"
        let renamed = try app.send(
          .renameSpace(
            SupatermRenameSpaceRequest(
              target: SupatermSpaceTargetRequest(spaceID: space.spaceID),
              name: name
            )
          ),
          as: SupatermSpaceTarget.self
        )
        #expect(renamed.name == name)

        let spaces = try app.debugSnapshot().windows.flatMap(\.spaces)
        #expect(spaces.first { $0.id == space.spaceID }?.name == name)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func pinUnpinTab() async throws {
      try await withTestSpace { app, space in
        let target = SupatermTabTargetRequest(tabID: space.tab.tabID)

        let pinned = try app.send(.pinTab(target), as: SupatermPinTabResult.self)
        #expect(pinned.isPinned)
        #expect(try app.debugRootTab(space.tab.tabID)?.isPinned == true)

        let unpinned = try app.send(.unpinTab(target), as: SupatermPinTabResult.self)
        #expect(!unpinned.isPinned)
        #expect(try app.debugRootTab(space.tab.tabID)?.isPinned == false)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func closePanePromotesSibling() async throws {
      try await withTestSpace { app, space in
        let split = try makeSplit(app, in: space)
        #expect(try app.debugTab(space.tab.tabID)?.panes.count == 2)

        let closed = try app.send(
          .closePane(SupatermPaneTargetRequest(paneID: split.paneID)),
          as: SupatermClosePaneResult.self
        )
        #expect(closed.paneID == split.paneID)

        try await app.waitUntil("the split pane is removed") {
          try app.debugTab(space.tab.tabID)?.panes.map(\.id) == [space.tab.paneID]
        }
        #expect(try app.debugPane(space.tab.paneID)?.isFocused == true)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func closeTabReducesCount() async throws {
      try await withTestSpace { app, space in
        let second = try makeTab(app, in: space)

        let closed = try app.send(
          .closeTab(SupatermTabTargetRequest(tabID: second.tabID)),
          as: SupatermCloseTabResult.self
        )
        #expect(closed.tabID == second.tabID)

        try await app.waitUntil("the tab is removed") {
          try app.debugTab(second.tabID) == nil
        }
        #expect(try app.debugTab(space.tab.tabID)?.isSelected == true)
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func closeSpaceRemovesIt() async throws {
      try await withTestSpace { app, space in
        let extra = try app.send(
          .createSpace(
            SupatermCreateSpaceRequest(
              focus: true,
              name: "extra-\(space.token)",
              windowAnchorPaneID: space.tab.paneID
            )
          ),
          as: SupatermCreateSpaceResult.self
        )

        let closed = try app.send(
          .closeSpace(SupatermSpaceTargetRequest(spaceID: extra.target.spaceID)),
          as: SupatermCloseSpaceResult.self
        )
        #expect(closed.spaceID == extra.target.spaceID)

        try await app.waitUntil("the space is removed") {
          let spaces = try app.debugSnapshot().windows.flatMap(\.spaces)
          return !spaces.contains { $0.id == extra.target.spaceID }
        }
      }
    }

    @Test(.timeLimit(.minutes(5)))
    func closeIsUnconditionalWithRunningProcess() async throws {
      try await withTestSpace { app, space in
        let split = try makeSplit(app, in: space)
        let splitPane = SupatermPaneTargetRequest(paneID: split.paneID)
        try await app.waitForShellPrompt(splitPane)

        try app.type("sleep 300\n", into: splitPane)
        try await app.waitForCapture(splitPane, contains: "sleep 300")

        _ = try app.send(.closePane(splitPane), as: SupatermClosePaneResult.self)
        try await app.waitUntil("the running pane is removed") {
          try app.debugPane(split.paneID) == nil
        }
      }
    }
  }
}
