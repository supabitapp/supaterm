import AppKit
import QuartzCore
import SupaTheme
import Testing

@testable import supaterm

struct TerminalSidebarMotionTests {
  @Test
  func optionTabClickRequiresOptionOnlyOnTheFirstClick() {
    #expect(
      TerminalSidebarOptionTabClick.accepts(
        modifiers: .option,
        clickCount: 1
      )
    )
    #expect(
      TerminalSidebarOptionTabClick.accepts(
        modifiers: [.option, .capsLock],
        clickCount: 1
      )
    )
    for modifiers in [
      NSEvent.ModifierFlags(),
      .command,
      [.command, .option],
      [.shift, .option],
      [.control, .option],
    ] {
      #expect(
        !TerminalSidebarOptionTabClick.accepts(
          modifiers: modifiers,
          clickCount: 1
        )
      )
    }
    #expect(
      !TerminalSidebarOptionTabClick.accepts(
        modifiers: .option,
        clickCount: 2
      )
    )
  }

  @Test
  func pressingASelectedTabKeepsTheBatchUntilTheGestureResolves() {
    let first = TerminalTabID()
    let second = TerminalTabID()

    #expect(
      TerminalSidebarTabPressDecision.resolve(
        tabID: second,
        modifiers: [],
        selectedTabIDs: [first, second]
      ) == .deferSelection([first, second])
    )
    #expect(
      TerminalSidebarTabPressDecision.resolve(
        tabID: second,
        modifiers: .command,
        selectedTabIDs: [first, second]
      ) == .applySelection
    )
    #expect(
      TerminalSidebarTabPressDecision.resolve(
        tabID: TerminalTabID(),
        modifiers: [],
        selectedTabIDs: [first, second]
      ) == .applySelection
    )
  }

  @Test
  func plainSingleTabDragRestoresOnlyItsPriorSelection() throws {
    let prior = TerminalTabID()
    let dragged = TerminalTabID()

    let handoff = try #require(
      TerminalSidebarTabDragSelectionHandoff.resolve(
        entryID: .tab(dragged),
        primaryTabID: prior,
        modifiers: [],
        selectedTabIDs: [dragged]
      )
    )

    #expect(handoff.priorTabID == prior)
    #expect(
      handoff.tabIDToRestore(
        draggedTabID: dragged,
        liveSelectedTabID: dragged
      ) == prior
    )
    #expect(
      handoff.tabIDToRestore(
        draggedTabID: dragged,
        liveSelectedTabID: prior
      ) == nil
    )
    #expect(
      handoff.tabIDToRestore(
        draggedTabID: dragged,
        liveSelectedTabID: TerminalTabID()
      ) == nil
    )
  }

  @Test
  func selectionHandoffExcludesSelectedModifiedAndBatchDrags() {
    let prior = TerminalTabID()
    let dragged = TerminalTabID()

    #expect(
      TerminalSidebarTabDragSelectionHandoff.resolve(
        entryID: .tab(dragged),
        primaryTabID: dragged,
        modifiers: [],
        selectedTabIDs: [dragged]
      ) == nil
    )
    for modifiers in [
      NSEvent.ModifierFlags.command,
      .shift,
      .option,
      .control,
    ] {
      #expect(
        TerminalSidebarTabDragSelectionHandoff.resolve(
          entryID: .tab(dragged),
          primaryTabID: prior,
          modifiers: modifiers,
          selectedTabIDs: [dragged]
        ) == nil
      )
    }
    #expect(
      TerminalSidebarTabDragSelectionHandoff.resolve(
        entryID: .tab(dragged),
        primaryTabID: prior,
        modifiers: [],
        selectedTabIDs: [prior, dragged]
      ) == nil
    )
    #expect(
      TerminalSidebarTabDragSelectionHandoff.resolve(
        entryID: .tab(dragged),
        primaryTabID: nil,
        modifiers: [],
        selectedTabIDs: [dragged]
      ) == nil
    )
    #expect(
      TerminalSidebarTabDragSelectionHandoff.resolve(
        entryID: .group(TerminalTabGroupID()),
        primaryTabID: prior,
        modifiers: [],
        selectedTabIDs: [dragged]
      ) == nil
    )
  }

  @Test
  func collapsedGroupSelectionUpdateQueuesDuringDrag() throws {
    let groupID = TerminalTabGroupID()
    let roots = [
      TerminalSidebarOutline.Root(
        content: .group(groupID, .red, .automatic, [TerminalTabID()]),
        isPinned: false
      )
    ]
    let applied = TerminalSidebarTestFixture.outline(
      roots: roots,
      revision: 4,
      collapsedGroupIDs: [groupID]
    )
    let expanded = TerminalSidebarTestFixture.outline(roots: roots, revision: 4)
    let sourceTopologyStamp = try #require(applied.topologyStamp)

    #expect(
      TerminalSidebarDragOutlineDisposition.tracking(
        incoming: expanded,
        applied: applied,
        sourceTopologyStamp: sourceTopologyStamp
      ) == .queue
    )
  }

  @Test
  func activeDragOutlinePolicyCancelsTopologyAndStructureChanges() throws {
    let source = TerminalTabID()
    let applied = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(source), isPinned: false)],
      revision: 4
    )
    let changedTopology = TerminalSidebarTestFixture.outline(
      roots: applied.roots,
      revision: 5
    )
    let changedRoots = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(TerminalTabID()), isPinned: false),
      ],
      revision: 4
    )
    let sourceTopologyStamp = try #require(applied.topologyStamp)

    #expect(
      TerminalSidebarDragOutlineDisposition.tracking(
        incoming: changedTopology,
        applied: applied,
        sourceTopologyStamp: sourceTopologyStamp
      ) == .replaceAndCancel(reason: "sourceTopologyChanged")
    )
    #expect(
      TerminalSidebarDragOutlineDisposition.tracking(
        incoming: changedRoots,
        applied: applied,
        sourceTopologyStamp: sourceTopologyStamp
      ) == .replaceAndCancel(reason: "sourceSnapshotMismatch")
    )
  }

  @Test
  func activationUsesTheEightPointThreshold() {
    #expect(
      TerminalSidebarDragActivation.decision(
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 37.9, y: 20),
        sourceFrame: CGRect(x: 0, y: 0, width: 240, height: 40)
      ) == .pending
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 38, y: 20),
        sourceFrame: CGRect(x: 0, y: 0, width: 240, height: 40)
      ) == .begin
    )
  }

  @Test
  func thresholdCrossingOutsideTheExpandedRowFailsTheDrag() {
    #expect(
      TerminalSidebarDragActivation.decision(
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 34, y: 260),
        sourceFrame: CGRect(x: 0, y: 0, width: 240, height: 40)
      ) == .failed
    )
  }

  @Test
  func thresholdCrossingInsideTheExpandedRowBeginsTheDrag() {
    #expect(
      TerminalSidebarDragActivation.decision(
        origin: CGPoint(x: 30, y: 20),
        location: CGPoint(x: 30, y: 47.9),
        sourceFrame: CGRect(x: 0, y: 0, width: 240, height: 40)
      ) == .begin
    )
  }

  @Test
  func failedGroupDragTogglesOnlyWhenReleaseReturnsInsideTheLiveHeader() {
    let frame = CGRect(x: 12, y: 40, width: 216, height: 37)

    #expect(
      TerminalSidebarGroupClick.acceptsRelease(
        CGPoint(x: frame.midX, y: frame.midY),
        frame: frame
      )
    )
    #expect(
      !TerminalSidebarGroupClick.acceptsRelease(
        CGPoint(x: frame.midX, y: frame.maxY + 1),
        frame: frame
      )
    )
    #expect(!TerminalSidebarGroupClick.acceptsRelease(.zero, frame: nil))
  }

  @Test
  func reduceMotionDisablesEveryDecorativeDragEffect() {
    let policy = TerminalSidebarMotionPolicy(reduceMotion: true)

    #expect(!policy.lift)
    #expect(!policy.targetInterpolation)
    #expect(!policy.collapseStagger)
    #expect(!policy.hoverFade)
    #expect(!policy.acceptedArc)
    #expect(!policy.ripple)
    #expect(!policy.snapback)
  }

  @Test
  func groupExpansionUsesTheCollapseRowDuration() {
    let groupID = TerminalTabGroupID()
    let roots = [
      TerminalSidebarOutline.Root(
        content: .group(groupID, .red, .automatic, [TerminalTabID()]),
        isPinned: false
      )
    ]
    let collapsed = TerminalSidebarTestFixture.outline(
      roots: roots,
      revision: 1,
      collapsedGroupIDs: [groupID]
    )
    let expanded = TerminalSidebarTestFixture.outline(roots: roots, revision: 1)
    let removed = TerminalSidebarTestFixture.outline(roots: [], revision: 2)

    #expect(
      TerminalSidebarLayoutMotion.animationDuration(from: collapsed, to: expanded)
        == TerminalSidebarCollapseMotion.rowDuration
    )
    #expect(
      TerminalSidebarLayoutMotion.animationDuration(from: expanded, to: collapsed)
        == TerminalSidebarLayoutMotion.defaultDuration
    )
    #expect(
      TerminalSidebarLayoutMotion.animationDuration(from: collapsed, to: removed)
        == TerminalSidebarLayoutMotion.defaultDuration
    )
  }

  @Test
  func velocityAndAcceptedDropUseExactPath() {
    var tracker = TerminalSidebarDragVelocityTracker()
    tracker.update(point: CGPoint(x: 10, y: 20), timestamp: 1)
    tracker.update(point: CGPoint(x: 20, y: 15), timestamp: 1.5)
    let motion = TerminalSidebarDropMotion.path(
      start: .zero,
      destination: CGPoint(x: 20, y: 20),
      velocity: CGVector(dx: 1_000, dy: 0)
    )

    #expect(tracker.velocity == CGVector(dx: 20, dy: -10))
    #expect(
      motion.positions == [
        .zero,
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

  @Test
  func autoscrollTravelsTheSameDistanceAtSixtyAndOneTwentyHertz() {
    let distanceAt60 = (0..<60).reduce(CGFloat.zero) { total, _ in
      total + TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 4, elapsed: 1 / 60)
    }
    let distanceAt120 = (0..<120).reduce(CGFloat.zero) { total, _ in
      total + TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 4, elapsed: 1 / 120)
    }

    #expect(distanceAt60 == 480)
    #expect(distanceAt120 == 480)
  }

  @Test
  func autoscrollUsesTargetIntervalFirstCapsStallsAndResets() {
    var timing = TerminalSidebarAutoscrollTiming()
    let oneTwentyInterval = TimeInterval(1.0 / 120.0)
    let sixtyInterval = TimeInterval(1.0 / 60.0)
    let first = timing.interval(timestamp: 1, targetTimestamp: 1 + oneTwentyInterval)
    let second = timing.interval(timestamp: 1 + oneTwentyInterval, targetTimestamp: 2)

    #expect(abs(first - oneTwentyInterval) < 0.000_000_001)
    #expect(abs(second - oneTwentyInterval) < 0.000_000_001)
    #expect(TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 4, elapsed: 1) == 16)
    #expect(TerminalSidebarAutoscrollBehavior.distance(outwardDelta: 0, elapsed: 1 / 60) == 1)
    #expect(TerminalSidebarAutoscrollBehavior.distance(outwardDelta: -4, elapsed: 1 / 60) == 1)
    timing.reset()
    let reset = timing.interval(timestamp: 3, targetTimestamp: 3 + sixtyInterval)
    #expect(abs(reset - sixtyInterval) < 0.000_000_001)
  }

  @Test
  func autoscrollEdgesAndBoundsStayExact() {
    let visible = CGRect(x: 0, y: 100, width: 220, height: 300)
    let compact = CGRect(x: 0, y: 100, width: 220, height: 200)

    #expect(TerminalSidebarAutoscrollBehavior.edgeSize == 60)
    #expect(TerminalSidebarAutoscrollBehavior.activationDelay == 0.25)
    #expect(TerminalSidebarAutoscrollBehavior.directionTolerance == 20)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 160, visibleRect: visible) == .up)
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: 340, visibleRect: visible) == .down
    )
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 160.1, visibleRect: visible) == nil)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 99, visibleRect: visible) == nil)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 120, visibleRect: compact) == nil)
  }

  @Test
  func pinnedNewTabRoutesToBottomAutoscrollAndTrailingRootDrop() throws {
    let source = TerminalTabID()
    let target = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
      ],
      revision: 2
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let visibleRect = CGRect(x: 0, y: 100, width: 220, height: 300)
    let pointerY = TerminalSidebarPinnedDropRouting.autoscrollPointerY(in: visibleRect)
    let resolution = TerminalSidebarDropResolution(
      payload: payload,
      path: .trailingRoot,
      outline: outline
    )

    #expect(pointerY == visibleRect.maxY)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: pointerY, visibleRect: visibleRect) == .down)
    #expect(resolution.path == .trailingRoot)
    #expect(resolution.plan?.destination == .root(isPinned: false, index: 1))
    #expect(resolution.plan?.placeholder == .beforeFooter)
  }

  @Test @MainActor
  func liftAndSettlementUseTheSameSpring() throws {
    let lift = TerminalSidebarTransformSpring.animation(from: 0, to: -2)
    let settlement = TerminalSidebarTransformSpring.animation(from: -2, to: 0)

    #expect(try #require(lift.fromValue as? NSNumber) == 0)
    #expect(try #require(lift.toValue as? NSNumber) == -2)
    #expect(try #require(settlement.fromValue as? NSNumber) == -2)
    #expect(try #require(settlement.toValue as? NSNumber) == 0)
    #expect(lift.stiffness == settlement.stiffness)
    #expect(lift.damping == settlement.damping)
  }

  @Test
  func livePreviewPreservesRowsBoundsAndSettlementGeometry() {
    let container = CGRect(x: 4, y: 50, width: 212, height: 180)
    let bounds = CGRect(x: 4, y: 0, width: 212, height: 400)

    #expect(
      TerminalSidebarLiveDragGeometry.rowFrame(
        sourceFrame: CGRect(x: 16, y: 92, width: 200, height: 56),
        containerFrame: container
      ) == CGRect(x: 12, y: 42, width: 200, height: 56)
    )
    #expect(TerminalSidebarLiveDragGeometry.constrainedX(-100, frameWidth: 212, bounds: bounds) == 4)
    #expect(TerminalSidebarLiveDragGeometry.constrainedX(100, frameWidth: 200, bounds: bounds) == 16)
    #expect(
      TerminalSidebarLiveDragGeometry.settlementPosition(
        currentLayerPosition: .zero,
        currentFrame: container,
        targetFrame: CGRect(x: 4, y: 300, width: 212, height: 180)
      ) == CGPoint(x: 0, y: 250)
    )
  }

  @Test @MainActor
  func selectedSurfaceStaysWithTheLiftedRow() throws {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let sourceFrame = CGRect(x: 12, y: 40, width: 216, height: 52)
    let hostedView = NSView(frame: CGRect(origin: .zero, size: sourceFrame.size))
    let selectedSurfaceView = TerminalSidebarSelectionGlowView(
      frame: sourceFrame.insetBy(dx: -4, dy: -4)
    )
    let selectedSurface = TerminalSidebarLiftedSelectionSurface(view: selectedSurfaceView)
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: sourceFrame,
            selectedSurface: selectedSurface,
            restore: {}
          )
        ],
        groupBackground: nil,
        fanAnchorIndex: nil,
        sourceFrame: sourceFrame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    let liveView = try #require(hostedView.superview)
    #expect(selectedSurfaceView.superview === liveView)
    #expect(selectedSurfaceView.frame == CGRect(x: -4, y: -4, width: 224, height: 60))
  }

  @Test @MainActor
  func destinationHandoffKeepsThenDiscardsThePreviewRows() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    source.addSubview(hostedView)
    var restored = false
    let row = TerminalSidebarLiftedRow(
      hostedView: hostedView,
      sourceFrame: source.frame,
      restore: {
        restored = true
        source.addSubview(hostedView)
        hostedView.frame = source.bounds
      }
    )
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [row],
        groupBackground: nil,
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )
    var previewWasInstalled = false
    var destinationWasCompleted = false
    var layoutPass = 0

    presentation.handoffToDestination {
      layoutPass += 1
      if layoutPass == 1 {
        previewWasInstalled = true
      } else {
        destinationWasCompleted = true
      }
    }

    #expect(previewWasInstalled)
    #expect(destinationWasCompleted)
    #expect(!restored)
    #expect(hostedView.superview == nil)
  }

  @Test @MainActor
  func cancellationRestoresTheCapturedSourceProjection() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    let background = TerminalSidebarGroupBackgroundView(frame: source.frame)
    source.addSubview(hostedView)
    collectionView.addSubview(background)
    var restoreCount = 0
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: source.frame,
            restore: {
              restoreCount += 1
              source.addSubview(hostedView)
            }
          )
        ],
        groupBackground: TerminalSidebarLiftedGroupBackground(
          id: TerminalTabGroupID(),
          view: background,
          sourceFrame: background.frame
        ),
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    presentation.handoffToSource {}

    #expect(restoreCount == 1)
    #expect(hostedView.superview === source)
    #expect(background.superview === collectionView)
  }

  @Test @MainActor
  func externalSuccessDiscardsTheCapturedSourceProjection() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    let background = TerminalSidebarGroupBackgroundView(frame: source.frame)
    source.addSubview(hostedView)
    collectionView.addSubview(background)
    var restoreCount = 0
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: source.frame,
            restore: { restoreCount += 1 }
          )
        ],
        groupBackground: TerminalSidebarLiftedGroupBackground(
          id: TerminalTabGroupID(),
          view: background,
          sourceFrame: background.frame
        ),
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    presentation.handoffAfterExternalSuccess(.removed) {}

    #expect(restoreCount == 0)
    #expect(hostedView.superview == nil)
    #expect(background.superview == nil)
  }

  @Test @MainActor
  func retainedExternalSuccessRestoresTheCapturedSourceProjection() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let source = NSView(frame: CGRect(x: 12, y: 40, width: 216, height: 52))
    let hostedView = NSView(frame: source.bounds)
    source.addSubview(hostedView)
    var restoreCount = 0
    let presentation = TerminalSidebarDragPresentation(collectionView: collectionView)
    presentation.begin(
      TerminalSidebarDragPresentation.Lift(
        rows: [
          TerminalSidebarLiftedRow(
            hostedView: hostedView,
            sourceFrame: source.frame,
            restore: {
              restoreCount += 1
              source.addSubview(hostedView)
            }
          )
        ],
        groupBackground: nil,
        fanAnchorIndex: nil,
        sourceFrame: source.frame,
        hotspot: .zero,
        screenPoint: .zero,
        timestamp: 0
      ),
      motionPolicy: TerminalSidebarMotionPolicy(reduceMotion: true)
    )

    presentation.handoffAfterExternalSuccess(.retained) {}

    #expect(restoreCount == 1)
    #expect(hostedView.superview === source)
  }

  @Test
  func batchPreviewUsesACompactFanAnchoredToTheClickedRow() {
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 1) == 0)
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 2) == 7)
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 8) == 7)
    #expect(TerminalSidebarLiveDragGeometry.fanSpacing(itemCount: 30) == 4)
    #expect(
      TerminalSidebarLiveDragGeometry.fanFrame(
        anchorFrame: CGRect(x: 12, y: 80, width: 200, height: 37),
        rowHeights: [37, 42, 51],
        anchorIndex: 1
      ) == CGRect(x: 12, y: 73, width: 200, height: 65)
    )
  }

  @Test
  func hapticTrackerFiresOnlyForPathChanges() {
    var tracker = TerminalSidebarHapticTargetTracker()
    let first = tracker.shouldPerform(for: .trailingRoot)
    let repeated = tracker.shouldPerform(for: .trailingRoot)
    let changed = tracker.shouldPerform(for: .pinnedEnd)
    let cleared = tracker.shouldPerform(for: nil)
    let restored = tracker.shouldPerform(for: .pinnedEnd)

    #expect(first)
    #expect(!repeated)
    #expect(changed)
    #expect(!cleared)
    #expect(restored)
  }
}
