import AppKit
import Foundation
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct SidebarExternalDropControllerTests {
  private struct Fixture {
    let outline: TerminalSidebarOutline
    let sidebarPayload: TerminalSidebarDragPayload
    let payload: TerminalTabDragPayload
  }

  @Test
  func commandRequiresTheHoveredTopology() throws {
    let existingTabID = TerminalTabID()
    let draggedTabID = TerminalTabID()
    let operationID = TerminalTabMoveOperationID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .unassigned([existingTabID]), isPinned: false)
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
        path: .rootBoundary(lane: .regular, index: 1),
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

  @Test
  func provisionalTabSessionBuildsTabSourceTargetsBeforeAcceptance() throws {
    let childID = TerminalTabID()
    let tailID = TerminalTabID()
    let draggedID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let operationID = TerminalTabMoveOperationID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [childID]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(tailID), isPinned: false),
      ],
      revision: 4
    )
    let sidebarPayload = TerminalSidebarTestFixture.payload(
      source: .tabs([draggedID]),
      revision: 4,
      operationID: operationID
    )
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: operationID,
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSidebarTestFixture.secondarySpaceID,
        sourceTopologyRevision: 2,
        itemIDs: [.tab(draggedID)]
      )
    )
    let harness = ExternalDropHarness(outline: outline)
    let miss = TerminalSidebarDropResolution(
      payload: sidebarPayload,
      path: nil,
      outline: outline
    )

    #expect(
      !harness.controller.updateTarget(
        payload: payload,
        sidebarPayload: sidebarPayload,
        resolution: miss
      )
    )
    #expect(harness.layout.dropTargetMap.targets.contains { $0.path == .groupEntry(groupID) })
    #expect(
      !harness.layout.dropTargetMap.targets.contains {
        $0.path == .rootItem(lane: .regular, index: 0, id: .group(groupID))
      }
    )
  }

  @Test
  func rejectedAndMissedHitsRetainTheLastAcceptedExternalTarget() throws {
    let fixture = try makeFixture()
    let harness = ExternalDropHarness(outline: fixture.outline)
    let rejected = TerminalSidebarDropResolution(
      payload: fixture.sidebarPayload,
      path: .rootItem(
        lane: .regular,
        index: 0,
        id: .group(TerminalTabGroupID())
      ),
      outline: fixture.outline
    )
    #expect(rejected.path != nil)
    #expect(rejected.plan == nil)
    #expect(
      !harness.controller.updateTarget(
        payload: fixture.payload,
        sidebarPayload: fixture.sidebarPayload,
        resolution: rejected
      )
    )
    #expect(harness.controller.isActive)
    let provisionalState = try #require(harness.layout.dragDropState)
    expectProvisionalState(provisionalState, in: harness)

    let first = TerminalSidebarDropResolution(
      payload: fixture.sidebarPayload,
      path: .rootBoundary(lane: .regular, index: 0),
      outline: fixture.outline
    )
    let firstPlan = try #require(first.plan)

    #expect(
      harness.controller.updateTarget(
        payload: fixture.payload,
        sidebarPayload: fixture.sidebarPayload,
        resolution: first
      )
    )
    let retainedState = try #require(harness.layout.dragDropState)
    #expect(retainedState.target == firstPlan)
    #expect(harness.invalidations == 2)
    #expect(harness.hapticPaths == [first.path])

    #expect(
      !harness.controller.updateTarget(
        payload: fixture.payload,
        sidebarPayload: fixture.sidebarPayload,
        resolution: rejected
      )
    )
    #expect(harness.controller.isActive)
    #expect(harness.layout.dragDropState == retainedState)
    #expect(harness.invalidations == 2)
    #expect(harness.hapticPaths == [first.path])

    let miss = TerminalSidebarDropResolution(
      payload: fixture.sidebarPayload,
      path: nil,
      outline: fixture.outline
    )
    #expect(
      !harness.controller.updateTarget(
        payload: fixture.payload,
        sidebarPayload: fixture.sidebarPayload,
        resolution: miss
      )
    )
    #expect(harness.layout.dragDropState == retainedState)
    #expect(harness.invalidations == 2)
    #expect(harness.hapticPaths == [first.path])

    #expect(
      harness.controller.updateTarget(
        payload: fixture.payload,
        sidebarPayload: fixture.sidebarPayload,
        resolution: first
      )
    )
    #expect(harness.layout.dragDropState == retainedState)
    #expect(harness.invalidations == 2)
    #expect(harness.hapticPaths == [first.path])

    let second = TerminalSidebarDropResolution(
      payload: fixture.sidebarPayload,
      path: .rootBoundary(lane: .regular, index: 2),
      outline: fixture.outline
    )
    let secondPlan = try #require(second.plan)
    #expect(
      harness.controller.updateTarget(
        payload: fixture.payload,
        sidebarPayload: fixture.sidebarPayload,
        resolution: second
      )
    )
    #expect(harness.layout.dragDropState?.target == secondPlan)
    #expect(harness.invalidations == 3)
    #expect(harness.hapticPaths == [first.path, second.path])

    harness.controller.clear()

    #expect(!harness.controller.isActive)
    #expect(harness.layout.dragDropState == nil)
    #expect(harness.invalidations == 4)
    #expect(harness.hapticResetCount == 1)
    #expect(harness.didClearCount == 1)
    #expect(harness.autoscrollStopCount == 1)
  }

  @Test
  func acceptedExternalDropUsesTheSourceGapHeight() throws {
    let fixture = try makeFixture()
    let harness = ExternalDropHarness(outline: fixture.outline)
    #expect(
      harness.registry.begin(
        fixture.payload,
        sidebarDropGapHeight: 64
      )
    )
    let resolution = TerminalSidebarDropResolution(
      payload: fixture.sidebarPayload,
      path: .rootBoundary(lane: .regular, index: 1),
      outline: fixture.outline
    )

    #expect(
      harness.controller.updateTarget(
        payload: fixture.payload,
        sidebarPayload: fixture.sidebarPayload,
        resolution: resolution
      )
    )
    #expect(harness.layout.dragDropState?.dropGapHeight == 64)
    #expect(harness.layout.plan.dropPlaceholderFrame?.height == 64)
  }

  private func expectProvisionalState(
    _ state: TerminalSidebarDragDropState,
    in harness: ExternalDropHarness
  ) {
    #expect(state.target == nil)
    #expect(state.draggingItemIDs.count == 1)
    #expect(harness.invalidations == 1)
    #expect(harness.hapticPaths.isEmpty)
    #expect(harness.didClearCount == 0)
  }

  private func makeFixture() throws -> Fixture {
    let sourceGroupID = TerminalTabGroupID()
    let operationID = TerminalTabMoveOperationID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(TerminalTabID()), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(TerminalTabID()), isPinned: false),
      ],
      revision: 4
    )
    let sidebarPayload = TerminalSidebarTestFixture.payload(
      source: .group(sourceGroupID),
      revision: 4,
      operationID: operationID
    )
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: operationID,
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSidebarTestFixture.secondarySpaceID,
        sourceTopologyRevision: 2,
        itemIDs: [.group(sourceGroupID)]
      )
    )
    return Fixture(
      outline: outline,
      sidebarPayload: sidebarPayload,
      payload: payload
    )
  }
}

