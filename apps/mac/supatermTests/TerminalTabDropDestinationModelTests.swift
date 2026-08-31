import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalTabDropDestinationModelTests {
  @Test
  func localDropFreezesTheAcceptedPlanAndSkipsTransfer() throws {
    let windowControllerID = UUID()
    let draggedTabID = TerminalTabID()
    let operationID = TerminalTabMoveOperationID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(TerminalTabID()), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(TerminalTabID()), isPinned: false),
      ],
      revision: 4
    )
    let topologyStamp = try #require(outline.topologyStamp)
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: operationID,
        sourceWindowID: windowControllerID,
        sourceSpaceID: topologyStamp.spaceID,
        sourceTopologyRevision: topologyStamp.revision,
        itemIDs: [.tab(draggedTabID)]
      )
    )
    let registry = TerminalTabDragRegistry()
    var localCommands: [TerminalSidebarDropCommand] = []
    registry.transfer = { _, _ in
      Issue.record("Expected a local move")
      return nil
    }
    #expect(registry.begin(payload))
    var model = TerminalTabDropDestinationModel(
      configuration: TerminalTabDropDestinationModel.Configuration(
        windowControllerID: windowControllerID,
        tabDragRegistry: registry,
        performLocalDrop: { command in
          localCommands.append(command)
          return Self.receipt(for: command)
        }
      )
    )

    let first = try #require(
      model.update(payload, in: outline) { _ in
        .rootBoundary(lane: .regular, index: 0)
      }
    )
    #expect(first.beganSession)
    #expect(!first.replacedSession)
    #expect(first.acceptsDrop)
    let prepared = model.prepare(payload)
    #expect(prepared)

    let frozen = try #require(
      model.update(payload, in: outline) { _ in
        .rootBoundary(lane: .regular, index: 2)
      }
    )
    #expect(frozen.decision == nil)
    #expect(!frozen.acceptsDrop)
    let performed = model.perform(payload, in: outline)
    #expect(performed)
    #expect(localCommands.count == 1)
    #expect(
      localCommands[0].destination
        == .root(TerminalRootPlacement(isPinned: false, index: 0))
    )
  }

  @Test
  func transferRejectsChangedTopologyAndKeepsPaneIdentity() throws {
    let destinationTabID = TerminalTabID()
    let operationID = TerminalTabMoveOperationID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(TerminalTabID()), isPinned: false)
      ],
      revision: 4
    )
    let payload = TerminalTabDragPayload(
      operationID: operationID,
      sourceWindowID: UUID(),
      sourceSpaceID: TerminalSidebarTestFixture.secondarySpaceID,
      sourceTopologyRevision: 2,
      surfaceID: UUID(),
      destinationTabID: destinationTabID
    )
    let registry = TerminalTabDragRegistry()
    var destinations: [TerminalTabDragRegistry.Destination] = []
    registry.transfer = { _, destination in
      destinations.append(destination)
      return TerminalTabTransferResult(
        tabIDs: [destinationTabID],
        deletedEmptyGroupIDs: []
      )
    }
    #expect(registry.begin(payload))
    var model = TerminalTabDropDestinationModel(
      configuration: TerminalTabDropDestinationModel.Configuration(
        windowControllerID: UUID(),
        tabDragRegistry: registry,
        performLocalDrop: nil
      )
    )

    let update = try #require(
      model.update(payload, in: outline) { source in
        #expect(source == .tabs([destinationTabID]))
        return .rootBoundary(lane: .regular, index: 1)
      }
    )
    #expect(update.sidebarPayload.source == .tabs([destinationTabID]))
    let prepared = model.prepare(payload)
    #expect(prepared)

    let changedOutline = TerminalSidebarTestFixture.outline(
      roots: outline.roots,
      revision: 5
    )
    let performedWithChangedTopology = model.perform(payload, in: changedOutline)
    #expect(!performedWithChangedTopology)
    #expect(destinations.isEmpty)
    let performed = model.perform(payload, in: outline)
    #expect(performed)
    #expect(destinations.count == 1)
    #expect(destinations[0].spaceID == outline.topologyStamp?.spaceID)
    #expect(destinations[0].expectedTopologyRevision == 4)
    #expect(
      destinations[0].placement
        == .root(TerminalRootPlacement(isPinned: false, index: 1))
    )
  }

  @Test
  func topologyChangeReplacesTheDestinationSession() throws {
    let draggedTabID = TerminalTabID()
    let operationID = TerminalTabMoveOperationID()
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: operationID,
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSidebarTestFixture.secondarySpaceID,
        sourceTopologyRevision: 2,
        itemIDs: [.tab(draggedTabID)]
      )
    )
    let firstOutline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(TerminalTabID()), isPinned: false)
      ],
      revision: 4
    )
    let secondOutline = TerminalSidebarTestFixture.outline(
      roots: firstOutline.roots,
      revision: 5
    )
    let registry = TerminalTabDragRegistry()
    #expect(registry.begin(payload))
    var model = TerminalTabDropDestinationModel(
      configuration: TerminalTabDropDestinationModel.Configuration(
        windowControllerID: UUID(),
        tabDragRegistry: registry,
        performLocalDrop: nil
      )
    )

    let first = try #require(
      model.update(payload, in: firstOutline) { _ in
        .rootBoundary(lane: .regular, index: 0)
      }
    )
    #expect(first.beganSession)
    #expect(!first.replacedSession)

    let second = try #require(
      model.update(payload, in: secondOutline) { _ in
        .rootBoundary(lane: .regular, index: 0)
      }
    )
    #expect(second.beganSession)
    #expect(second.replacedSession)
    #expect(second.sidebarPayload.topologyStamp == secondOutline.topologyStamp)
    let cleared = model.clear()
    #expect(cleared)
    #expect(!model.isActive)
    let clearedAgain = model.clear()
    #expect(!clearedAgain)
  }

  private static func receipt(
    for command: TerminalSidebarDropCommand
  ) -> TerminalSidebarDropReceipt {
    TerminalSidebarDropReceipt(
      spaceID: command.topologyStamp.spaceID,
      result: TerminalTabMoveResult(
        operationID: command.operationID,
        itemIDs: command.itemIDs,
        location: command.destination,
        deletedEmptyGroupIDs: [],
        topologyRevision: command.topologyStamp.revision + 1
      )
    )
  }
}
