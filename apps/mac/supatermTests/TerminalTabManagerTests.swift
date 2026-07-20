import Testing

@testable import supaterm

@MainActor
struct TerminalTabManagerTests {
  @Test
  func createTabUsesRequestedRootLaneAndSelectsIt() throws {
    let manager = TerminalTabManager()
    let regular = manager.createTab(title: "Regular")
    let pinned = try #require(
      manager.createTab(
        title: "Pinned",
        at: .root(TerminalRootPlacement(isPinned: true, index: 0))
      )
    )

    #expect(manager.tabs.map(\.id) == [pinned, regular])
    #expect(manager.pinnedRootItems.map(\.id) == [.tab(pinned)])
    #expect(manager.regularRootItems.map(\.id) == [.tab(regular)])
    #expect(manager.selectedTabId == pinned)
  }

  @Test
  func createGroupUsesTargetPositionAndSuppliedTabOrder() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let target = manager.createTab(title: "Target")
    let source = manager.createTab(title: "Source")
    let last = manager.createTab(title: "Last")

    let groupID = try #require(
      manager.createGroup(title: "Build", color: .blue, containing: [target, source])
    )

    #expect(manager.rootItems.map(\.id) == [.tab(first), .group(groupID), .tab(last)])
    #expect(manager.tabIDs(in: groupID) == [target, source])
    #expect(manager.group(for: groupID)?.title == "Build")
    #expect(manager.group(for: groupID)?.color == .blue)
  }

  @Test
  func createGroupFromGroupedChildCreatesAdjacentGroupAndRetainsEmptySource() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let sourceGroupID = try #require(manager.createGroup(title: "Group", containing: [first]))
    let newGroupID = try #require(
      manager.createGroup(title: "New Group", containing: [first, second])
    )

    #expect(manager.tabIDs(in: sourceGroupID).isEmpty)
    #expect(manager.tabIDs(in: newGroupID) == [first, second])
    #expect(manager.rootItems.map(\.id) == [.group(sourceGroupID), .group(newGroupID)])
    #expect(manager.createGroup(title: "Duplicate", containing: [first, first]) == nil)
  }

  @Test
  func invalidGroupCreationDoesNotMutateTopologyOrSelection() {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    manager.selectTab(first)
    let rootItems = manager.rootItems

    #expect(manager.createGroup(title: "  ", containing: [first]) == nil)
    #expect(manager.createGroup(title: "Group", containing: [first, first]) == nil)
    #expect(manager.createGroup(title: "Group", containing: [TerminalTabID()]) == nil)

    #expect(manager.rootItems == rootItems)
    #expect(manager.tabs.map(\.id) == [first, second])
    #expect(manager.selectedTabId == first)
  }

  @Test
  func movingTabBetweenGroupsRetainsEmptySourceGroup() throws {
    let manager = TerminalTabManager()
    let source = manager.createTab(title: "Source")
    let target = manager.createTab(title: "Target")
    let sourceGroupID = try #require(manager.createGroup(title: "Source", containing: [source]))
    let targetGroupID = try #require(manager.createGroup(title: "Target", containing: [target]))

    #expect(manager.moveTab(source, to: .group(targetGroupID, index: 1)))
    #expect(manager.tabIDs(in: sourceGroupID).isEmpty)
    #expect(manager.tabIDs(in: targetGroupID) == [target, source])
  }

  @Test
  func movingRootItemsUsesPostRemovalLaneIndices() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let third = manager.createTab(title: "Third")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [second]))

    #expect(manager.moveGroup(groupID, to: TerminalRootPlacement(isPinned: true, index: 0)))
    #expect(
      manager.moveTab(
        third,
        to: .root(TerminalRootPlacement(isPinned: false, index: 0))
      )
    )
    #expect(manager.rootItems.map(\.id) == [.group(groupID), .tab(third), .tab(first)])
  }

  @Test
  func groupedPinExtractsTabToPinnedRoot() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [first, second]))

    #expect(manager.setTabPinned(second, isPinned: true))
    #expect(manager.rootItems.map(\.id) == [.tab(second), .group(groupID)])
    #expect(manager.tabIDs(in: groupID) == [first])
    #expect(manager.pinnedRootItems.map(\.id) == [.tab(second)])
  }

  @Test
  func pinningGroupMovesWholeRootWithoutChangingChildren() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [first, second]))

    #expect(manager.setPinned(.group(groupID), isPinned: true))
    #expect(manager.group(for: groupID)?.isPinned == true)
    #expect(manager.tabIDs(in: groupID) == [first, second])
    #expect(manager.isPinned(first) == false)
  }

  @Test
  func removeTabFromGroupInheritsGroupPinAndFollowsGroup() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [first, second]))
    #expect(manager.setPinned(.group(groupID), isPinned: true))

    #expect(manager.removeTabFromGroup(first))
    #expect(manager.rootItems.map(\.id) == [.group(groupID), .tab(first)])
    #expect(manager.pinnedRootItems.map(\.id) == [.group(groupID), .tab(first)])
    #expect(manager.tabIDs(in: groupID) == [second])
  }

  @Test
  func ungroupReplacesGroupWithChildrenInOrderAndInheritedLane() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [first, second]))
    #expect(manager.setPinned(.group(groupID), isPinned: true))

    #expect(manager.ungroup(groupID))
    #expect(manager.rootItems.map(\.id) == [.tab(first), .tab(second)])
    #expect(manager.pinnedRootItems.map(\.id) == [.tab(first), .tab(second)])
  }

  @Test
  func closingLastChildRetainsEmptyGroupAndSelectsNextFlattenedTab() throws {
    let manager = TerminalTabManager()
    let grouped = manager.createTab(title: "Grouped")
    let next = manager.createTab(title: "Next")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [grouped]))
    manager.selectTab(grouped)

    manager.closeTab(grouped)

    #expect(manager.group(for: groupID)?.tabs.isEmpty == true)
    #expect(manager.selectedTabId == next)
  }

  @Test
  func closeBelowAndOthersUseStableFlattenedOrderAcrossGroups() throws {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let groupedA = manager.createTab(title: "Grouped A")
    let groupedB = manager.createTab(title: "Grouped B")
    let last = manager.createTab(title: "Last")
    _ = try #require(manager.createGroup(title: "Group", containing: [groupedA, groupedB]))

    #expect(manager.tabs.map(\.id) == [first, groupedA, groupedB, last])
    #expect(manager.tabIDsBelow(groupedA) == [groupedB, last])
    #expect(manager.otherTabIDs(groupedB) == [first, groupedA, last])
  }

  @Test
  func invalidMoveDoesNotMutateTopology() {
    let manager = TerminalTabManager()
    let first = manager.createTab(title: "First")
    let before = manager.rootItems

    #expect(
      !manager.moveTab(
        first,
        to: .root(TerminalRootPlacement(isPinned: false, index: 2))
      )
    )
    #expect(manager.rootItems == before)
  }

  @Test
  func nestedTabTitleAndDirtyMutationsUpdateCanonicalTopology() throws {
    let manager = TerminalTabManager()
    let tabID = manager.createTab(title: "Terminal")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [tabID]))

    manager.updateTitle(tabID, title: "zsh")
    manager.updateDirty(tabID, isDirty: true)
    manager.setLockedTitle(tabID, title: "Build")
    manager.updateTitle(tabID, title: "Ignored")

    let tab = try #require(manager.group(for: groupID)?.tabs.first)
    #expect(tab.title == "Build")
    #expect(tab.isDirty)
    #expect(tab.isTitleLocked)
  }

  @Test
  func restoreNormalizesPinLanesAndDropsDuplicateTabsAndGroups() {
    let manager = TerminalTabManager()
    let tab = TerminalTabItem(title: "Tab")
    let groupID = TerminalTabGroupID()
    let group = TerminalTabGroupItem(
      id: groupID,
      title: "Group",
      color: .purple,
      isPinned: true,
      tabs: [tab]
    )

    manager.restoreRootItems(
      [
        .tab(TerminalUngroupedTabItem(tab: TerminalTabItem(title: "Regular"), isPinned: false)),
        .group(group),
        .tab(TerminalUngroupedTabItem(tab: tab, isPinned: true)),
        .group(group),
      ],
      selectedTabID: tab.id
    )

    #expect(manager.rootItems.count == 2)
    #expect(manager.rootItems.first?.id == .group(groupID))
    #expect(manager.tabs.filter { $0.id == tab.id }.count == 1)
    #expect(manager.selectedTabId == tab.id)
  }
}
