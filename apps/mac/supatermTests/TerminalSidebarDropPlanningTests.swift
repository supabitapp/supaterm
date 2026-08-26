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
      path: .trailingRoot,
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
      path: .unassigned(index: 0),
      outline: outline
    )
    let append = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootItem(index: 0),
      outline: outline
    )
    let end = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .project(projectID, index: 1),
      outline: outline
    )

    #expect(reorder?.destination == .unassigned(index: 0))
    #expect(reorder?.placeholder == .before(.tab(target)))
    #expect(append?.destination == .project(projectID, index: 1))
    #expect(append?.placeholder == .projectEnd(projectID))
    #expect(append?.highlightedProjectID == projectID)
    #expect(end?.destination == .project(projectID, index: 1))
    #expect(end?.placeholder == .projectEnd(projectID))
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
    let path = TerminalSidebarSemanticPath.unassigned(index: 1)
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
        path: .trailingRoot,
        outline: outline
      )?.destination == .root(isPinned: false, index: 1)
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
      path: .trailingRoot,
      outline: outline
    )
    let afterUnassignedPlan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootBoundary(index: 3, affinity: .after),
      outline: outline
    )

    expectNoDifference(
      trailingPlan?.operation,
      .reorderProject(TerminalRootPlacement(isPinned: false, index: 2))
    )
    expectNoDifference(afterUnassignedPlan?.operation, trailingPlan?.operation)
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
        path: .project(emptyProject, index: 0),
        outline: outline
      )?.destination == .project(emptyProject, index: 0)
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .unassigned(index: 0),
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
}
