import CoreGraphics
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
      placeholder: .beforeFooter
    )

    #expect(
      plan.command(for: payload)
        == TerminalSidebarDropCommand(
          operationID: payload.operationID,
          topologyStamp: payload.topologyStamp,
          itemIDs: [.tab(first), .tab(second)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 2))
        )
    )
  }

  @Test
  func rootTabTargetReordersAndProjectHeaderAppends() throws {
    let source = TerminalTabID()
    let target = TerminalTabID()
    let child = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))

    let reorder = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootBoundary(lane: .regular, index: 0),
      outline: outline
    )
    let entry = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .groupEntry(groupID),
      outline: outline
    )
    let end = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .project(projectID, index: 1),
      outline: outline
    )

    #expect(reorder?.destination == .root(isPinned: false, index: 0))
    #expect(reorder?.placeholder == .before(.tab(target)))
    #expect(append?.destination == .project(projectID, index: 1))
    #expect(append?.placeholder == .projectEnd(projectID))
    #expect(append?.highlightedProjectID == projectID)
    #expect(end?.destination == .project(projectID, index: 1))
    #expect(end?.placeholder == .projectEnd(projectID))
  }

  @Test
  @MainActor
  func ordinaryRootRowsKeepCandidateSlotsFromEitherDirection() throws {
    func expectMove(
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
          collapsedGroupIDs: []
        )
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
          == .rootItem(
            lane: .regular,
            index: candidateIndex,
            id: .tab(tabs[candidateIndex])
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

      #expect(
        plan.destination == .root(isPinned: false, index: destinationIndex)
      )
      #expect(placeholderFrame.minY == candidateFrame.minY)

      let command = try #require(plan.command(for: payload))
      _ = try collection.move(
        TerminalTabMoveRequest(
          operationID: command.operationID,
          expectedTopologyRevision: command.topologyStamp.revision,
          itemIDs: command.itemIDs,
          destination: command.destination
        )
      )

      #expect(
        collection.rootItems.map(\.id)
          == expectedOrder.map { TerminalTabRootItemID.tab(tabs[$0]) }
      )
    }

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

  @Test
  func wholeGroupUsesTheNaturalRootItemCandidate() throws {
    let child = TerminalTabID()
    let target = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
      ],
      revision: 1
    )
    let payload = try #require(outline.dragPayload(for: .group(groupID)))
    let plan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootItem(lane: .regular, index: 1, id: .tab(target)),
      outline: outline
    )

    #expect(plan?.destination == .root(isPinned: false, index: 1))
    #expect(plan?.placeholder == .beforeFooter)
    #expect(plan?.command(for: payload)?.itemIDs == [.group(groupID)])
  }

  @Test
  func straddledItemCandidatesAreRejectedWithoutADragAnchor() throws {
    let tabs = (0..<4).map { _ in TerminalTabID() }
    let rootOutline = TerminalSidebarTestFixture.outline(
      roots: tabs.map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 1
    )
    let rootPayload = try #require(
      rootOutline.dragPayload(
        for: .tab(tabs[0]),
        selectedTabIDs: [tabs[0], tabs[2]]
      )
    )
    let groupID = TerminalTabGroupID()
    let groupOutline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, tabs),
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
        path: .rootItem(lane: .regular, index: 1, id: .tab(tabs[1])),
        outline: rootOutline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .groupItem(groupID, index: 1, id: tabs[1]),
        outline: groupOutline
      ) == nil
    )
  }

  @Test
  @MainActor
  func rootCandidateTracksAutomaticGroupDeletionForABatch() throws {
    let collection = TerminalTabCollection()
    let tabs = ["A", "B", "C", "D"].map { collection.createTab(title: $0) }
    _ = try #require(collection.createGroup(title: "Group", containing: [tabs[0], tabs[1]]))
    let outline = TerminalSidebarOutline(
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSidebarTestFixture.primarySpaceID,
        collection: collection.snapshot,
        collapsedGroupIDs: []
      )
    )
    let payload = try #require(
      outline.dragPayload(
        for: .tab(tabs[0]),
        selectedTabIDs: [tabs[0], tabs[1]]
      )
    )
    let plan = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .rootItem(lane: .regular, index: 1, id: .tab(tabs[2])),
        outline: outline
      )
    )
    let command = try #require(plan.command(for: payload))

    #expect(plan.destination == .root(isPinned: false, index: 1))
    _ = try collection.move(
      TerminalTabMoveRequest(
        operationID: command.operationID,
        expectedTopologyRevision: command.topologyStamp.revision,
        itemIDs: command.itemIDs,
        destination: command.destination
      )
    )
    #expect(
      collection.rootItems.map(\.id)
        == [tabs[2], tabs[0], tabs[1], tabs[3]].map(TerminalTabRootItemID.tab)
    )
  }

  @Test
  func pinnedRootItemUsesItsLaneLocalOrdinal() throws {
    let pinnedTarget = TerminalTabID()
    let source = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(pinnedTarget), isPinned: true),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 1
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let plan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootItem(lane: .pinned, index: 0, id: .tab(pinnedTarget)),
      outline: outline
    )

    #expect(plan?.destination == .root(isPinned: true, index: 0))
    #expect(plan?.placeholder == .before(.tab(pinnedTarget)))
  }

  @Test
  func groupEntryAndTrailingBoundaryStayDistinct() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let source = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .green, .automatic, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 1
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let entry = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .groupEntry(groupID),
      outline: outline
    )
    let trailing = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .groupBoundary(groupID, index: 2),
      outline: outline
    )

    #expect(entry?.destination == .group(groupID, index: 0))
    #expect(entry?.placeholder == .before(.tab(first)))
    #expect(entry?.highlightedGroupID == groupID)
    #expect(trailing?.destination == .group(groupID, index: 2))
    #expect(trailing?.placeholder == .groupEnd(groupID))
    #expect(trailing?.highlightedGroupID == nil)
  }

  @Test
  func itemCandidatesRequireMatchingUnliftedStableIDs() throws {
    let rootTarget = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let rootSource = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(rootTarget), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .purple, .automatic, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(rootSource), isPinned: false),
      ],
      revision: 1
    )
    let rootPayload = try #require(outline.dragPayload(for: .tab(rootSource)))
    let groupPayload = try #require(outline.dragPayload(for: .tab(first)))

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: rootPayload,
        path: .rootItem(lane: .regular, index: 0, id: .group(groupID)),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: rootPayload,
        path: .rootItem(lane: .regular, index: 2, id: .tab(rootSource)),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .groupItem(groupID, index: 0, id: second),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .groupItem(groupID, index: 0, id: first),
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
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 4
    )
    let payload = TerminalSidebarTestFixture.payload(source: .tabs([source]), revision: 3)

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .rootItem(lane: .regular, index: 0, id: .tab(target)),
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
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let path = TerminalSidebarSemanticPath.rootBoundary(lane: .regular, index: 1)
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
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
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
      )?.destination == .root(isPinned: false, index: 1)
    )
  }

  @Test
  func durableEmptyProjectAndPinnedLanesRemainAddressable() throws {
    let pinned = TerminalTabID()
    let source = TerminalTabID()
    let emptyProject = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(pinned), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .project(emptyProject, .neutral, []),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 6
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .project(emptyProject, index: 0),
        outline: outline
      )?.destination == .project(emptyProject, index: 0)
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .rootBoundary(lane: .pinned, index: 1),
        outline: outline
      )?.destination == .root(isPinned: true, index: 1)
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .rootBoundary(lane: .regular, index: 2),
        outline: outline
      ) == nil
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
        path: .project(projectID, index: 0),
        outline: outline
      ) == nil
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .project(projectID, index: 3),
        outline: outline
      )?.destination == .project(projectID, index: 1)
    )
  }

  @Test
  @MainActor
  func ordinaryGroupRowsKeepCandidateSlotsFromEitherDirection() throws {
    func expectMove(
      sourceIndices: [Int],
      candidateIndex: Int,
      destinationIndex: Int,
      expectedOrder: [Int]
    ) throws {
      let collection = TerminalTabCollection()
      let tabs = ["A", "B", "C", "D"].map {
        collection.createTab(title: $0)
      }
      let groupID = try #require(
        collection.createGroup(title: "Group", containing: tabs)
      ).groupID
      let outline = TerminalSidebarOutline(
        snapshot: TerminalTabSurfaceSnapshot(
          spaceID: TerminalSidebarTestFixture.primarySpaceID,
          collection: collection.snapshot,
          collapsedGroupIDs: []
        )
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
          == .groupItem(
            groupID,
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

      #expect(plan.destination == .group(groupID, index: destinationIndex))
      #expect(placeholderFrame.minY == candidateFrame.minY)

      let command = try #require(plan.command(for: payload))
      _ = try collection.move(
        TerminalTabMoveRequest(
          operationID: command.operationID,
          expectedTopologyRevision: command.topologyStamp.revision,
          itemIDs: command.itemIDs,
          destination: command.destination
        )
      )

      #expect(collection.tabIDs(in: groupID) == expectedOrder.map { tabs[$0] })
    }

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
}
