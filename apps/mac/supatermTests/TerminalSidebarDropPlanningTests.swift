import CoreGraphics
import CustomDump
import SupaTheme
import Testing

@testable import supaterm

struct TerminalSidebarDropPlanningTests {
  @Test
  func payloadStoresOrderedTabsOrOneProjectAndDerivesLiftedRows() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .red, [first, second]),
          isPinned: false
        )
      ],
      revision: 9
    )

    let tabs = try #require(
      outline.dragPayload(for: .tab(second), selectedTabIDs: [first, second])
    )
    let project = try #require(outline.dragPayload(for: .project(projectID)))

    #expect(tabs.source == .tabs([first, second]))
    #expect(tabs.source.itemIDs == [.tab(first), .tab(second)])
    #expect(outline.liftedEntryIDs(for: tabs.source) == [.tab(first), .tab(second)])
    #expect(project.source == .project(projectID))
    #expect(project.source.itemIDs == [.project(projectID)])
    #expect(outline.liftedEntryIDs(for: project.source) == [.project(projectID), .tab(first), .tab(second)])
    #expect(project.topologyRevision == 9)
  }

  @Test
  func planFreezesIntoOneOrderedMoveCommand() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let payload = TerminalSidebarTestFixture.payload(
      source: .tabs([first, second]),
      revision: 4
    )
    let plan = TerminalSidebarDropPlan(
      path: .rootBoundary(lane: .regular, index: 2),
      destination: .root(isPinned: false, index: 2),
      placeholder: .beforeFooter,
      operation: .move(TerminalTabPlacement(projectID: nil, isPinned: false, index: 2))
    )

    #expect(
      plan.command(for: payload)
        == TerminalSidebarDropCommand(
          operationID: payload.operationID,
          topologyStamp: payload.topologyStamp,
          itemIDs: [.tab(first), .tab(second)],
          operation: .move(
            TerminalTabPlacement(projectID: nil, isPinned: false, index: 2)
          )
        )
    )
  }

  @Test
  func unassignedTargetReordersAndProjectHeaderAppends() throws {
    let source = TerminalTabID()
    let target = TerminalTabID()
    let child = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .unassigned([target, source]),
          isPinned: false
        ),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))

    let reorder = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .unassignedItem(index: 0, id: target),
      outline: outline
    )
    let entry = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .projectEntry(projectID),
      outline: outline
    )
    let end = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .projectBoundary(projectID, index: 1),
      outline: outline
    )

    #expect(reorder?.destination == .unassigned(index: 0))
    #expect(reorder?.placeholder == .before(.tab(target)))
    #expect(entry?.destination == .project(projectID, index: 0))
    #expect(entry?.placeholder == .before(.tab(child)))
    #expect(entry?.highlightedProjectID == projectID)
    #expect(end?.destination == .project(projectID, index: 1))
    #expect(end?.placeholder == .projectEnd(projectID))
  }

  @Test
  @MainActor
  func ordinaryRootRowsKeepCandidateSlotsFromEitherDirection() throws {
    try expectMove(
      sourceIndices: [0],
      candidateIndex: 1,
      destinationIndex: 1,
      expectedOrder: [1, 0, 2, 3]
    )
    try expectMove(
      sourceIndices: [3],
      candidateIndex: 2,
      destinationIndex: 2,
      expectedOrder: [0, 1, 3, 2]
    )
    try expectMove(
      sourceIndices: [0, 1],
      candidateIndex: 2,
      destinationIndex: 1,
      expectedOrder: [2, 0, 1, 3]
    )
    try expectMove(
      sourceIndices: [2, 3],
      candidateIndex: 1,
      destinationIndex: 1,
      expectedOrder: [0, 2, 3, 1]
    )
  }

  @MainActor
  private func expectMove(
    sourceIndices: [Int],
    candidateIndex: Int,
    destinationIndex: Int,
    expectedOrder: [Int]
  ) throws {
    let collection = TerminalTabCollection()
    let tabs = ["A", "B", "C", "D"].map {
      collection.createTab(title: $0)
    }
    let outline = TerminalSidebarOutline(
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSidebarTestFixture.primarySpaceID,
        collection: collection.snapshot,
        collapsedProjectIDs: [],
        isUnassignedCollapsed: false
      ),
      projects: []
    )
    let payload = try #require(
      outline.dragPayload(
        for: .tab(tabs[sourceIndices[0]]),
        selectedTabIDs: sourceIndices.map { tabs[$0] }
      )
    )
    let draggingItemIDs = sourceIndices.map { TerminalSidebarEntryID.tab(tabs[$0]) }
    let baselineLayout = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let dragLayout = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: draggingItemIDs
    )
    let candidateFrame = try #require(
      baselineLayout.items.first { $0.id == .tab(tabs[candidateIndex]) }?.frame
    )
    let path = try #require(
      dragLayout.semanticTarget(at: candidateFrame.midY)?.path
    )
    #expect(
      path
        == .unassignedItem(
          index: candidateIndex,
          id: tabs[candidateIndex]
        )
    )
    let plan = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: path,
        outline: outline
      )
    )
    let projectedLayout = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: draggingItemIDs,
      target: plan
    )
    let placeholderFrame = try #require(projectedLayout.dropPlaceholderFrame)

    #expect(plan.destination == .unassigned(index: destinationIndex))
    #expect(placeholderFrame.minY == candidateFrame.minY)
    #expect(
      plan.operation
        == .move(
          TerminalTabPlacement(projectID: nil, isPinned: false, index: destinationIndex)
        )
    )

    _ = try collection.move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: payload.topologyStamp.revision,
        orderedProjectIDs: [],
        tabIDs: sourceIndices.map { tabs[$0] },
        destination: TerminalTabPlacement(
          projectID: nil,
          isPinned: false,
          index: destinationIndex
        )
      )
    )
    #expect(collection.snapshot.regularTabs.map(\.id) == expectedOrder.map { tabs[$0] })
  }

  @Test
  func wholeGroupUsesTheNaturalRootItemCandidate() throws {
    let child = TerminalTabID()
    let targetChild = TerminalTabID()
    let groupID = TerminalProjectID()
    let targetProjectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(groupID, .blue, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .project(targetProjectID, .green, [targetChild]),
          isPinned: false
        ),
      ],
      revision: 1
    )
    let payload = try #require(outline.dragPayload(for: .project(groupID)))
    let plan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootItem(lane: .regular, index: 1, id: .project(targetProjectID)),
      outline: outline
    )

    #expect(plan?.destination == .root(isPinned: false, index: 1))
    #expect(plan?.placeholder == .beforeFooter)
    #expect(plan?.command(for: payload)?.itemIDs == [.project(groupID)])
  }

  @Test
  func straddledItemCandidatesAreRejectedWithoutADragAnchor() throws {
    let tabs = (0..<4).map { _ in TerminalTabID() }
    let rootOutline = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .unassigned(tabs), isPinned: false)],
      revision: 1
    )
    let rootPayload = try #require(
      rootOutline.dragPayload(
        for: .tab(tabs[0]),
        selectedTabIDs: [tabs[0], tabs[2]]
      )
    )
    let groupID = TerminalProjectID()
    let groupOutline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(groupID, .blue, tabs),
          isPinned: false
        )
      ],
      revision: 1
    )
    let groupPayload = try #require(
      groupOutline.dragPayload(
        for: .tab(tabs[0]),
        selectedTabIDs: [tabs[0], tabs[2]]
      )
    )

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: rootPayload,
        path: .unassignedItem(index: 1, id: tabs[1]),
        outline: rootOutline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .projectItem(groupID, index: 1, id: tabs[1]),
        outline: groupOutline
      ) == nil
    )
  }

  @Test
  func pinnedRootItemUsesItsLaneLocalOrdinal() throws {
    let pinnedTarget = TerminalTabID()
    let source = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .unassigned([pinnedTarget, source]),
          isPinned: false
        )
      ],
      revision: 1,
      pinnedTabIDs: [pinnedTarget]
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let plan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .unassignedItem(index: 0, id: pinnedTarget),
      outline: outline
    )

    #expect(plan?.destination == .unassigned(index: 0))
    #expect(plan?.placeholder == .before(.tab(pinnedTarget)))
  }

  @Test
  func groupEntryAndTrailingBoundaryStayDistinct() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let source = TerminalTabID()
    let groupID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(groupID, .green, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .unassigned([source]), isPinned: false),
      ],
      revision: 1
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let entry = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .projectEntry(groupID),
      outline: outline
    )
    let trailing = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .projectBoundary(groupID, index: 2),
      outline: outline
    )

    #expect(entry?.destination == .project(groupID, index: 0))
    #expect(entry?.placeholder == .before(.tab(first)))
    #expect(entry?.highlightedProjectID == groupID)
    #expect(trailing?.destination == .project(groupID, index: 2))
    #expect(trailing?.placeholder == .projectEnd(groupID))
    #expect(trailing?.highlightedProjectID == nil)
  }

  @Test
  func itemCandidatesRequireMatchingUnliftedStableIDs() throws {
    let rootTarget = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let rootSource = TerminalTabID()
    let groupID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(groupID, .purple, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .unassigned([rootTarget, rootSource]),
          isPinned: false
        ),
      ],
      revision: 1
    )
    let rootPayload = try #require(outline.dragPayload(for: .tab(rootSource)))
    let groupPayload = try #require(outline.dragPayload(for: .tab(first)))

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: rootPayload,
        path: .rootItem(lane: .regular, index: 0, id: .project(groupID)),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: rootPayload,
        path: .unassignedItem(index: 1, id: rootSource),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .projectItem(groupID, index: 0, id: second),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .projectItem(groupID, index: 0, id: first),
        outline: outline
      ) == nil
    )
  }

  @Test
  func staleTopologyRejectsCandidate() throws {
    let source = TerminalTabID()
    let target = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .unassigned([target, source]), isPinned: false)
      ],
      revision: 4
    )
    let payload = TerminalSidebarTestFixture.payload(source: .tabs([source]), revision: 3)

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .unassignedItem(index: 0, id: target),
        outline: outline
      ) == nil
    )
  }

  @Test
  func noOpDropResolutionKeepsItsSemanticPathForFeedback() throws {
    let child = TerminalTabID()
    let source = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .unassigned([source]), isPinned: false),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let path = TerminalSidebarSemanticPath.unassignedBoundary(index: 1)
    let resolution = TerminalSidebarDropResolution(
      payload: payload,
      path: path,
      outline: outline
    )

    #expect(resolution.path == path)
    #expect(resolution.plan == nil)
  }

  @Test
  func dropHandoffAcceptsOnlyTheCommittedSpaceAndRevision() {
    let handoff = TerminalSidebarDropHandoff(
      topologyStamp: TerminalSidebarTopologyStamp(
        spaceID: TerminalSidebarTestFixture.primarySpaceID,
        revision: 8
      ),
      revisionRequirement: .sameOrNewer
    )

    #expect(!handoff.accepts(nil))
    #expect(
      !handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 7
        )
      )
    )
    #expect(
      !handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.secondarySpaceID,
          revision: 8
        )
      )
    )
    #expect(
      handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 8
        )
      )
    )
    #expect(
      handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 9
        )
      )
    )
  }

  @Test
  func projectDropHandoffRequiresTheCommittedCatalogOrder() {
    let first = TerminalProjectID()
    let second = TerminalProjectID()
    let handoff = TerminalSidebarDropHandoff(
      topologyStamp: TerminalSidebarTopologyStamp(
        spaceID: TerminalSidebarTestFixture.primarySpaceID,
        revision: 8,
        orderedProjectIDs: [second, first]
      ),
      revisionRequirement: .sameOrNewer
    )

    #expect(
      !handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 8,
          orderedProjectIDs: [first, second]
        )
      )
    )
    #expect(
      handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 8,
          orderedProjectIDs: [second, first]
        )
      )
    )
  }

  @Test
  func retainedSourceHandoffAcceptsTheSameTopologyRevision() {
    let handoff = TerminalSidebarDropHandoff(
      topologyStamp: TerminalSidebarTopologyStamp(
        spaceID: TerminalSidebarTestFixture.primarySpaceID,
        revision: 8
      ),
      revisionRequirement: .sameOrNewer
    )

    #expect(
      handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 8
        )
      )
    )
    #expect(
      handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 9
        )
      )
    )
  }

  @Test
  func removedSourceHandoffRequiresANewerTopologyRevision() {
    let handoff = TerminalSidebarDropHandoff(
      topologyStamp: TerminalSidebarTopologyStamp(
        spaceID: TerminalSidebarTestFixture.primarySpaceID,
        revision: 8
      ),
      revisionRequirement: .newer
    )

    #expect(
      !handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 8
        )
      )
    )
    #expect(
      handoff.accepts(
        TerminalSidebarTopologyStamp(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          revision: 9
        )
      )
    )
  }

  @Test
  func mixedBatchUsesPostRemovalIndexesAndDeletesAutomaticSources() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let tail = TerminalTabID()
    let firstProject = TerminalProjectID()
    let secondProject = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(firstProject, .green, [first]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .project(secondProject, .blue, [second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .unassigned([tail]), isPinned: false),
      ],
      revision: 5
    )
    let payload = try #require(
      outline.dragPayload(for: .tab(first), selectedTabIDs: [first, second])
    )

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .rootBoundary(lane: .regular, index: 3),
        outline: outline
      )?.operation
        == .move(TerminalTabPlacement(projectID: nil, isPinned: false, index: 1))
    )
  }

  @Test
  func projectTrailingDropDoesNotCountUnassignedAsAProject() throws {
    let firstProject = TerminalProjectID()
    let secondProject = TerminalProjectID()
    let thirdProject = TerminalProjectID()
    let unassignedTab = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(firstProject, .red, []),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .project(secondProject, .blue, []),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .project(thirdProject, .green, []),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .unassigned([unassignedTab]),
          isPinned: false
        ),
      ],
      revision: 7
    )
    let payload = try #require(outline.dragPayload(for: .project(firstProject)))

    let trailingPlan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootBoundary(lane: .regular, index: 3),
      outline: outline
    )

    expectNoDifference(
      trailingPlan?.operation,
      .reorderProject(TerminalRootPlacement(isPinned: false, index: 2))
    )
  }

  @Test
  func durableEmptyProjectAndPinnedLanesRemainAddressable() throws {
    let pinned = TerminalTabID()
    let source = TerminalTabID()
    let emptyProject = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(emptyProject, .neutral, []),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .unassigned([pinned, source]),
          isPinned: false
        ),
      ],
      revision: 6,
      pinnedTabIDs: [pinned]
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .projectBoundary(emptyProject, index: 0),
        outline: outline
      )?.destination == .project(emptyProject, index: 0)
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .unassignedItem(index: 0, id: pinned),
        outline: outline
      )?.destination == .unassigned(index: 0)
    )
  }

  @Test
  func sameProjectBatchRejectsAnExactNoOp() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .purple, [first, second, third]),
          isPinned: false
        )
      ],
      revision: 2
    )
    let payload = try #require(
      outline.dragPayload(for: .tab(first), selectedTabIDs: [first, second])
    )

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .projectBoundary(projectID, index: 0),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .projectBoundary(projectID, index: 3),
        outline: outline
      )?.destination == .project(projectID, index: 1)
    )
  }

}
