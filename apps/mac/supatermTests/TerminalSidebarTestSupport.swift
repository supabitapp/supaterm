import Foundation

@testable import supaterm

enum TerminalSidebarTestFixture {
  static let primarySpaceID = TerminalSpaceID(
    rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
  )
  static let secondarySpaceID = TerminalSpaceID(
    rawValue: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
  )

  static func outline(
    roots: [TerminalSidebarOutline.Root],
    revision: UInt64,
    spaceID: TerminalSpaceID = primarySpaceID,
    collapsedGroupIDs: Set<TerminalTabGroupID> = []
  ) -> TerminalSidebarOutline {
    TerminalSidebarOutline(
      roots: roots,
      collapsedGroupIDs: collapsedGroupIDs,
      topologyRevision: revision,
      spaceID: spaceID
    )
  }

  static func layoutPlan(
    outline: TerminalSidebarOutline,
    draggingItemIDs: [TerminalSidebarEntryID] = [],
    preferredHeights: [TerminalSidebarEntryID: CGFloat]? = nil,
    target: TerminalSidebarDropPlan? = nil,
    width: CGFloat = 220,
    viewportHeight: CGFloat = 300
  ) -> TerminalSidebarLayoutPlan {
    TerminalSidebarLayoutPlan(
      outline: outline,
      preferredHeights: preferredHeights
        ?? Dictionary(uniqueKeysWithValues: outline.visibleEntries.map { ($0.id, CGFloat(37)) }),
      dragDropState: draggingItemIDs.isEmpty
        ? nil
        : TerminalSidebarDragDropState(draggingItemIDs: draggingItemIDs, target: target),
      width: width,
      viewportHeight: viewportHeight
    )
  }

  static func payload(
    source: TerminalSidebarDragSource,
    revision: UInt64,
    operationID: TerminalTabMoveOperationID = TerminalTabMoveOperationID()
  ) -> TerminalSidebarDragPayload {
    TerminalSidebarDragPayload(
      operationID: operationID,
      source: source,
      topologyStamp: TerminalSidebarTopologyStamp(
        spaceID: primarySpaceID,
        revision: revision
      )
    )
  }

  static func moveReceipt(
    payload: TerminalSidebarDragPayload,
    destination: TerminalTabPlacement,
    revision: UInt64,
    deletedEmptyGroupIDs: [TerminalTabGroupID] = []
  ) -> TerminalSidebarDropReceipt {
    TerminalSidebarDropReceipt(
      spaceID: payload.topologyStamp.spaceID,
      result: TerminalTabMoveResult(
        operationID: payload.operationID,
        itemIDs: payload.source.itemIDs,
        location: destination,
        deletedEmptyGroupIDs: deletedEmptyGroupIDs,
        topologyRevision: revision
      )
    )
  }

  static func completedCoordinator(
    source: TerminalSidebarDragSource,
    sourceRevision: UInt64,
    receiptRevision: UInt64,
    destination: TerminalTabPlacement
  ) -> TerminalSidebarDragCoordinator {
    let payload = payload(source: source, revision: sourceRevision)
    let dropDestination: TerminalSidebarDropDestination
    switch destination {
    case .root(let placement):
      dropDestination = .root(isPinned: placement.isPinned, index: placement.index)
    case .group(let groupID, let index):
      dropDestination = .group(groupID, index: index)
    }
    var coordinator = TerminalSidebarDragCoordinator(payload: payload)
    let plan = TerminalSidebarDropPlan(
      path: .trailingRoot,
      destination: dropDestination,
      placeholder: .beforeFooter
    )
    precondition(coordinator.freeze(plan) != nil)
    precondition(
      coordinator.complete(
        moveReceipt(
          payload: payload,
          destination: destination,
          revision: receiptRevision
        )
      )
    )
    return coordinator
  }
}
