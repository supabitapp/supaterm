import AppKit
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct HorizontalTabStripControllerTests {
  @Test
  func optionClickMergesTabIntoPrimaryAndClearsBatchSelection() throws {
    let fixture = Fixture()
    fixture.selectionState.toggle(
      fixture.trailingTabID,
      primaryTabID: fixture.selectedTabID
    )
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)
    let frame = try #require(fixture.controller.dragSourceFrame(for: entryID))
    let point = CGPoint(x: frame.midX, y: frame.midY)

    fixture.controller.beginPointerInteraction(
      entryID: entryID,
      at: point,
      modifiers: .option
    )

    #expect(fixture.actions.mergedTabIDs == [fixture.trailingTabID])
    #expect(fixture.selectionState.secondaryTabIDs.isEmpty)
    #expect(fixture.controller.dragSourcePhase == .idle)
    #expect(fixture.captureRequests.isEmpty)
  }

  @Test
  func commandPressTogglesSecondarySelectionWithoutChangingPrimary() throws {
    let fixture = Fixture()
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)
    let frame = try #require(fixture.controller.dragSourceFrame(for: entryID))
    let point = CGPoint(x: frame.midX, y: frame.midY)

    fixture.controller.beginPointerInteraction(
      entryID: entryID,
      at: point,
      modifiers: .command
    )
    fixture.controller.endPointerInteraction(entryID: entryID, at: point)

    #expect(fixture.selectionState.secondaryTabIDs == [fixture.trailingTabID])
    #expect(fixture.actions.selections.isEmpty)

    fixture.controller.beginPointerInteraction(
      entryID: entryID,
      at: point,
      modifiers: .command
    )
    fixture.controller.endPointerInteraction(entryID: entryID, at: point)

    #expect(fixture.selectionState.secondaryTabIDs.isEmpty)
    #expect(fixture.actions.selections.isEmpty)
  }

  @Test
  func shiftPressSelectsTheVisibleRange() throws {
    let fixture = Fixture()
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)
    let frame = try #require(fixture.controller.dragSourceFrame(for: entryID))
    let point = CGPoint(x: frame.midX, y: frame.midY)

    fixture.controller.beginPointerInteraction(
      entryID: entryID,
      at: point,
      modifiers: .shift
    )
    fixture.controller.endPointerInteraction(entryID: entryID, at: point)

    let visibleTabIDs = TerminalSidebarOutline(snapshot: fixture.snapshot).visibleTabIDs
    #expect(fixture.selectionState.secondaryTabIDs == Set(visibleTabIDs.dropFirst()))
    #expect(fixture.actions.selections.isEmpty)
  }

  @Test
  func plainReleaseOnSelectedBatchDefersThenCollapsesSelection() throws {
    let fixture = Fixture()
    fixture.selectionState.toggle(
      fixture.trailingTabID,
      primaryTabID: fixture.selectedTabID
    )
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)
    let frame = try #require(fixture.controller.dragSourceFrame(for: entryID))
    let point = CGPoint(x: frame.midX, y: frame.midY)

    fixture.controller.beginPointerInteraction(entryID: entryID, at: point)

    #expect(fixture.controller.dragSourcePhase == .pending(entryID))
    #expect(fixture.selectionState.secondaryTabIDs == [fixture.trailingTabID])

    fixture.controller.endPointerInteraction(entryID: entryID, at: point)

    #expect(fixture.selectionState.secondaryTabIDs.isEmpty)
    #expect(fixture.actions.selections == [fixture.trailingTabID])
  }

  @Test
  func selectedBatchProducesOneOrderedMultiTabPayloadAndHidesEachSource() throws {
    let fixture = Fixture()
    fixture.selectionState.toggle(
      fixture.trailingTabID,
      primaryTabID: fixture.selectedTabID
    )

    try fixture.startDrag(.tab(fixture.trailingTabID))

    let invocation = try #require(fixture.nativeStart.invocations.first)
    #expect(
      invocation.payload.itemIDs == [
        .tab(fixture.selectedTabID),
        .tab(fixture.trailingTabID),
      ]
    )
    #expect(fixture.controller.dragHiddenSourceViewCount == 2)
    #expect(fixture.actions.selections.isEmpty)
    fixture.controller.cancelInteractions()
  }

  @Test
  func groupPressClearsOrdinaryMultiSelection() throws {
    let fixture = Fixture()
    fixture.selectionState.toggle(
      fixture.trailingTabID,
      primaryTabID: fixture.selectedTabID
    )
    let entryID = TerminalSidebarEntryID.group(fixture.groupID)
    let frame = try #require(fixture.controller.dragSourceFrame(for: entryID))

    fixture.controller.beginPointerInteraction(
      entryID: entryID,
      at: CGPoint(x: frame.midX, y: frame.midY)
    )

    #expect(fixture.selectionState.secondaryTabIDs.isEmpty)
    fixture.controller.cancelInteractions()
  }

  @Test
  func activatesAtEightEuclideanPointsAndExpandsTheSourceHoldFrame() throws {
    let fixture = Fixture()
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)
    let frame = try #require(fixture.controller.dragSourceFrame(for: entryID))
    let origin = CGPoint(x: frame.midX, y: frame.midY)

    fixture.controller.beginPointerInteraction(entryID: entryID, at: origin)
    #expect(fixture.controller.dragSourcePhase == .pending(entryID))
    #expect(fixture.captureRequests.count == 1)
    #expect(
      !fixture.controller.continuePointerInteraction(
        entryID: entryID,
        to: CGPoint(x: origin.x + 5, y: origin.y + 6),
        screenPoint: CGPoint(x: origin.x + 5, y: origin.y + 6)
      )
    )
    #expect(fixture.nativeStart.invocations.isEmpty)

    #expect(
      fixture.controller.continuePointerInteraction(
        entryID: entryID,
        to: CGPoint(x: origin.x + 8, y: origin.y),
        screenPoint: CGPoint(x: origin.x + 8, y: origin.y)
      )
    )
    #expect(fixture.nativeStart.invocations.count == 1)
    #expect(
      fixture.controller.dragSourceHoldScreenFrame
        == TerminalHorizontalTabDragPresentation.expandedSourceHoldFrame(frame)
    )
    fixture.controller.cancelInteractions()
  }

  @Test
  func keepsCompactLiftAcrossStripAndShowsSharedPreviewAfterLeaving() throws {
    let fixture = Fixture()
    let window = NSWindow(contentViewController: fixture.controller)
    defer { window.close() }
    fixture.controller.view.frame = CGRect(
      x: 0,
      y: 0,
      width: 900,
      height: TerminalHorizontalTabMetrics.height
    )
    fixture.controller.view.layoutSubtreeIfNeeded()
    let sourceEntryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)
    let sourceFrame = try #require(fixture.controller.dragSourceFrame(for: sourceEntryID))
    let targetFrame = try #require(
      fixture.controller.dragSourceFrame(for: .tab(fixture.selectedTabID))
    )
    let sourcePoint = CGPoint(x: sourceFrame.midX, y: sourceFrame.midY)
    let sourceScreenPoint = window.convertPoint(
      toScreen:
        fixture.controller.view.convert(sourcePoint, to: nil)
    )

    fixture.controller.beginPointerInteraction(entryID: sourceEntryID, at: sourcePoint)
    #expect(
      fixture.controller.continuePointerInteraction(
        entryID: sourceEntryID,
        to: CGPoint(x: sourcePoint.x + 8, y: sourcePoint.y),
        screenPoint: CGPoint(x: sourceScreenPoint.x + 8, y: sourceScreenPoint.y)
      )
    )
    let lift = try #require(
      fixture.controller.view.subviews.compactMap { $0 as? NSImageView }.first
    )
    #expect(!lift.isHidden)

    let targetScreenPoint = window.convertPoint(
      toScreen:
        fixture.controller.view.convert(
          CGPoint(x: targetFrame.midX, y: targetFrame.midY),
          to: nil
        )
    )
    fixture.controller.sourceSessionMoved(to: targetScreenPoint)
    #expect(!lift.isHidden)

    fixture.controller.sourceSessionMoved(
      to: CGPoint(x: targetScreenPoint.x, y: targetScreenPoint.y + 100)
    )
    #expect(lift.isHidden)
    fixture.controller.cancelInteractions()
  }

  @Test
  func restoresThePriorLivePrimaryBeforeStartingThePressedTabPayload() throws {
    let fixture = Fixture()
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)

    try fixture.startDrag(entryID)

    let invocation = try #require(fixture.nativeStart.invocations.first)
    #expect(fixture.actions.selections == [fixture.trailingTabID, fixture.selectedTabID])
    #expect(invocation.liveSelectedTabID == fixture.selectedTabID)
    #expect(invocation.payload.itemIDs == [.tab(fixture.trailingTabID)])
    #expect(fixture.controller.dragActivePayload == invocation.payload)
    fixture.controller.cancelInteractions()
  }

  @Test
  func wholeGroupPayloadKeepsItsLiftAndPlaceholdersUntilNativeEnd() throws {
    let fixture = Fixture()
    let entryID = TerminalSidebarEntryID.group(fixture.groupID)
    let sourceFrame = try #require(fixture.controller.dragSourceFrame(for: entryID))

    try fixture.startDrag(entryID)

    let invocation = try #require(fixture.nativeStart.invocations.first)
    #expect(invocation.payload.itemIDs == [.group(fixture.groupID)])
    #expect(invocation.frame == sourceFrame)
    #expect(fixture.controller.hasDragSourcePlaceholder)
    #expect(fixture.controller.dragHiddenSourceViewCount == 5)
    #expect(fixture.controller.dragCleanupCount == 0)

    fixture.controller.sourceSessionEnded(operation: [])

    #expect(fixture.controller.dragSourcePhase == .idle)
    #expect(!fixture.controller.hasDragSourcePlaceholder)
    #expect(fixture.controller.dragCleanupCount == 1)
    #expect(fixture.registry.lastOutcome == .cancelled)
    #expect(fixture.controller.dragSourceFrame(for: entryID) == sourceFrame)
  }

  @Test
  func successfulMoveKeepsTheRegistryAndProjectionUntilNativeEnd() throws {
    let fixture = Fixture()
    try fixture.startDrag(.tab(fixture.trailingTabID))
    let payload = try #require(fixture.controller.dragActivePayload)
    let groupFrame = try #require(
      fixture.controller.dragItemFrame(for: .group(fixture.groupID))
    )

    #expect(
      fixture.controller.updateDrop(
        payload,
        at: CGPoint(x: groupFrame.midX, y: groupFrame.midY)
      ) == .move
    )
    #expect(fixture.controller.prepareDrop(payload))
    #expect(fixture.controller.performDrop(payload))
    #expect(fixture.registry.activePayload == payload)
    #expect(fixture.controller.hasDragSourcePlaceholder)
    #expect(fixture.controller.dragCleanupCount == 0)
    guard let phase = fixture.controller.dragCoordinatorPhase,
      case .awaitingNativeEnd = phase
    else {
      Issue.record("Expected native-end gate")
      return
    }

    fixture.controller.sourceSessionEnded(operation: .move)

    #expect(fixture.registry.activePayload == nil)
    #expect(fixture.registry.lastOutcome == .moved)
    #expect(fixture.controller.dragSourcePhase == .idle)
    #expect(fixture.controller.dragCleanupCount == 1)
  }

  @Test
  func frozenPlanIgnoresLaterTargetsAndUsesTheSourceTopologyStamp() throws {
    let fixture = Fixture()
    try fixture.startDrag(.tab(fixture.trailingTabID))
    let payload = try #require(fixture.controller.dragActivePayload)
    let groupFrame = try #require(
      fixture.controller.dragItemFrame(for: .group(fixture.groupID))
    )
    let rootFrame = try #require(
      fixture.controller.dragItemFrame(for: .tab(fixture.selectedTabID))
    )

    #expect(
      fixture.controller.updateDrop(
        payload,
        at: CGPoint(x: groupFrame.midX, y: groupFrame.midY)
      ) == .move
    )
    #expect(fixture.controller.prepareDrop(payload))
    #expect(
      fixture.controller.updateDrop(
        payload,
        at: CGPoint(x: rootFrame.maxX - 1, y: rootFrame.midY)
      ).isEmpty
    )
    #expect(fixture.controller.performDrop(payload))

    let command = try #require(fixture.actions.commands.first)
    #expect(
      command.topologyStamp
        == TerminalSidebarTopologyStamp(
          spaceID: fixture.snapshot.spaceID,
          revision: fixture.snapshot.collection.topologyRevision
        )
    )
    #expect(command.itemIDs == [.tab(fixture.trailingTabID)])
    #expect(command.destination == .group(fixture.groupID, index: 0))
    fixture.controller.sourceSessionEnded(operation: .move)
  }

  @Test
  func topologyInvalidationCancelsButRetainsTheSourceUntilNativeEnd() throws {
    let fixture = Fixture()
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)
    let sourceFrame = try #require(fixture.controller.dragSourceFrame(for: entryID))
    try fixture.startDrag(entryID)

    fixture.apply(snapshot: fixture.snapshotWithoutTrailingTab(revision: 8))

    #expect(fixture.controller.dragCoordinatorPhase == .cancelled(topologyChanged: true))
    #expect(fixture.controller.hasDragSourcePlaceholder)
    #expect(fixture.registry.activePayload != nil)
    #expect(fixture.controller.dragSourceFrame(for: entryID) == sourceFrame)

    fixture.controller.sourceSessionEnded(operation: .move)

    #expect(fixture.controller.dragSourcePhase == .idle)
    #expect(fixture.registry.activePayload == nil)
    #expect(fixture.registry.lastOutcome == .cancelled)
    #expect(fixture.controller.dragCleanupCount == 1)
    #expect(fixture.controller.dragSourceFrame(for: entryID) == nil)
  }

  @Test
  func rejectedNativeStartEntersFailedAndCleansTheRegisteredSourceOnce() throws {
    let fixture = Fixture(nativeStartResult: false)
    let entryID = TerminalSidebarEntryID.tab(fixture.trailingTabID)

    try fixture.startDrag(entryID)

    #expect(fixture.controller.dragSourcePhase == .failed(entryID))
    #expect(fixture.registry.activePayload == nil)
    #expect(fixture.registry.lastOutcome == .cancelled)
    #expect(fixture.controller.dragCleanupCount == 1)
    fixture.controller.cancelInteractions()
    fixture.controller.cancelInteractions()
    #expect(fixture.controller.dragSourcePhase == .idle)
    #expect(fixture.controller.dragCleanupCount == 1)
  }

  @Test
  func explicitCancelClearsPendingSelectionHandoffAndActiveCleanupOnce() throws {
    let pendingFixture = Fixture()
    let entryID = TerminalSidebarEntryID.tab(pendingFixture.trailingTabID)
    let frame = try #require(pendingFixture.controller.dragSourceFrame(for: entryID))

    pendingFixture.controller.beginPointerInteraction(
      entryID: entryID,
      at: CGPoint(x: frame.midX, y: frame.midY)
    )
    pendingFixture.controller.cancelInteractions()
    #expect(
      pendingFixture.actions.selections
        == [pendingFixture.trailingTabID, pendingFixture.selectedTabID]
    )
    #expect(pendingFixture.controller.dragSourcePhase == .idle)

    let activeFixture = Fixture()
    try activeFixture.startDrag(.tab(activeFixture.trailingTabID))
    activeFixture.controller.cancelInteractions()
    activeFixture.controller.cancelInteractions()
    #expect(activeFixture.controller.dragSourcePhase == .idle)
    #expect(activeFixture.controller.dragCleanupCount == 1)
    #expect(activeFixture.registry.lastOutcome == .cancelled)
  }

  @Test
  func nativeSourceOffersCopyAndMove() {
    let fixture = Fixture()

    #expect(fixture.controller.sourceOperationMask() == [.copy, .move])
  }

  @Test
  func expandedGroupCloseButtonOwnsItsAction() throws {
    let fixture = Fixture()
    let button = try #require(
      fixture.controller.view.subviews.compactMap {
        $0 as? TerminalHorizontalTabGroupCloseButton
      }.first
    )

    button.performClick(nil)

    #expect(fixture.actions.closedGroupIDs == [fixture.groupID])
    #expect(button.frame.size == CGSize(width: 22, height: 22))
  }
}

