import Testing

@testable import supaterm

struct TerminalSidebarDropPlanningTests {
  @Test
  func payloadStoresOneSemanticSourceAndDerivesLiftedRows() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .red, .automatic, [first, second]),
          isPinned: false
        )
      ],
      revision: 9
    )

    let payload = try #require(outline.dragPayload(for: .group(groupID)))

    #expect(payload.source == .group(groupID))
    #expect(payload.source.itemID == .group(groupID))
    #expect(outline.liftedEntryIDs(for: payload.source) == [.group(groupID), .tab(first), .tab(second)])
    #expect(payload.topologyRevision == 9)
  }

  @Test
  func plansFreezeIntoOneMoveOrCreateGroupCommand() throws {
    let source = TerminalTabID()
    let target = TerminalTabID()
    let payload = TerminalSidebarTestFixture.payload(source: .tab(source), revision: 4)
    let move = TerminalSidebarDropPlan(
      path: .trailingRoot,
      destination: .root(isPinned: false, index: 2),
      placeholder: .beforeFooter
    )
    let create = TerminalSidebarDropPlan(
      path: .rootItem(index: 0),
      destination: .createGroup(targetTabID: target),
      placeholder: .tabHighlight(target)
    )

    #expect(
      move.command(for: payload)
        == .move(
          operationID: payload.operationID,
          topologyStamp: payload.topologyStamp,
          itemID: .tab(source),
          destination: .root(TerminalRootPlacement(isPinned: false, index: 2))
        )
    )
    #expect(
      create.command(for: payload)
        == .createGroup(
          operationID: payload.operationID,
          topologyStamp: payload.topologyStamp,
          sourceTabID: source,
          targetTabID: target
        )
    )
  }

  @Test
  func tabRootTargetCreatesGroupWhileGroupRootTargetReorders() throws {
    let sourceTab = TerminalTabID()
    let targetTab = TerminalTabID()
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(targetTab), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(sourceTab), isPinned: false),
      ],
      revision: 3
    )

    let tabPayload = try #require(outline.dragPayload(for: .tab(sourceTab)))
    let groupPayload = try #require(outline.dragPayload(for: .group(groupID)))

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: tabPayload,
        path: .rootItem(index: 0),
        outline: outline
      )?.destination == .createGroup(targetTabID: targetTab)
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .rootItem(index: 0),
        outline: outline
      )?.destination == .root(isPinned: false, index: 0)
    )
  }

  @Test
  func automaticLastChildExitUsesPostRemovalRootIndex() throws {
    let source = TerminalTabID()
    let tail = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .green, .automatic, [source]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
      ],
      revision: 5
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .trailingRoot,
        outline: outline
      )?.destination == .root(isPinned: false, index: 1)
    )
  }

  @Test
  func durableEmptyGroupAndPinnedLanesRemainAddressable() throws {
    let pinned = TerminalTabID()
    let source = TerminalTabID()
    let emptyGroup = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(pinned), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .group(emptyGroup, .neutral, .durable, []),
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
        path: .group(emptyGroup, index: 0),
        outline: outline
      )?.destination == .group(emptyGroup, index: 0)
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
      )?.destination == .root(isPinned: false, index: 1)
    )
  }
}
