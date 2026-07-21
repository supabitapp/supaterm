import Testing

@testable import supaterm

struct TerminalSidebarDragCoordinatorTests {
  @Test
  func snapshotDispositionSeparatesOlderExactNewerAndIncompatible() {
    let source = TerminalTabID()
    let destination = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: 0)
    )
    let coordinator = TerminalSidebarTestFixture.completedCoordinator(
      source: .tabs([source]),
      sourceRevision: 7,
      receiptRevision: 8,
      destination: destination
    )
    let older = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(source), isPinned: false)],
      revision: 7
    )
    let exact = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(source), isPinned: false)],
      revision: 8
    )
    let newer = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(source), isPinned: false)],
      revision: 9
    )
    let wrongSpace = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(source), isPinned: false)],
      revision: 8,
      spaceID: TerminalSidebarTestFixture.secondarySpaceID
    )
    let mismatchGroup = TerminalTabGroupID()
    let mismatch = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(mismatchGroup, .blue, .automatic, [source]),
          isPinned: false
        )
      ],
      revision: 8
    )
    let missingStamp = TerminalSidebarOutline(
      roots: [],
      collapsedGroupIDs: [],
      topologyRevision: 0
    )

    #expect(coordinator.snapshotDisposition(for: older) == .waiting)
    #expect(coordinator.snapshotDisposition(for: exact) == .exact)
    #expect(coordinator.snapshotDisposition(for: newer) == .superseding)
    #expect(coordinator.snapshotDisposition(for: wrongSpace) == .incompatible)
    #expect(coordinator.snapshotDisposition(for: mismatch) == .incompatible)
    #expect(coordinator.snapshotDisposition(for: missingStamp) == .incompatible)
  }

  @Test
  func exactSnapshotAndNativeEndSettleInEitherOrder() {
    let tabID = TerminalTabID()
    let destination = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: 0)
    )
    var snapshotFirst = TerminalSidebarTestFixture.completedCoordinator(
      source: .tabs([tabID]),
      sourceRevision: 1,
      receiptRevision: 2,
      destination: destination
    )
    let snapshotFirstResult = snapshotFirst.recordSnapshot(.exact)
    #expect(snapshotFirstResult == nil)
    guard case .accepted = snapshotFirst.nativeEnded() else {
      Issue.record("Expected accepted settlement")
      return
    }
    let duplicateSnapshotFirstEnd = snapshotFirst.nativeEnded()
    #expect(duplicateSnapshotFirstEnd == nil)

    var nativeFirst = TerminalSidebarTestFixture.completedCoordinator(
      source: .tabs([tabID]),
      sourceRevision: 1,
      receiptRevision: 2,
      destination: destination
    )
    let nativeFirstResult = nativeFirst.nativeEnded()
    #expect(nativeFirstResult == nil)
    guard case .accepted = nativeFirst.recordSnapshot(.exact) else {
      Issue.record("Expected accepted settlement")
      return
    }
    let duplicateNativeFirstEnd = nativeFirst.nativeEnded()
    #expect(duplicateNativeFirstEnd == nil)
  }

  @Test
  func newerQueuedAfterExactAlwaysSupersedes() {
    let tabID = TerminalTabID()
    let destination = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: 0)
    )
    var coordinator = TerminalSidebarTestFixture.completedCoordinator(
      source: .tabs([tabID]),
      sourceRevision: 10,
      receiptRevision: 11,
      destination: destination
    )
    let exact = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 11
    )
    let newer = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 12
    )

    #expect(coordinator.snapshotDisposition(for: exact) == .exact)
    #expect(coordinator.snapshotDisposition(for: newer) == .superseding)
    let snapshotResult = coordinator.recordSnapshot(.superseding)
    let nativeEndResult = coordinator.nativeEnded()
    #expect(snapshotResult == nil)
    #expect(nativeEndResult == .superseded)
  }

  @Test
  func everyNewerSameSpaceTopologyIsAuthoritative() {
    let source = TerminalTabID()
    let other = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let destination = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: 0)
    )
    let coordinator = TerminalSidebarTestFixture.completedCoordinator(
      source: .tabs([source]),
      sourceRevision: 3,
      receiptRevision: 4,
      destination: destination
    )
    let outlines = [
      TerminalSidebarTestFixture.outline(
        roots: [
          TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
          TerminalSidebarOutline.Root(content: .tab(other), isPinned: false),
        ],
        revision: 5
      ),
      TerminalSidebarTestFixture.outline(
        roots: [
          TerminalSidebarOutline.Root(
            content: .group(groupID, .green, .automatic, [source, other]),
            isPinned: false
          )
        ],
        revision: 5
      ),
      TerminalSidebarTestFixture.outline(
        roots: [TerminalSidebarOutline.Root(content: .tab(other), isPinned: false)],
        revision: 5
      ),
      TerminalSidebarTestFixture.outline(
        roots: [
          TerminalSidebarOutline.Root(
            content: .group(groupID, .green, .automatic, [other]),
            isPinned: false
          )
        ],
        revision: 5
      ),
      TerminalSidebarTestFixture.outline(
        roots: [TerminalSidebarOutline.Root(content: .tab(other), isPinned: false)],
        revision: 5
      ),
    ]

    for outline in outlines {
      #expect(coordinator.snapshotDisposition(for: outline) == .superseding)
    }
  }

  @Test
  func nilReceiptRejectsOnlyAfterNativeEndAndDuplicateEndsDoNothing() throws {
    let tabID = TerminalTabID()
    let payload = TerminalSidebarTestFixture.payload(source: .tabs([tabID]), revision: 2)
    let plan = TerminalSidebarDropPlan(
      path: .trailingRoot,
      destination: .root(isPinned: false, index: 0),
      placeholder: .beforeFooter
    )
    var coordinator = TerminalSidebarDragCoordinator(payload: payload)

    let command = coordinator.freeze(plan)
    let completed = coordinator.complete(nil)
    #expect(command != nil)
    #expect(completed)
    let outline = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 2
    )
    #expect(coordinator.snapshotDisposition(for: outline) == .rejected)
    let nativeEnd = coordinator.nativeEnded()
    let duplicateNativeEnd = coordinator.nativeEnded()
    #expect(nativeEnd == .rejected(topologyChanged: false))
    #expect(duplicateNativeEnd == nil)
  }

  @Test
  func topologyChangeCancelsTrackingWithoutAReceipt() {
    let payload = TerminalSidebarTestFixture.payload(
      source: .tabs([TerminalTabID()]),
      revision: 2
    )
    var coordinator = TerminalSidebarDragCoordinator(payload: payload)

    let cancellation = coordinator.cancel(topologyChanged: true)
    let duplicateCancellation = coordinator.cancel(topologyChanged: true)
    #expect(cancellation == .rejected(topologyChanged: true))
    #expect(duplicateCancellation == nil)
    coordinator.finish()
    #expect(coordinator.phase == .finished)
  }

  @Test
  func batchReceiptRequiresExactOrderedContiguousItemsAndDeletedGroups() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let tail = TerminalTabID()
    let deletedGroup = TerminalTabGroupID()
    let payload = TerminalSidebarTestFixture.payload(
      source: .tabs([first, second]),
      revision: 4
    )
    let destination = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: 0)
    )
    let command = TerminalSidebarDropCommand(
      operationID: payload.operationID,
      topologyStamp: payload.topologyStamp,
      itemIDs: [.tab(first), .tab(second)],
      destination: destination
    )
    let receipt = TerminalSidebarDropReceipt(
      spaceID: payload.topologyStamp.spaceID,
      result: TerminalTabMoveResult(
        operationID: payload.operationID,
        itemIDs: command.itemIDs,
        location: destination,
        deletedEmptyGroupIDs: [deletedGroup],
        topologyRevision: 5
      )
    )
    let matching = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(first), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(second), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
      ],
      revision: 5
    )
    let reversed = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(second), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(first), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
      ],
      revision: 5
    )
    let separated = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(first), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(second), isPinned: false),
      ],
      revision: 5
    )
    let deletedStillPresent = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(first), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(second), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(deletedGroup, .blue, .durable, []),
          isPinned: false
        ),
      ],
      revision: 5
    )

    #expect(receipt.matches(matching, command: command))
    #expect(!receipt.matches(reversed, command: command))
    #expect(!receipt.matches(separated, command: command))
    #expect(!receipt.matches(deletedStillPresent, command: command))
  }
}
