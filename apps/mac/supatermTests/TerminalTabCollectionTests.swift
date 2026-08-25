import Testing

@testable import supaterm

@MainActor
struct TerminalTabCollectionTests {
  @Test
  func createTabMaintainsFlatPinLanes() {
    let collection = TerminalTabCollection()
    let regular = collection.createTab(title: "Regular")
    let pinned = collection.createTab(title: "Pinned", isPinned: true)

    #expect(collection.snapshot.pinnedTabs.map(\.id) == [pinned])
    #expect(collection.snapshot.regularTabs.map(\.id) == [regular])
    #expect(collection.canonicalTabs.map(\.id) == [pinned, regular])
    #expect(collection.selectedTabID == pinned)
  }

  @Test
  func assignAcrossPinLanesIsOneAtomicRevision() {
    let collection = TerminalTabCollection()
    let projectID = TerminalProjectID()
    let regular = collection.createTab(title: "Regular")
    let pinned = collection.createTab(title: "Pinned", isPinned: true)
    let revision = collection.topologyRevision

    #expect(
      collection.assign(
        [regular, pinned],
        to: projectID,
        orderedProjectIDs: [projectID]
      )
    )

    #expect(collection.topologyRevision == revision + 1)
    #expect(collection.tab(for: regular)?.projectID == projectID)
    #expect(collection.tab(for: regular)?.isPinned == false)
    #expect(collection.tab(for: pinned)?.projectID == projectID)
    #expect(collection.tab(for: pinned)?.isPinned == true)
  }

  @Test
  func assignRejectsDuplicateOrMissingTabsWithoutMutation() {
    let collection = TerminalTabCollection()
    let tabID = collection.createTab(title: "Tab")
    let projectID = TerminalProjectID()
    let snapshot = collection.snapshot

    #expect(!collection.assign([tabID, tabID], to: projectID, orderedProjectIDs: [projectID]))
    #expect(!collection.assign([TerminalTabID()], to: projectID, orderedProjectIDs: [projectID]))
    #expect(collection.snapshot == snapshot)
  }

  @Test
  func moveChangesProjectPinLaneAndSectionIndex() throws {
    let collection = TerminalTabCollection()
    let firstProjectID = TerminalProjectID()
    let secondProjectID = TerminalProjectID()
    let orderedProjectIDs = [firstProjectID, secondProjectID]
    let first = collection.createTab(title: "First", projectID: firstProjectID)
    let second = collection.createTab(title: "Second", projectID: firstProjectID)
    let destination = collection.createTab(title: "Destination", projectID: secondProjectID, isPinned: true)
    let revision = collection.topologyRevision

    let result = try collection.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: revision,
        orderedProjectIDs: orderedProjectIDs,
        tabIDs: [second, first],
        destination: TerminalTabPlacement(
          projectID: secondProjectID,
          isPinned: true,
          index: 1
        )
      )
    )

    #expect(result.tabIDs == [second, first])
    #expect(result.location == TerminalTabPlacement(projectID: secondProjectID, isPinned: true, index: 1))
    #expect(collection.snapshot.pinnedTabs.map(\.id) == [destination, first, second])
    #expect(collection.tab(for: first)?.projectID == secondProjectID)
    #expect(collection.tab(for: second)?.projectID == secondProjectID)
  }

  @Test
  func moveRejectsUnknownProjectAndStaleRevision() {
    let collection = TerminalTabCollection()
    let tabID = collection.createTab(title: "Tab")
    let projectID = TerminalProjectID()

    #expect(throws: TerminalTabMoveError.staleProjects) {
      try collection.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: collection.topologyRevision,
          orderedProjectIDs: [],
          tabIDs: [tabID],
          destination: TerminalTabPlacement(projectID: projectID, isPinned: false, index: 0)
        )
      )
    }
    #expect(
      throws: TerminalTabMoveError.staleTopology(
        expected: collection.topologyRevision - 1,
        actual: collection.topologyRevision
      )
    ) {
      try collection.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: collection.topologyRevision - 1,
          orderedProjectIDs: [],
          tabIDs: [tabID],
          destination: TerminalTabPlacement(projectID: nil, isPinned: false, index: 0)
        )
      )
    }
  }

  @Test
  func pinningTabPreservesProjectMembership() {
    let collection = TerminalTabCollection()
    let projectID = TerminalProjectID()
    let tabID = collection.createTab(title: "Tab", projectID: projectID)

    let result = collection.setTabPinned(
      tabID,
      isPinned: true,
      orderedProjectIDs: [projectID]
    )

    #expect(result?.location == TerminalTabPlacement(projectID: projectID, isPinned: true, index: 0))
    #expect(collection.tab(for: tabID)?.projectID == projectID)
    #expect(collection.tab(for: tabID)?.isPinned == true)
  }

  @Test
  func staleMembershipAppearsInUnassignedWithoutErasingStoredID() {
    let collection = TerminalTabCollection()
    let staleProjectID = TerminalProjectID()
    let tabID = collection.createTab(title: "Tab", projectID: staleProjectID)

    #expect(collection.unassignedSection(orderedProjectIDs: [])?.tabs.map(\.id) == [tabID])
    #expect(collection.tab(for: tabID)?.projectID == staleProjectID)
  }

  @Test
  func closeSelectedTabUsesPresentationOrder() {
    let collection = TerminalTabCollection()
    let projectID = TerminalProjectID()
    let first = collection.createTab(title: "First", projectID: projectID, isPinned: true)
    let second = collection.createTab(title: "Second", projectID: projectID)
    let third = collection.createTab(title: "Third")
    collection.selectTab(second)

    _ = collection.closeTab(second, orderedProjectIDs: [projectID])

    #expect(collection.selectedTabID == third)
    #expect(collection.canonicalTabs.map(\.id) == [first, third])
  }

  @Test
  func restoreDropsDuplicateTabsAndNormalizesPinLanes() {
    let collection = TerminalTabCollection()
    let id = TerminalTabID()
    let regular = TerminalTabItem(id: id, title: "Regular")
    let duplicate = TerminalTabItem(id: id, title: "Duplicate", isPinned: true)
    let pinned = TerminalTabItem(title: "Pinned", isPinned: true)

    collection.restoreTabs([regular, duplicate, pinned], selectedTabID: id)

    #expect(collection.snapshot.pinnedTabs.map(\.id) == [id, pinned.id])
    #expect(collection.snapshot.regularTabs.isEmpty)
    #expect(collection.tab(for: id)?.title == "Duplicate")
    #expect(collection.selectedTabID == id)
  }

  @Test
  func transferMovesTabsAtomicallyToRequestedProjectLane() throws {
    let source = TerminalTabCollection()
    let destination = TerminalTabCollection()
    let projectID = TerminalProjectID()
    let first = source.createTab(title: "First")
    let second = source.createTab(title: "Second", isPinned: true)
    let existing = destination.createTab(title: "Existing", projectID: projectID, isPinned: true)
    let request = TerminalTabTransferRequest(
      expectedSourceRevision: source.topologyRevision,
      expectedDestinationRevision: destination.topologyRevision,
      orderedProjectIDs: [projectID],
      tabIDs: [second, first],
      destination: TerminalTabPlacement(projectID: projectID, isPinned: true, index: 1)
    )

    let plan = try TerminalTabCollection.prepareTransfer(request, from: source, to: destination)
    let result = try TerminalTabCollection.commitTransfer(plan, from: source, to: destination)

    #expect(result.tabIDs == [second, first])
    #expect(source.canonicalTabs.isEmpty)
    #expect(destination.snapshot.pinnedTabs.map(\.id) == [existing, second, first])
    #expect(destination.tab(for: first)?.projectID == projectID)
    #expect(destination.tab(for: second)?.projectID == projectID)
  }
}
