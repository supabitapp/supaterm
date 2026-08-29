import Testing

@testable import supaterm

struct TerminalSidebarDragCoordinatorTests {
  @Test
  func successfulDropSettlesWhenTheNativeSourceEnds() {
    let tabID = TerminalTabID()
    let destination = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: 0)
    )
    var coordinator = TerminalSidebarTestFixture.completedCoordinator(
      source: .tabs([tabID]),
      sourceRevision: 1,
      receiptRevision: 2,
      destination: destination
    )

    guard case .accepted(let receipt) = coordinator.nativeEnded() else {
      Issue.record("Expected accepted settlement")
      return
    }

    let duplicateEnd = coordinator.nativeEnded()
    #expect(receipt.result.itemIDs == [.tab(tabID)])
    #expect(receipt.result.location == destination)
    #expect(duplicateEnd == nil)
    coordinator.finish()
    #expect(coordinator.phase == .finished)
  }

  @Test
  func rejectedTransactionSettlesWhenTheNativeSourceEnds() {
    let tabID = TerminalTabID()
    let payload = TerminalSidebarTestFixture.payload(source: .tabs([tabID]), revision: 2)
    let plan = TerminalSidebarDropPlan(
      path: .rootBoundary(lane: .regular, index: 0),
      destination: .root(isPinned: false, index: 0),
      placeholder: .beforeFooter
    )
    var coordinator = TerminalSidebarDragCoordinator(payload: payload)

    let command = coordinator.freeze(plan)
    let completed = coordinator.complete(nil)
    #expect(command != nil)
    #expect(completed)
    let nativeEnd = coordinator.nativeEnded()
    let duplicateEnd = coordinator.nativeEnded()
    #expect(nativeEnd == .rejected(topologyChanged: false))
    #expect(duplicateEnd == nil)
  }

  @Test
  func topologyChangeWaitsForTheNativeSourceToEnd() {
    let payload = TerminalSidebarTestFixture.payload(
      source: .tabs([TerminalTabID()]),
      revision: 2
    )
    var coordinator = TerminalSidebarDragCoordinator(payload: payload)

    coordinator.cancel(topologyChanged: true)
    coordinator.cancel(topologyChanged: true)

    let phaseBeforeEnd = coordinator.phase
    let nativeEnd = coordinator.nativeEnded()
    #expect(phaseBeforeEnd == .cancelled(topologyChanged: true))
    #expect(nativeEnd == .rejected(topologyChanged: true))
    coordinator.finish()
    #expect(coordinator.phase == .finished)
  }

  @Test
  func receiptMustMatchTheFrozenOperationSpaceAndRevision() {
    let tabID = TerminalTabID()
    let payload = TerminalSidebarTestFixture.payload(source: .tabs([tabID]), revision: 4)
    let destination = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: 0)
    )
    let plan = TerminalSidebarDropPlan(
      path: .rootBoundary(lane: .regular, index: 0),
      destination: .root(isPinned: false, index: 0),
      placeholder: .beforeFooter
    )

    func accepts(_ receipt: TerminalSidebarDropReceipt) -> Bool {
      var coordinator = TerminalSidebarDragCoordinator(payload: payload)
      precondition(coordinator.freeze(plan) != nil)
      return coordinator.complete(receipt)
    }

    let valid = TerminalSidebarTestFixture.moveReceipt(
      payload: payload,
      destination: destination,
      revision: 5
    )
    let wrongOperation = TerminalSidebarDropReceipt(
      spaceID: payload.topologyStamp.spaceID,
      result: TerminalTabMoveResult(
        operationID: TerminalTabMoveOperationID(),
        itemIDs: payload.source.itemIDs,
        location: destination,
        deletedEmptyGroupIDs: [],
        topologyRevision: 5
      )
    )
    let wrongSpace = TerminalSidebarDropReceipt(
      spaceID: TerminalSidebarTestFixture.secondarySpaceID,
      result: valid.result
    )
    let oldRevision = TerminalSidebarTestFixture.moveReceipt(
      payload: payload,
      destination: destination,
      revision: 3
    )

    #expect(accepts(valid))
    #expect(!accepts(wrongOperation))
    #expect(!accepts(wrongSpace))
    #expect(!accepts(oldRevision))
  }

  @Test
  func completionOutcomeComesFromTheReceiptOrExternalTransfer() {
    let tabID = TerminalTabID()
    let payload = TerminalSidebarTestFixture.payload(
      source: .tabs([tabID]),
      revision: 4
    )
    let receipt = TerminalSidebarTestFixture.moveReceipt(
      payload: payload,
      destination: .root(TerminalRootPlacement(isPinned: false, index: 0)),
      revision: 5
    )
    var drag = TerminalSidebarActiveDrag(
      payload: payload,
      liftedEntryIDs: [.tab(tabID)],
      coordinator: TerminalSidebarDragCoordinator(payload: payload)
    )

    #expect(drag.registryOutcome(receipt: nil) == .cancelled)
    #expect(drag.registryOutcome(receipt: receipt) == .moved)
    let rejected = drag.completeExternal(
      operationID: TerminalTabMoveOperationID(),
      sourceDisposition: .removed
    )
    #expect(!rejected)
    #expect(drag.registryOutcome(receipt: nil) == .cancelled)
    let completed = drag.completeExternal(
      operationID: payload.operationID,
      sourceDisposition: .retained
    )
    #expect(completed)
    #expect(drag.externalSourceDisposition == .retained)
    #expect(drag.registryOutcome(receipt: nil) == .moved)
  }
}
