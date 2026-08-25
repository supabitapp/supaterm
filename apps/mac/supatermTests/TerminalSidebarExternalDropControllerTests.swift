import Foundation
import Testing

@testable import supaterm

struct SidebarExternalDropControllerTests {
  @Test
  func commandRequiresTheHoveredTopology() throws {
    let existingTabID = TerminalTabID()
    let draggedTabID = TerminalTabID()
    let operationID = TerminalTabMoveOperationID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(existingTabID), isPinned: false)
      ],
      revision: 4
    )
    let plannedPayload = TerminalSidebarTestFixture.payload(
      source: .tabs([draggedTabID]),
      revision: 4,
      operationID: operationID
    )
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: operationID,
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSidebarTestFixture.secondarySpaceID,
        sourceTopologyRevision: 2,
        orderedProjectIDs: [],
        itemIDs: [.tab(draggedTabID)]
      )
    )
    let target = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: plannedPayload,
        path: .trailingRoot,
        outline: outline
      )
    )
    let drop = TerminalSidebarExternalDrop(
      payload: payload,
      topologyStamp: plannedPayload.topologyStamp,
      target: target
    )
    let changedOutline = TerminalSidebarTestFixture.outline(
      roots: outline.roots,
      revision: 5
    )

    #expect(
      drop.command(in: outline)
        == TerminalSidebarDropCommand(
          operationID: plannedPayload.operationID,
          topologyStamp: plannedPayload.topologyStamp,
          itemIDs: [.tab(draggedTabID)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 1))
        )
    )
    #expect(drop.command(in: changedOutline) == nil)
  }
}
