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
      path: .rootBoundary(index: 0, affinity: .before),
      outline: outline
    )
    let append = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .rootItem(index: 1),
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
    let path = TerminalSidebarSemanticPath.rootBoundary(index: 0, affinity: .after)
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
        path: .trailingRoot,
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
        path: .pinnedEnd,
        outline: outline
      )?.destination == .root(isPinned: true, index: 1)
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .trailingRoot,
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
}