@MainActor
private final class ExternalDropHarness {
  let collectionView = TerminalSidebarCollectionView(frame: .zero)
  let layout = TerminalSidebarCollectionLayout()
  let registry = TerminalTabDragRegistry()
  private(set) var invalidations = 0
  private(set) var hapticPaths: [TerminalSidebarSemanticPath?] = []
  private(set) var hapticResetCount = 0
  private(set) var didClearCount = 0
  private(set) var autoscrollStopCount = 0

  init(outline: TerminalSidebarOutline) {
    collectionView.frame = CGRect(x: 0, y: 0, width: 220, height: 300)
    collectionView.collectionViewLayout = layout
    layout.setOutline(outline)
    layout.prepare()
  }

  lazy var controller = TerminalSidebarExternalDropController(
    configuration: TerminalSidebarExternalDropController.Configuration(
      collectionView: collectionView,
      collectionLayout: layout,
      tabDragRegistry: registry,
      windowControllerID: UUID(),
      content: { nil },
      updateAutoscroll: { _ in },
      stopAutoscroll: { [weak self] in self?.autoscrollStopCount += 1 },
      invalidateLayout: { [weak self] in self?.invalidations += 1 },
      updateHapticTarget: { [weak self] in self?.hapticPaths.append($0) },
      resetHapticTarget: { [weak self] in self?.hapticResetCount += 1 },
      didClear: { [weak self] in self?.didClearCount += 1 }
    )
  )
}
