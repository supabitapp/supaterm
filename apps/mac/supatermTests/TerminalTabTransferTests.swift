import Dependencies
import Sharing
import Testing

@testable import supaterm

@MainActor
struct TerminalTabTransferTests {
  @Test
  func sameWindowTransferMovesTabToProjectWithoutMovingOwnership() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "First"), TerminalSpaceItem(name: "Second")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let host = TerminalHostState.test(managesTerminalSurfaces: false, spaceID: spaces[0].id)
      let source = host.spaceManager.displayedInstance
      let destination = host.spaceManager.instance(warming: spaces[1].id)
      let projectID = TerminalProjectID()
      let tabID = source.tabCollection.createTab(title: "Moved")
      source.tabCollection.selectTab(tabID)
      let request = TerminalTabTransferRequest(
        expectedSourceRevision: source.tabCollection.topologyRevision,
        expectedDestinationRevision: destination.tabCollection.topologyRevision,
        orderedProjectIDs: [projectID],
        tabIDs: [tabID],
        destination: TerminalTabPlacement(projectID: projectID, isPinned: true, index: 0)
      )

      let plan = try TerminalHostState.prepareLiveTabTransfer(
        request,
        from: host,
        sourceSpaceID: spaces[0].id,
        to: host,
        destinationSpaceID: spaces[1].id
      )
      let result = try TerminalHostState.commitLiveTabTransfer(plan, from: host, to: host)

      #expect(result.tabIDs == [tabID])
      #expect(source.tabCollection.canonicalTabs.isEmpty)
      #expect(destination.tabCollection.canonicalTabs.map(\.id) == [tabID])
      #expect(destination.tabCollection.tab(for: tabID)?.projectID == projectID)
      #expect(destination.tabCollection.tab(for: tabID)?.isPinned == true)
      #expect(destination.selectedTabID == tabID)
    }
  }

  @Test
  func staleDestinationRevisionDoesNotMutateEitherSpace() throws {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "First"), TerminalSpaceItem(name: "Second")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let host = TerminalHostState(managesTerminalSurfaces: false, spaceID: spaces[0].id)
      let source = host.spaceManager.displayedInstance
      let destination = host.spaceManager.instance(warming: spaces[1].id)
      let tabID = source.tabCollection.createTab(title: "Moved")
      let sourceSnapshot = source.tabCollection.snapshot
      let destinationSnapshot = destination.tabCollection.snapshot

      #expect(
        throws: TerminalTabTransferError.staleDestination(
          expected: destination.tabCollection.topologyRevision + 1,
          actual: destination.tabCollection.topologyRevision
        )
      ) {
        try TerminalHostState.prepareLiveTabTransfer(
          TerminalTabTransferRequest(
            expectedSourceRevision: source.tabCollection.topologyRevision,
            expectedDestinationRevision: destination.tabCollection.topologyRevision + 1,
            orderedProjectIDs: [],
            tabIDs: [tabID],
            destination: TerminalTabPlacement(projectID: nil, isPinned: false, index: 0)
          ),
          from: host,
          sourceSpaceID: spaces[0].id,
          to: host,
          destinationSpaceID: spaces[1].id
        )
      }
      #expect(source.tabCollection.snapshot == sourceSnapshot)
      #expect(destination.tabCollection.snapshot == destinationSnapshot)
    }
  }
}
