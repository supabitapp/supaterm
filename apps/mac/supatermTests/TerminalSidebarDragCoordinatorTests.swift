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
    #expect(receipt.result.tabIDs == [tabID])
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
      path: .trailingRoot,
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
      path: .trailingRoot,
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
        tabIDs: [tabID],
        location: destination,
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
  func externalCompletionMatchesTheDragOperation() {
    let tabID = TerminalTabID()
    let payload = TerminalSidebarTestFixture.payload(
      source: .tabs([tabID]),
      revision: 4
    )
    var drag = TerminalSidebarActiveDrag(
      payload: payload,
      liftedEntryIDs: [.tab(tabID)],
      coordinator: TerminalSidebarDragCoordinator(payload: payload),
      target: nil
    )

    let rejected = drag.completeExternal(
      operationID: TerminalTabMoveOperationID(),
      sourceDisposition: .removed
    )
    #expect(!rejected)
    let completed = drag.completeExternal(
      operationID: payload.operationID,
      sourceDisposition: .retained
    )
    #expect(completed)
    #expect(drag.externalCompletion == .moved(.retained))
  }
}