@MainActor
private final class HorizontalCaptureRequestRecorder {
  private(set) var requests: [Void] = []

  var count: Int { requests.count }
  var isEmpty: Bool { requests.isEmpty }

  func request() -> TerminalWindowCaptureRequest? {
    requests.append(())
    return nil
  }
}

@MainActor
private final class HorizontalNativeStartRecorder {
  struct Invocation {
    let payload: TerminalTabDragPayload
    let frame: CGRect
    let liveSelectedTabID: TerminalTabID?
  }

  var invocations: [Invocation] = []
  let result: Bool
  private let liveSelectedTabID: () -> TerminalTabID?

  init(
    result: Bool,
    liveSelectedTabID: @escaping () -> TerminalTabID?
  ) {
    self.result = result
    self.liveSelectedTabID = liveSelectedTabID
  }

  var start: TerminalTabNativeDragSession.NativeStart {
    TerminalTabNativeDragSession.NativeStart { [weak self] _, _, payload, frame, _ in
      guard let self else { return false }
      invocations.append(
        Invocation(
          payload: payload,
          frame: frame,
          liveSelectedTabID: liveSelectedTabID()
        )
      )
      return result
    }
  }
}

@MainActor
private final class HorizontalActionsRecorder {
  var closedGroupIDs: [TerminalTabGroupID] = []
  var commands: [TerminalSidebarDropCommand] = []
  var mergedTabIDs: [TerminalTabID] = []
  var selectedTabID: TerminalTabID?
  var selections: [TerminalTabID] = []

