import Foundation
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct TerminalTabCollectionTests {
  @Test
  func snapshotProjectsTopologySelectionAndOrder() throws {
    let collection = TerminalTabCollection()
    let first = collection.createTab(title: "First")
    let second = collection.createTab(title: "Second")
    let groupID = try #require(
      collection.createGroup(title: "Group", containing: [first, second])?.groupID
    )
    collection.selectTab(second)

    let snapshot = collection.snapshot

    #expect(snapshot.rootItems.map(\.id) == [.group(groupID)])
    #expect(snapshot.tabs.map(\.id) == [first, second])
    #expect(snapshot.selectedTabID == second)
    #expect(snapshot.topologyRevision == collection.topologyRevision)
  }

  @Test
  func createTabUsesRequestedRootLaneAndSelectsIt() throws {
    let manager = TerminalTabCollection()
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
    #expect(manager.selectedTabID == pinned)
  }

  @Test
  func selectingUnknownTabKeepsCurrentSelection() {
    let collection = TerminalTabCollection()
    let selectedTabID = collection.createTab(title: "Selected")

    collection.selectTab(TerminalTabID())

    #expect(collection.selectedTabID == selectedTabID)
  }

  @Test
  func createGroupUsesTargetPositionAndSuppliedTabOrder() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let target = manager.createTab(title: "Target")
    let source = manager.createTab(title: "Source")
    let last = manager.createTab(title: "Last")

    let groupID = try #require(
      manager.createGroup(title: "Build", color: .blue, containing: [target, source])
    ).groupID

    #expect(manager.rootItems.map(\.id) == [.tab(first), .group(groupID), .tab(last)])
    #expect(manager.tabIDs(in: groupID) == [target, source])
    #expect(manager.group(for: groupID)?.title == "Build")
    #expect(manager.group(for: groupID)?.color == .blue)
  }

  @Test
  func createGroupFromGroupedChildDeletesEmptiedAutomaticSource() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let sourceGroupID = try #require(
      manager.createGroup(title: "Group", containing: [first])
    ).groupID
    let creation = try #require(
      manager.createGroup(title: "New Group", containing: [first, second])
    )
    let newGroupID = creation.groupID

    #expect(manager.group(for: sourceGroupID) == nil)
    #expect(creation.deletedEmptyGroupIDs == [sourceGroupID])
    #expect(creation.topologyRevision == manager.topologyRevision)
    #expect(manager.tabIDs(in: newGroupID) == [first, second])
    #expect(manager.rootItems.map(\.id) == [.group(newGroupID)])
    #expect(manager.createGroup(title: "Duplicate", containing: [first, first]) == nil)
  }

  @Test
  func invalidGroupCreationDoesNotMutateTopologyOrSelection() {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    manager.selectTab(first)
    let rootItems = manager.rootItems

    #expect(manager.createGroup(title: "  ", containing: [first]) == nil)
    #expect(manager.createGroup(title: "Group", containing: [first, first]) == nil)
    #expect(manager.createGroup(title: "Group", containing: [TerminalTabID()]) == nil)

    #expect(manager.rootItems == rootItems)
    #expect(manager.tabs.map(\.id) == [first, second])
    #expect(manager.selectedTabID == first)
  }

  @Test
  func movingLastTabBetweenGroupsDeletesAutomaticSourceAndReturnsReceipt() throws {
    let manager = TerminalTabCollection()
    let source = manager.createTab(title: "Source")
    let target = manager.createTab(title: "Target")
    let sourceGroupID = try #require(
      manager.createGroup(title: "Source", containing: [source])
    ).groupID
    let targetGroupID = try #require(
      manager.createGroup(title: "Target", containing: [target])
    ).groupID

    let operationID = TerminalTabMoveOperationID(
      rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    )
    let revision = manager.topologyRevision
    #expect(manager.tabIDs(in: sourceGroupID) == [source])
    #expect(manager.tabIDs(in: targetGroupID) == [target])
    let result = try manager.move(
      TerminalTabMoveRequest(
        operationID: operationID,
        expectedTopologyRevision: revision,
        itemIDs: [.tab(source)],
        destination: .group(targetGroupID, index: 1)
      )
    )

    #expect(result.operationID == operationID)
    #expect(result.location == TerminalTabPlacement.group(targetGroupID, index: 1))
    #expect(result.deletedEmptyGroupIDs == [sourceGroupID])
    #expect(result.topologyRevision == revision + 1)
    #expect(manager.group(for: sourceGroupID) == nil)
    #expect(manager.tabIDs(in: targetGroupID) == [target, source])
  }

  @Test
  func explicitEmptyGroupRemainsAfterItsLastChildLeaves() throws {
    let manager = TerminalTabCollection()
    let tabID = manager.createTab(title: "Tab")
    let groupID = try #require(manager.createGroup(title: "Durable", containing: [])).groupID
    _ = try manager.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: manager.topologyRevision,
        itemIDs: [.tab(tabID)],
        destination: .group(groupID, index: 0)
      )
    )

    let result = try manager.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: manager.topologyRevision,
        itemIDs: [.tab(tabID)],
        destination: .root(TerminalRootPlacement(isPinned: false, index: 0))
      )
    )

    #expect(result.deletedEmptyGroupIDs.isEmpty)
    #expect(manager.group(for: groupID)?.lifetime == .durable)
    #expect(manager.tabIDs(in: groupID).isEmpty)
  }

  @Test
  func batchMoveUsesPostRemovalIndexAndPreservesRequestOrder() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let third = manager.createTab(title: "Third")
    let fourth = manager.createTab(title: "Fourth")
    let revision = manager.topologyRevision
    #expect(manager.rootItems.map(\.id) == [.tab(first), .tab(second), .tab(third), .tab(fourth)])

    let result = try manager.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: revision,
        itemIDs: [.tab(second), .tab(third)],
        destination: .root(TerminalRootPlacement(isPinned: false, index: 2))
      )
    )

    #expect(manager.rootItems.map(\.id) == [.tab(first), .tab(fourth), .tab(second), .tab(third)])
    #expect(
      result.location
        == TerminalTabPlacement.root(TerminalRootPlacement(isPinned: false, index: 2))
    )
    #expect(result.topologyRevision == revision + 1)
  }

  @Test
  func batchMoveRemovesAutomaticSourceGroupsBeforeRootInsertion() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let tail = manager.createTab(title: "Tail")
    let firstGroup = try #require(manager.createGroup(title: "First", containing: [first])).groupID
    let secondGroup = try #require(manager.createGroup(title: "Second", containing: [second])).groupID

    let result = try manager.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: manager.topologyRevision,
        itemIDs: [.tab(first), .tab(second)],
        destination: .root(TerminalRootPlacement(isPinned: false, index: 1))
      )
    )

    #expect(manager.rootItems.map(\.id) == [.tab(tail), .tab(first), .tab(second)])
    #expect(result.location == .root(TerminalRootPlacement(isPinned: false, index: 1)))
    #expect(result.deletedEmptyGroupIDs == [firstGroup, secondGroup])
  }

  @Test
  func removingLastAutomaticChildUsesRootIndexAfterGroupDeletion() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let grouped = manager.createTab(title: "Grouped")
    let trailing = manager.createTab(title: "Trailing")
    _ = try #require(manager.createGroup(title: "Group", containing: [grouped]))

    let result = try #require(manager.removeTabFromGroup(grouped))

    #expect(manager.rootItems.map(\.id) == [.tab(first), .tab(grouped), .tab(trailing)])
    #expect(result.location == .root(TerminalRootPlacement(isPinned: false, index: 1)))
  }

  @Test
  func batchMoveRejectsGroupWithItsDescendantWithoutMutation() throws {
    let manager = TerminalTabCollection()
    let child = manager.createTab(title: "Child")
    let sibling = manager.createTab(title: "Sibling")
    let groupID = try #require(
      manager.createGroup(title: "Group", containing: [child])
    ).groupID
    let before = manager.rootItems
    let revision = manager.topologyRevision

    #expect(throws: TerminalTabMoveError.ancestorAndDescendant(groupID, child)) {
      try manager.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: revision,
          itemIDs: [.group(groupID), .tab(child)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 1))
        )
      )
    }

    #expect(manager.rootItems == before)
    #expect(manager.rootItems.map(\.id) == [.group(groupID), .tab(sibling)])
    #expect(manager.topologyRevision == revision)
  }

  @Test
  func movingRootItemsUsesPostRemovalLaneIndices() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let third = manager.createTab(title: "Third")
    let groupID = try #require(manager.createGroup(title: "Group", containing: [second])).groupID

    _ = try manager.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: manager.topologyRevision,
        itemIDs: [.group(groupID)],
        destination: .root(TerminalRootPlacement(isPinned: true, index: 0))
      )
    )
    _ = try manager.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: manager.topologyRevision,
        itemIDs: [.tab(third)],
        destination: .root(TerminalRootPlacement(isPinned: false, index: 0))
      )
    )
    #expect(manager.rootItems.map(\.id) == [.group(groupID), .tab(third), .tab(first)])
  }

  @Test
  func groupedPinExtractsTabToPinnedRoot() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(
      manager.createGroup(title: "Group", containing: [first, second])
    ).groupID

    #expect(manager.setTabPinned(second, isPinned: true) != nil)
    #expect(manager.rootItems.map(\.id) == [.tab(second), .group(groupID)])
    #expect(manager.tabIDs(in: groupID) == [first])
    #expect(manager.pinnedRootItems.map(\.id) == [.tab(second)])
  }

  @Test
  func pinningGroupMovesWholeRootWithoutChangingChildren() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(
      manager.createGroup(title: "Group", containing: [first, second])
    ).groupID

    #expect(manager.setPinned(.group(groupID), isPinned: true) != nil)
    #expect(manager.group(for: groupID)?.isPinned == true)
    #expect(manager.tabIDs(in: groupID) == [first, second])
    #expect(manager.isPinned(first) == false)
  }

  @Test
  func removeTabFromGroupInheritsGroupPinAndFollowsGroup() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(
      manager.createGroup(title: "Group", containing: [first, second])
    ).groupID
    #expect(manager.setPinned(.group(groupID), isPinned: true) != nil)

    #expect(manager.removeTabFromGroup(first) != nil)
    #expect(manager.rootItems.map(\.id) == [.group(groupID), .tab(first)])
    #expect(manager.pinnedRootItems.map(\.id) == [.group(groupID), .tab(first)])
    #expect(manager.tabIDs(in: groupID) == [second])
  }

  @Test
  func ungroupReplacesGroupWithChildrenInOrderAndInheritedLane() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let second = manager.createTab(title: "Second")
    let groupID = try #require(
      manager.createGroup(title: "Group", containing: [first, second])
    ).groupID
    #expect(manager.setPinned(.group(groupID), isPinned: true) != nil)

    #expect(manager.ungroup(groupID))
    #expect(manager.rootItems.map(\.id) == [.tab(first), .tab(second)])
    #expect(manager.pinnedRootItems.map(\.id) == [.tab(first), .tab(second)])
  }

  @Test
  func closingLastChildDeletesAutomaticGroupAndSelectsNextFlattenedTab() throws {
    let manager = TerminalTabCollection()
    let grouped = manager.createTab(title: "Grouped")
    let next = manager.createTab(title: "Next")
    let groupID = try #require(
      manager.createGroup(title: "Group", containing: [grouped])
    ).groupID
    manager.selectTab(grouped)

    let result = try #require(manager.closeTab(grouped))

    #expect(manager.group(for: groupID) == nil)
    #expect(manager.selectedTabID == next)
    #expect(result.deletedEmptyGroupIDs == [groupID])
    #expect(result.topologyRevision == manager.topologyRevision)
  }

  @Test
  func closeBelowAndOthersUseStableFlattenedOrderAcrossGroups() throws {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let groupedA = manager.createTab(title: "Grouped A")
    let groupedB = manager.createTab(title: "Grouped B")
    let last = manager.createTab(title: "Last")
    _ = try #require(manager.createGroup(title: "Group", containing: [groupedA, groupedB]))

    #expect(manager.tabs.map(\.id) == [first, groupedA, groupedB, last])
    #expect(manager.tabIDsBelow(groupedA) == [groupedB, last])
    #expect(manager.otherTabIDs(keeping: [groupedB]) == [first, groupedA, last])
  }

  @Test
  func bulkCloseTargetsExcludeRootPinnedTabs() {
    let manager = TerminalTabCollection()
    let source = manager.createTab(title: "Source")
    let pinned = manager.createTab(title: "Pinned")
    let regular = manager.createTab(title: "Regular")
    #expect(manager.setTabPinned(source, isPinned: true) != nil)
    #expect(manager.setTabPinned(pinned, isPinned: true) != nil)

    #expect(manager.tabs.map(\.id) == [source, pinned, regular])
    #expect(manager.tabIDsBelow(source) == [regular])
    #expect(manager.otherTabIDs(keeping: [source]) == [regular])
  }

  @Test
  func invalidMoveDoesNotMutateTopologyOrRevision() {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let before = manager.rootItems
    let revision = manager.topologyRevision

    #expect(
      throws: TerminalTabMoveError.invalidDestination(
        .root(TerminalRootPlacement(isPinned: false, index: 2))
      )
    ) {
      try manager.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: revision,
          itemIDs: [.tab(first)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 2))
        )
      )
    }
    #expect(manager.rootItems == before)
    #expect(manager.topologyRevision == revision)
  }

  @Test
  func staleMoveDoesNotMutateTopologyOrRevision() {
    let manager = TerminalTabCollection()
    let first = manager.createTab(title: "First")
    let staleRevision = manager.topologyRevision
    let second = manager.createTab(title: "Second")
    let before = manager.rootItems
    let currentRevision = manager.topologyRevision

    #expect(
      throws: TerminalTabMoveError.staleTopology(
        expected: staleRevision,
        actual: currentRevision
      )
    ) {
      try manager.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: staleRevision,
          itemIDs: [.tab(first)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 1))
        )
      )
    }
    #expect(manager.rootItems == before)
    #expect(manager.rootItems.map(\.id) == [.tab(first), .tab(second)])
    #expect(manager.topologyRevision == currentRevision)
  }

  @Test
  func groupMetadataDoesNotAdvanceTopologyRevision() throws {
    let manager = TerminalTabCollection()
    let groupID = try #require(manager.createGroup(title: "Group", containing: [])).groupID
    let revision = manager.topologyRevision

    #expect(manager.renameGroup(groupID, title: "Renamed"))
    #expect(manager.setGroupColor(groupID, color: .blue))
    #expect(manager.topologyRevision == revision)
  }

  @Test
  func nestedTabTitleAndDirtyMutationsUpdateCanonicalTopology() throws {
    let manager = TerminalTabCollection()
    let tabID = manager.createTab(title: "Terminal")
    let groupID = try #require(
      manager.createGroup(title: "Group", containing: [tabID])
    ).groupID

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
    let manager = TerminalTabCollection()
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
    #expect(manager.selectedTabID == tab.id)
  }

  @Test
  func transferMovesTabsAtomicallyAndSelectsTheFirstMovedTab() throws {
    let source = TerminalTabCollection()
    let first = source.createTab(title: "First")
    let second = source.createTab(title: "Second")
    source.selectTab(first)
    let destination = TerminalTabCollection()
    let existing = destination.createTab(title: "Existing")
    let request = TerminalTabTransferRequest(
      expectedSourceRevision: source.topologyRevision,
      expectedDestinationRevision: destination.topologyRevision,
      itemIDs: [.tab(first), .tab(second)],
      destination: .root(TerminalRootPlacement(isPinned: false, index: 1))
    )

    let plan = try TerminalTabCollection.prepareTransfer(
      request,
      from: source,
      to: destination
    )

    #expect(source.tabs.map(\.id) == [first, second])
    #expect(destination.tabs.map(\.id) == [existing])

    let result = try TerminalTabCollection.commitTransfer(
      plan,
      from: source,
      to: destination
    )

    #expect(source.tabs.isEmpty)
    #expect(source.selectedTabID == nil)
    #expect(destination.tabs.map(\.id) == [existing, first, second])
    #expect(destination.selectedTabID == first)
    #expect(result.tabIDs == [first, second])
    #expect(source.topologyRevision == request.expectedSourceRevision + 1)
    #expect(destination.topologyRevision == request.expectedDestinationRevision + 1)
  }

  @Test
  func transferPreservesGroupIdentityMetadataAndChildOrder() throws {
    let source = TerminalTabCollection()
    let first = source.createTab(title: "First")
    let second = source.createTab(title: "Second")
    let groupID = try #require(
      source.createGroup(title: "Build", color: .purple, containing: [second, first])
    ).groupID
    let destination = TerminalTabCollection()
    let request = TerminalTabTransferRequest(
      expectedSourceRevision: source.topologyRevision,
      expectedDestinationRevision: destination.topologyRevision,
      itemIDs: [.group(groupID)],
      destination: .root(TerminalRootPlacement(isPinned: true, index: 0))
    )

    let plan = try TerminalTabCollection.prepareTransfer(
      request,
      from: source,
      to: destination
    )
    let result = try TerminalTabCollection.commitTransfer(
      plan,
      from: source,
      to: destination
    )
    let group = try #require(destination.group(for: groupID))

    #expect(source.rootItems.isEmpty)
    #expect(destination.rootItems.map(\.id) == [.group(groupID)])
    #expect(group.title == "Build")
    #expect(group.color == .purple)
    #expect(group.isPinned)
    #expect(group.tabs.map(\.id) == [second, first])
    #expect(result.tabIDs == [second, first])
  }

  @Test
  func transferCommitRejectsAChangedSourceWithoutApplyingThePlan() throws {
    let source = TerminalTabCollection()
    let tabID = source.createTab(title: "Source")
    let destination = TerminalTabCollection()
    let plan = try TerminalTabCollection.prepareTransfer(
      TerminalTabTransferRequest(
        expectedSourceRevision: source.topologyRevision,
        expectedDestinationRevision: destination.topologyRevision,
        itemIDs: [.tab(tabID)],
        destination: .root(TerminalRootPlacement(isPinned: false, index: 0))
      ),
      from: source,
      to: destination
    )
    let expectedRevision = source.topologyRevision
    _ = source.createTab(title: "Later")

    #expect(
      throws: TerminalTabTransferError.staleSource(
        expected: expectedRevision,
        actual: source.topologyRevision
      )
    ) {
      try TerminalTabCollection.commitTransfer(plan, from: source, to: destination)
    }
    #expect(source.tabs.count == 2)
    #expect(destination.tabs.isEmpty)
  }

  @Test
  func transferRejectsTabIdentityCollisionsBeforeMutation() {
    let tab = TerminalTabItem(title: "Shared")
    let source = TerminalTabCollection()
    source.restoreRootItems(
      [.tab(TerminalUngroupedTabItem(tab: tab, isPinned: false))],
      selectedTabID: tab.id
    )
    let destination = TerminalTabCollection()
    destination.restoreRootItems(
      [.tab(TerminalUngroupedTabItem(tab: tab, isPinned: false))],
      selectedTabID: tab.id
    )

    #expect(throws: TerminalTabTransferError.destinationContainsTab(tab.id)) {
      try TerminalTabCollection.prepareTransfer(
        TerminalTabTransferRequest(
          expectedSourceRevision: source.topologyRevision,
          expectedDestinationRevision: destination.topologyRevision,
          itemIDs: [.tab(tab.id)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 1))
        ),
        from: source,
        to: destination
      )
    }
    #expect(source.tabs.map(\.id) == [tab.id])
    #expect(destination.tabs.map(\.id) == [tab.id])
  }
}
