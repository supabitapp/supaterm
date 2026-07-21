import AppKit
import Foundation
import Testing

@testable import supaterm

struct TerminalSidebarCollectionTests {
  @Test
  func visibleEntriesPreserveDepthFirstOrderWithoutSyntheticEmptyRows() {
    let pinned = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let populatedGroup = TerminalTabGroupID()
    let emptyGroup = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(pinned), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .group(populatedGroup, .blue, .automatic, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .group(emptyGroup, .neutral, .durable, []),
          isPinned: false
        ),
      ],
      collapsedGroupIDs: [],
      topologyRevision: 4,
      spaceID: primarySpaceID
    )

    #expect(
      outline.visibleEntries.map(\.id) == [
        .tab(pinned),
        .pinDivider,
        .group(populatedGroup),
        .tab(first),
        .tab(second),
        .group(emptyGroup),
        .newTab,
        .newGroup,
      ]
    )
  }

  @Test
  func dragPayloadUsesOneOrderedCompositeForAWholeGroup() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .red, .automatic, [first, second]),
          isPinned: false
        )
      ],
      revision: 9
    )

    let payload = try #require(outline.dragPayload(for: .group(groupID)))

    #expect(payload.itemIDs == [.group(groupID)])
    #expect(payload.entryIDs == [.group(groupID), .tab(first), .tab(second)])
    #expect(payload.topologyRevision == 9)
  }

  @Test
  func activationRequiresSameEventThresholdAndExpandedSourceContainment() {
    let sourceFrame = CGRect(x: 10, y: 10, width: 100, height: 30)

    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 41,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 37.9, y: 20),
        sourceFrame: sourceFrame
      ) == .pending
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 41,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 38, y: 20),
        sourceFrame: sourceFrame
      ) == .begin
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 42,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 38, y: 20),
        sourceFrame: sourceFrame
      ) == .rejected
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        mouseDownEventNumber: 41,
        currentEventNumber: 41,
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 119, y: 20),
        sourceFrame: sourceFrame
      ) == .rejected
    )
  }

  @Test
  func layoutBuildsExactOrderedDepthFirstTargets() throws {
    let root = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let source = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 3
    )
    let plan = layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      width: 220,
      viewportHeight: 300
    )

    #expect(
      plan.semanticTargets.map(\.path) == [
        .root(index: 0, affinity: .before),
        .root(index: 1, affinity: .before),
        .group(groupID, index: 0),
        .group(groupID, index: 1),
        .root(index: 1, affinity: .after),
        .trailingRoot,
      ]
    )
    let rootTarget = try #require(plan.semanticTargets.first)
    #expect(rootTarget.frame == CGRect(x: 0, y: -3, width: 220, height: 37))
    let headerTarget = try #require(plan.semanticTargets[safe: 1])
    #expect(headerTarget.frame.minX == 3)
    #expect(headerTarget.frame.width == 220)
    #expect(headerTarget.frame.height == 34)
    let exitTarget = try #require(plan.semanticTargets[safe: 4])
    #expect(exitTarget.frame.height == 7)
    let geometry = try #require(plan.expandedGroupGeometries.first)
    #expect(geometry.groupID == groupID)
    #expect(geometry.containerMaxY == exitTarget.frame.minY + 3)
  }

  @Test
  func semanticTargetsFollowVariableTabRowHeights() throws {
    let root = TerminalTabID()
    let child = TerminalTabID()
    let source = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 3
    )
    let plan = layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      preferredHeights: [
        .tab(root): 61,
        .group(groupID): 37,
        .tab(child): 73,
      ],
      width: 220,
      viewportHeight: 300
    )
    let rootFrame = try #require(plan.items.first { $0.id == .tab(root) }?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)
    let rootTarget = try #require(
      plan.semanticTargets.first { $0.path == .root(index: 0, affinity: .before) }
    )
    let childTarget = try #require(
      plan.semanticTargets.first { $0.path == .group(groupID, index: 0) }
    )

    #expect(rootFrame.height == 61)
    #expect(childFrame.height == 73)
    #expect(rootTarget.frame == CGRect(x: 0, y: rootFrame.minY, width: 220, height: 61))
    #expect(childTarget.frame == CGRect(x: 0, y: childFrame.minY, width: 220, height: 73))
    #expect(plan.semanticTarget(at: rootFrame.midY)?.path == rootTarget.path)
    #expect(plan.semanticTarget(at: childFrame.midY)?.path == childTarget.path)
  }

  @Test
  func layoutContentSizeIncludesExactBottomPadding() throws {
    let tabID = TerminalTabID()
    let plan = layoutPlan(
      outline: outline(
        roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
        revision: 1
      ),
      draggingItemIDs: [],
      width: 200,
      viewportHeight: 240
    )
    let lastItem = try #require(plan.items.last)

    #expect(
      plan.contentSize.height
        == lastItem.frame.maxY
        + TerminalSidebarLayoutPlan.rootSpacing
        + TerminalSidebarLayoutPlan.bottomPadding
    )
  }

  @Test
  func firstMatchWinsAndTrailingTargetOwnsFooterSpace() throws {
    let tabID = TerminalTabID()
    let outline = outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 1
    )
    let plan = layoutPlan(
      outline: outline,
      draggingItemIDs: [],
      width: 200,
      viewportHeight: 240
    )
    let rowTarget = try #require(plan.semanticTargets.first)
    let trailing = try #require(plan.semanticTargets.last)
    let footerFrame = try #require(plan.items.first { $0.id == .newTab }?.frame)

    #expect(plan.semanticTarget(at: rowTarget.frame.midY)?.path == rowTarget.path)
    #expect(trailing.path == .trailingRoot)
    #expect(trailing.frame.contains(CGPoint(x: trailing.frame.midX, y: footerFrame.midY)))
    #expect(plan.semanticTarget(at: footerFrame.midY)?.path == .trailingRoot)
  }

  @Test
  func collapsedAndEmptyGroupsUseSplitSingleHeaderTargets() {
    let child = TerminalTabID()
    let collapsedID = TerminalTabGroupID()
    let emptyID = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(collapsedID, .green, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .group(emptyID, .neutral, .durable, []),
          isPinned: false
        ),
      ],
      collapsedGroupIDs: [collapsedID],
      topologyRevision: 5,
      spaceID: primarySpaceID
    )
    let plan = layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(child)],
      width: 180,
      viewportHeight: 240
    )
    let collapsedTargets = plan.semanticTargets.filter {
      $0.path == .group(collapsedID, index: 0)
        || $0.path == .root(index: 0, affinity: .after)
    }
    let emptyTargets = plan.semanticTargets.filter {
      $0.path == .group(emptyID, index: 0)
        || $0.path == .root(index: 1, affinity: .after)
    }

    #expect(collapsedTargets.map(\.frame.height) == [19, 18])
    #expect(emptyTargets.map(\.frame.height) == [19, 18])
    #expect(
      outline.visibleEntries.map(\.id) == [
        .group(collapsedID),
        .group(emptyID),
        .newTab,
        .newGroup,
      ]
    )
  }

  @Test
  func ungroupedTabRowSpecializesBySourceType() throws {
    let sourceTab = TerminalTabID()
    let targetTab = TerminalTabID()
    let sourceGroup = TerminalTabGroupID()
    let child = TerminalTabID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(sourceGroup, .red, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(targetTab), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(sourceTab), isPinned: false),
      ],
      revision: 8
    )
    let tabPayload = try #require(outline.dragPayload(for: .tab(sourceTab)))
    let groupPayload = try #require(outline.dragPayload(for: .group(sourceGroup)))

    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: tabPayload,
        path: .root(index: 1, affinity: .before),
        outline: outline
      )?.destination == .createGroup(targetTabID: targetTab)
    )
    #expect(
      TerminalSidebarDropPlanner.plan(
        payload: groupPayload,
        path: .root(index: 1, affinity: .before),
        outline: outline
      )?.destination == .root(isPinned: false, index: 0)
    )
  }

  @Test
  func lastAutomaticChildExitUsesPostRemovalRootIndex() throws {
    let child = TerminalTabID()
    let target = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .orange, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
      ],
      revision: 4
    )
    let payload = try #require(outline.dragPayload(for: .tab(child)))
    let plan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .root(index: 0, affinity: .after),
      outline: outline
    )

    #expect(plan?.destination == .root(isPinned: false, index: 0))
    #expect(plan?.placeholder == .before(.tab(target)))
  }

  @Test
  func tabCanLandBetweenTwoGroupsWithoutEnteringEither() throws {
    let firstChild = TerminalTabID()
    let source = TerminalTabID()
    let firstGroup = TerminalTabGroupID()
    let sourceGroup = TerminalTabGroupID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(firstGroup, .blue, .automatic, [firstChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .group(sourceGroup, .pink, .automatic, [source]),
          isPinned: false
        ),
      ],
      revision: 6
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let plan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .root(index: 0, affinity: .after),
      outline: outline
    )

    #expect(plan?.destination == .root(isPinned: false, index: 1))
    #expect(plan?.placeholder == .beforeFooter)
  }

  @Test
  func bottomGroupMovesToSecondRootUsingPostRemovalIndex() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(first), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(second), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(third), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .purple, .automatic, [child]),
          isPinned: false
        ),
      ],
      revision: 7
    )
    let payload = try #require(outline.dragPayload(for: .group(groupID)))
    let plan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .root(index: 1, affinity: .before),
      outline: outline
    )

    #expect(plan?.destination == .root(isPinned: false, index: 1))
    #expect(plan?.placeholder == .before(.tab(second)))
  }

  @Test
  func pinnedBoundaryAndTrailingTargetsPreserveLanes() throws {
    let pinned = TerminalTabID()
    let regular = TerminalTabID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(pinned), isPinned: true),
        TerminalSidebarOutline.Root(content: .tab(regular), isPinned: false),
      ],
      revision: 2
    )
    let payload = try #require(outline.dragPayload(for: .tab(regular)))

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
      )?.destination == .root(isPinned: false, index: 0)
    )
  }

  @Test
  func receiptLifecycleRequiresMatchingSpaceRevisionAndSemanticLocation() throws {
    let operationID = TerminalTabMoveOperationID(
      rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    )
    let tabID = TerminalTabID()
    let plan = TerminalSidebarDropPlan(
      path: .trailingRoot,
      destination: .root(isPinned: false, index: 0),
      placeholder: .beforeFooter
    )
    let result = TerminalTabMoveResult(
      operationID: operationID,
      itemIDs: [.tab(tabID)],
      location: .root(TerminalRootPlacement(isPinned: false, index: 0)),
      priorLocations: [:],
      deletedEmptyGroupIDs: [],
      topologyRevision: 12
    )
    let sourceStamp = TerminalSidebarTopologyStamp(spaceID: primarySpaceID, revision: 11)
    var lifecycle = TerminalSidebarDropLifecycle(
      operationID: operationID,
      sourceTopologyStamp: sourceStamp
    )
    let didFreeze = lifecycle.freeze(plan)
    let didComplete = lifecycle.complete(.moved(spaceID: primarySpaceID, result: result))
    let waitingOutline = outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 11
    )
    let matchingOutline = outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 12
    )
    let laterOutline = outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 13
    )
    let otherSpaceOutline = outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 12,
      spaceID: secondarySpaceID
    )
    let groupID = TerminalTabGroupID()
    let semanticMismatch = outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [tabID]),
          isPinned: false
        )
      ],
      revision: 12
    )

    #expect(didFreeze)
    #expect(didComplete)
    #expect(lifecycle.snapshotDisposition(for: waitingOutline) == .waiting)
    #expect(lifecycle.snapshotDisposition(for: matchingOutline) == .matching)
    #expect(lifecycle.snapshotDisposition(for: laterOutline) == .stale)
    #expect(lifecycle.snapshotDisposition(for: otherSpaceOutline) == .stale)
    #expect(lifecycle.snapshotDisposition(for: semanticMismatch) == .stale)

    var rejected = TerminalSidebarDropLifecycle(
      operationID: operationID,
      sourceTopologyStamp: sourceStamp
    )
    let didFreezeRejected = rejected.freeze(plan)
    let didReject = rejected.complete(nil)
    #expect(didFreezeRejected)
    #expect(didReject)
    #expect(rejected.snapshotDisposition(for: matchingOutline) == .rejected)
  }

  @Test
  func successfulNoOpReceiptAcceptsTheAlreadyAppliedOutline() throws {
    let tabID = TerminalTabID()
    let applied = outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 7
    )
    let lifecycle = try completedLifecycle(
      tabID: tabID,
      sourceRevision: 7,
      receiptRevision: 7,
      location: .root(TerminalRootPlacement(isPinned: false, index: 0))
    )

    #expect(
      TerminalSidebarDropReconciliation.decision(
        lifecycle: lifecycle,
        appliedOutline: applied,
        queuedOutline: nil
      ) == .acceptApplied
    )
  }

  @Test
  func matchingQueuedSnapshotIsAppliedBeforeSettlement() throws {
    let sourceTab = TerminalTabID()
    let otherTab = TerminalTabID()
    let applied = outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(otherTab), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(sourceTab), isPinned: false),
      ],
      revision: 7
    )
    let queued = outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(sourceTab), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(otherTab), isPinned: false),
      ],
      revision: 8
    )
    let lifecycle = try completedLifecycle(
      tabID: sourceTab,
      sourceRevision: 7,
      receiptRevision: 8,
      location: .root(TerminalRootPlacement(isPinned: false, index: 0))
    )

    #expect(
      TerminalSidebarDropReconciliation.decision(
        lifecycle: lifecycle,
        appliedOutline: applied,
        queuedOutline: queued
      ) == .applyQueued
    )
  }

  @Test
  func velocityAndDropMotionUseRawSamplesAndExactKeyframes() {
    var tracker = TerminalSidebarDragVelocityTracker()
    tracker.update(point: CGPoint(x: 10, y: 20), timestamp: 1)
    tracker.update(point: CGPoint(x: 20, y: 15), timestamp: 1.5)
    let motion = TerminalSidebarDropMotion.path(
      start: CGPoint(x: 0, y: 0),
      destination: CGPoint(x: 20, y: 20),
      velocity: CGVector(dx: 1_000, dy: 0)
    )

    #expect(tracker.velocity == CGVector(dx: 20, dy: -10))
    #expect(
      motion.positions == [
        CGPoint(x: 0, y: 0),
        CGPoint(x: 10, y: 6),
        CGPoint(x: 20, y: 20),
        CGPoint(x: 20, y: 21),
        CGPoint(x: 20, y: 20),
      ]
    )
    #expect(motion.times == [0, 0.4, 0.7, 0.85, 1])
    #expect(motion.timings == [.easeOut, .easeIn, .easeOut, .easeInEaseOut])
    #expect(motion.duration == 0.25)
  }

  @Test @MainActor
  func liftAndSettlementUseTheSameExactSpring() throws {
    let lift = TerminalSidebarTransformSpring.animation(from: 0, to: -2)
    let settlement = TerminalSidebarTransformSpring.animation(from: -2, to: 0)

    #expect(try #require(lift.fromValue as? NSNumber) == 0)
    #expect(try #require(lift.toValue as? NSNumber) == -2)
    #expect(try #require(settlement.fromValue as? NSNumber) == -2)
    #expect(try #require(settlement.toValue as? NSNumber) == 0)
    #expect(lift.stiffness == settlement.stiffness)
    #expect(lift.damping == settlement.damping)
    #expect(lift.duration == TerminalSidebarTransformSpring.response)
    #expect(settlement.duration == TerminalSidebarDropMotion.duration)
  }

  @Test @MainActor
  func dropRippleUsesExactDistanceDecayAndSpring() throws {
    let focusSpan: CGFloat = 40
    let distance: CGFloat = 5
    let expectedDelta = 0.03 * exp(-3 * distance / (focusSpan / 2))

    #expect(TerminalSidebarDropRipple.scaleDelta(distance: 0, focusSpan: focusSpan) == 0.03)
    #expect(
      TerminalSidebarDropRipple.scaleDelta(distance: distance, focusSpan: focusSpan)
        == expectedDelta
    )
    #expect(TerminalSidebarDropRipple.scaleDelta(distance: 20, focusSpan: focusSpan) == nil)
    #expect(TerminalSidebarDropRipple.scaleDelta(distance: -1, focusSpan: focusSpan) == nil)

    let earliestBeginTime = CACurrentMediaTime() + 0.15 + distance * 0.0015
    let animation = TerminalSidebarDropRipple.animation(
      scaleDelta: expectedDelta,
      center: CGPoint(x: 50, y: 20),
      distance: distance
    )
    let latestBeginTime = CACurrentMediaTime() + 0.15 + distance * 0.0015

    #expect(animation.keyPath == "transform")
    #expect(animation.isAdditive)
    #expect(animation.mass == 1)
    #expect(animation.stiffness == TerminalSidebarDropRipple.stiffness)
    #expect(
      animation.damping
        == 2 * sqrt(TerminalSidebarDropRipple.stiffness * animation.mass)
        * TerminalSidebarDropRipple.dampingRatio
    )
    #expect(animation.beginTime >= earliestBeginTime)
    #expect(animation.beginTime <= latestBeginTime)
    #expect(animation.duration == animation.settlingDuration)
    #expect(try #require(animation.fromValue as? NSValue).caTransform3DValue.m11 > 1)
  }

  @Test
  func autoscrollAndCompositeFanUseExactFunctions() {
    let visibleRect = CGRect(x: 0, y: 100, width: 220, height: 300)

    #expect(TerminalSidebarAutoscrollBehavior.edgeSize == 60)
    #expect(TerminalSidebarAutoscrollBehavior.minimumContentHeight == 240)
    #expect(TerminalSidebarAutoscrollBehavior.activationDelay == 0.25)
    #expect(TerminalSidebarAutoscrollBehavior.directionTolerance == 20)
    #expect(TerminalSidebarAutoscrollBehavior.step(outwardDelta: 100, isFirstTick: true) == 1)
    #expect(TerminalSidebarAutoscrollBehavior.step(outwardDelta: 0, isFirstTick: false) == 1)
    #expect(TerminalSidebarAutoscrollBehavior.step(outwardDelta: 2, isFirstTick: false) == 4.5)
    #expect(TerminalSidebarAutoscrollBehavior.step(outwardDelta: 4, isFirstTick: false) == 8)
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: 160, visibleRect: visibleRect) == .up
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: 340, visibleRect: visibleRect) == .down
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: 160.1, visibleRect: visibleRect) == nil
    )
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 20) == 7)
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 30) == 5)
  }

  @Test
  func groupBackgroundMatchesRootTabHorizontalEdges() throws {
    let child = TerminalTabID()
    let root = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
      ],
      revision: 1
    )
    let plan = layoutPlan(
      outline: outline,
      draggingItemIDs: [],
      width: 220,
      viewportHeight: 300
    )
    let groupFrame = try #require(plan.groups.first { $0.id == groupID }?.frame)
    let rootFrame = try #require(plan.items.first { $0.id == .tab(root) }?.frame)

    #expect(groupFrame.minX == rootFrame.minX)
    #expect(groupFrame.maxX == rootFrame.maxX)
  }

  @Test
  func hapticTracksSemanticPathTransitionsOnly() {
    var tracker = TerminalSidebarHapticTargetTracker()
    let path = TerminalSidebarSemanticPath.trailingRoot
    let first = tracker.shouldPerform(for: path)
    let repeated = tracker.shouldPerform(for: path)
    let changed = tracker.shouldPerform(for: .pinnedEnd)
    let cleared = tracker.shouldPerform(for: nil)
    let restored = tracker.shouldPerform(for: .pinnedEnd)

    #expect(first)
    #expect(!repeated)
    #expect(changed)
    #expect(!cleared)
    #expect(restored)
  }

  @Test @MainActor
  func sidebarScrollViewRejectsVerticalScrollers() {
    let scrollView = TerminalSidebarScrollView()

    scrollView.hasVerticalScroller = true
    scrollView.verticalScroller = NSScroller()

    #expect(!scrollView.hasVerticalScroller)
    #expect(scrollView.verticalScroller == nil)
  }

  private func outline(
    roots: [TerminalSidebarOutline.Root],
    revision: UInt64,
    spaceID: TerminalSpaceID? = nil
  ) -> TerminalSidebarOutline {
    TerminalSidebarOutline(
      roots: roots,
      collapsedGroupIDs: [],
      topologyRevision: revision,
      spaceID: spaceID ?? primarySpaceID
    )
  }

  private func completedLifecycle(
    tabID: TerminalTabID,
    sourceRevision: UInt64,
    receiptRevision: UInt64,
    location: TerminalTabPlacement
  ) throws -> TerminalSidebarDropLifecycle {
    let operationID = TerminalTabMoveOperationID()
    var lifecycle = TerminalSidebarDropLifecycle(
      operationID: operationID,
      sourceTopologyStamp: TerminalSidebarTopologyStamp(
        spaceID: primarySpaceID,
        revision: sourceRevision
      )
    )
    let plan = TerminalSidebarDropPlan(
      path: .trailingRoot,
      destination: .root(isPinned: false, index: 0),
      placeholder: .beforeFooter
    )
    let result = TerminalTabMoveResult(
      operationID: operationID,
      itemIDs: [.tab(tabID)],
      location: location,
      priorLocations: [:],
      deletedEmptyGroupIDs: [],
      topologyRevision: receiptRevision
    )
    guard lifecycle.freeze(plan) else { throw TerminalSidebarTestError.invalidLifecycle }
    guard lifecycle.complete(.moved(spaceID: primarySpaceID, result: result)) else {
      throw TerminalSidebarTestError.invalidLifecycle
    }
    return lifecycle
  }

  private var primarySpaceID: TerminalSpaceID {
    TerminalSpaceID(rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!)
  }

  private var secondarySpaceID: TerminalSpaceID {
    TerminalSpaceID(rawValue: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!)
  }

  private func layoutPlan(
    outline: TerminalSidebarOutline,
    draggingItemIDs: [TerminalSidebarEntryID],
    preferredHeights: [TerminalSidebarEntryID: CGFloat]? = nil,
    width: CGFloat,
    viewportHeight: CGFloat
  ) -> TerminalSidebarLayoutPlan {
    TerminalSidebarLayoutPlan(
      outline: outline,
      preferredHeights: preferredHeights
        ?? Dictionary(uniqueKeysWithValues: outline.visibleEntries.map { ($0.id, CGFloat(37)) }),
      dragDropState: draggingItemIDs.isEmpty
        ? nil
        : TerminalSidebarDragDropState(draggingItemIDs: draggingItemIDs, target: nil),
      width: width,
      viewportHeight: viewportHeight
    )
  }
}

private enum TerminalSidebarTestError: Error {
  case invalidLifecycle
}

extension Array {
  fileprivate subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