  init(selectedTabID: TerminalTabID) {
    self.selectedTabID = selectedTabID
  }

  var actions: TerminalHorizontalTabStripController.Actions {
    TerminalHorizontalTabStripController.Actions(
      closeGroup: { [weak self] in self?.closedGroupIDs.append($0) },
      closeTab: { _ in },
      newTab: {},
      selectTab: { [weak self] tabID in
        self?.selectedTabID = tabID
        self?.selections.append(tabID)
      },
      toggleGroup: { _ in },
      performDrop: { [weak self] command in
        self?.commands.append(command)
        return TerminalSidebarDropReceipt(
          spaceID: command.topologyStamp.spaceID,
          result: TerminalTabMoveResult(
            operationID: command.operationID,
            itemIDs: command.itemIDs,
            location: command.destination,
            deletedEmptyGroupIDs: [],
            topologyRevision: command.topologyStamp.revision + 1
          )
        )
      },
      mergeTabIntoSelectedTab: { [weak self] tabID in
        self?.mergedTabIDs.append(tabID)
        return true
      }
    )
  }
}

@MainActor
private final class Fixture {
  let actions: HorizontalActionsRecorder
  let captureRequests: HorizontalCaptureRequestRecorder
  let controller: TerminalHorizontalTabStripController
  let groupID = TerminalTabGroupID()
  let nativeStart: HorizontalNativeStartRecorder
  let registry = TerminalTabDragRegistry()
  let selectionState = TerminalTabSelectionState()
  let selectedTabID: TerminalTabID
  let trailingTabID: TerminalTabID
  let windowControllerID = UUID()
  private let roots: [TerminalTabRootItem]
  private let spaceID = TerminalSpaceID()

  lazy var snapshot = snapshot(revision: 7)

  init(nativeStartResult: Bool = true) {
    let selectedTab = TerminalTabItem(title: "Selected")
    let groupedTabs = [TerminalTabItem(title: "Build"), TerminalTabItem(title: "Test")]
    let trailingTab = TerminalTabItem(title: "Trailing")
    selectedTabID = selectedTab.id
    trailingTabID = trailingTab.id
    roots = [
      .tab(TerminalUngroupedTabItem(tab: selectedTab, isPinned: false)),
      .group(
        TerminalTabGroupItem(
          id: groupID,
          title: "Work",
          color: .blue,
          isPinned: false,
          tabs: groupedTabs
        )
      ),
      .tab(TerminalUngroupedTabItem(tab: trailingTab, isPinned: false)),
    ]
    let actions = HorizontalActionsRecorder(selectedTabID: selectedTab.id)
    let captureRequests = HorizontalCaptureRequestRecorder()
    self.actions = actions
    self.captureRequests = captureRequests
    nativeStart = HorizontalNativeStartRecorder(
      result: nativeStartResult,
      liveSelectedTabID: { [weak actions] in actions?.selectedTabID }
    )
    controller = TerminalHorizontalTabStripController(
      windowControllerID: windowControllerID,
      tabDragRegistry: registry,
      captureRequest: captureRequests.request,
      nativeDragStart: nativeStart.start
    )
    controller.view.frame = CGRect(
      x: 0,
      y: 0,
      width: 900,
      height: TerminalHorizontalTabMetrics.height
    )
    apply(snapshot: snapshot)
    controller.view.layoutSubtreeIfNeeded()
  }

  func apply(snapshot: TerminalTabSurfaceSnapshot) {
    controller.apply(
      snapshot: snapshot,
      tabSelectionState: selectionState,
      palette: Palette(colorScheme: .dark),
      reduceMotion: true,
      actions: actions.actions
    )
  }

  func snapshot(revision: UInt64) -> TerminalTabSurfaceSnapshot {
    makeSnapshot(roots: roots, revision: revision)
  }

  func snapshotWithoutTrailingTab(revision: UInt64) -> TerminalTabSurfaceSnapshot {
    makeSnapshot(roots: Array(roots.dropLast()), revision: revision)
  }

  private func makeSnapshot(
    roots: [TerminalTabRootItem],
    revision: UInt64
  ) -> TerminalTabSurfaceSnapshot {
    TerminalTabSurfaceSnapshot(
      spaceID: spaceID,
      collection: TerminalTabCollectionSnapshot(
        rootItems: roots,
        selectedTabID: selectedTabID,
        topologyRevision: revision
      ),
      collapsedGroupIDs: []
    )
  }

  func startDrag(_ entryID: TerminalSidebarEntryID) throws {
    let frame = try #require(controller.dragSourceFrame(for: entryID))
    let origin = CGPoint(x: frame.midX, y: frame.midY)
    controller.beginPointerInteraction(entryID: entryID, at: origin)
    #expect(
      controller.continuePointerInteraction(
        entryID: entryID,
        to: CGPoint(x: origin.x + 8, y: origin.y),
        screenPoint: CGPoint(x: origin.x + 8, y: origin.y)
      )
    )
  }
}
