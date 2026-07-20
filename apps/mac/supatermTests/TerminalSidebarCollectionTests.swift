import AppKit
import Testing

@testable import supaterm

struct TerminalSidebarCollectionTests {
  @Test
  func visibleEntriesPreserveRootAndGroupOrder() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()
    let group = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(first), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .group(group, .blue, [second, third]),
          isPinned: false
        ),
      ],
      collapsedGroupIDs: []
    )

    #expect(
      outline.visibleEntries.map(\.id) == [
        .tab(first),
        .pinDivider,
        .group(group),
        .tab(second),
        .tab(third),
        .newTab,
        .newGroup,
      ]
    )
  }

  @Test
  func collapsedGroupKeepsChildrenInTheSemanticOutline() {
    let tab = TerminalTabID()
    let group = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(group, .green, [tab]),
          isPinned: false
        )
      ],
      collapsedGroupIDs: [group]
    )

    #expect(outline.visibleEntries.map(\.id) == [.group(group), .newTab, .newGroup])
    #expect(outline.tabIDs(in: group) == [tab])
  }

  @Test
  func rootTabUsesTwentyFiveFiftyTwentyFiveDropZones() {
    let source = TerminalTabID()
    let target = TerminalTabID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
      ],
      collapsedGroupIDs: []
    )
    let frames: [TerminalSidebarEntryID: CGRect] = [
      .tab(source): CGRect(x: 0, y: 0, width: 200, height: 40),
      .tab(target): CGRect(x: 0, y: 42, width: 200, height: 40),
    ]

    #expect(
      resolve(.tab(source), y: 47, outline: outline, frames: frames)?.destination
        == .root(isPinned: false, index: 0)
    )
    #expect(
      resolve(.tab(source), y: 62, outline: outline, frames: frames)?.destination
        == .createGroup(targetTabID: target)
    )
    #expect(
      resolve(.tab(source), y: 77, outline: outline, frames: frames)?.destination
        == .root(isPinned: false, index: 1)
    )
  }

  @Test
  func extractingChildRetainsItsSourceGroupInRootIndexMath() {
    let child = TerminalTabID()
    let target = TerminalTabID()
    let group = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(group, .orange, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
      ],
      collapsedGroupIDs: []
    )
    let frames: [TerminalSidebarEntryID: CGRect] = [
      .group(group): CGRect(x: 0, y: 0, width: 200, height: 30),
      .tab(child): CGRect(x: 12, y: 32, width: 188, height: 30),
      .tab(target): CGRect(x: 0, y: 70, width: 200, height: 40),
    ]

    #expect(
      resolve(.tab(child), y: 73, outline: outline, frames: frames)?.destination
        == .root(isPinned: false, index: 1)
    )
  }

  @Test
  func droppingOnCollapsedGroupAppendsToItsSemanticChildren() {
    let source = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let group = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(group, .purple, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      collapsedGroupIDs: [group]
    )
    let frames: [TerminalSidebarEntryID: CGRect] = [
      .group(group): CGRect(x: 0, y: 0, width: 200, height: 30),
      .tab(source): CGRect(x: 0, y: 38, width: 200, height: 30),
    ]

    #expect(
      resolve(.tab(source), y: 15, outline: outline, frames: frames)?.destination
        == .group(group, index: 2)
    )
  }

  @Test
  func childDropUsesSiblingMidpoints() {
    let source = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let group = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(group, .pink, [first, second]),
          isPinned: false
        ),
      ],
      collapsedGroupIDs: []
    )
    let frames: [TerminalSidebarEntryID: CGRect] = [
      .tab(source): CGRect(x: 0, y: 0, width: 200, height: 30),
      .group(group): CGRect(x: 0, y: 38, width: 200, height: 30),
      .tab(first): CGRect(x: 12, y: 70, width: 188, height: 30),
      .tab(second): CGRect(x: 12, y: 102, width: 188, height: 30),
    ]

    #expect(
      resolve(.tab(source), y: 125, outline: outline, frames: frames)?.destination
        == .group(group, index: 2)
    )
  }

  @Test
  func appliedDropRequiresExactModelPlacement() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let group = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(group, .blue, [first, second]),
          isPinned: false
        )
      ],
      collapsedGroupIDs: []
    )

    #expect(
      TerminalSidebarDropCommit.isApplied(
        drag: .tab(second),
        destination: .group(group, index: 1),
        outline: outline
      )
    )
    #expect(
      !TerminalSidebarDropCommit.isApplied(
        drag: .tab(second),
        destination: .group(group, index: 0),
        outline: outline
      )
    )
  }

  @Test
  func wholeGroupDragCreatesOneCompositedGap() {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let target = TerminalTabID()
    let group = TerminalTabGroupID()
    let outline = TerminalSidebarOutline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(group, .red, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(target), isPinned: false),
      ],
      collapsedGroupIDs: []
    )
    let draggedIDs = outline.visibleEntryIDs(for: .group(group))
    let plan = TerminalSidebarLayoutPlan(
      entries: outline.visibleEntries,
      preferredHeights: Dictionary(
        uniqueKeysWithValues: outline.visibleEntries.map { ($0.id, CGFloat(30)) }
      ),
      draggedEntryIDs: draggedIDs,
      dropTarget: TerminalSidebarDropTarget(
        destination: .root(isPinned: false, index: 1),
        insertionEntryIndex: outline.visibleEntries.firstIndex { $0.id == .newTab },
        presentation: .rootGap
      ),
      width: 220
    )

    #expect(plan.items.filter { draggedIDs.contains($0.id) }.allSatisfy { $0.frame.height == 0 })
    #expect(plan.dropIndicatorFrame != nil)
  }

  @Test
  func dragBeginsAfterEightPointsEvenWhenTheFirstEventMovesPastTheSourceRow() {
    #expect(
      TerminalSidebarDragActivation.decision(
        from: CGPoint(x: 30, y: 30),
        to: CGPoint(x: 37.9, y: 30)
      ) == .pending
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        from: CGPoint(x: 30, y: 30),
        to: CGPoint(x: 38, y: 30)
      ) == .begin
    )
    #expect(
      TerminalSidebarDragActivation.decision(
        from: CGPoint(x: 30, y: 30),
        to: CGPoint(x: 130, y: 30)
      ) == .begin
    )
  }

  @Test @MainActor
  func collectionReplacesTheNativeDropIndicatorWithAnEmptyView() throws {
    let view = try #require(
      TerminalSidebarListController.supplementaryView(
        for: NSCollectionView.elementKindInterItemGapIndicator
      )
    )

    #expect(view.subviews.isEmpty)
    #expect(TerminalSidebarListController.supplementaryView(for: "other") == nil)
  }

  @Test @MainActor
  func collectionLayoutProvidesTheNativeDropIndicatorGeometry() throws {
    let layout = TerminalSidebarCollectionLayout()
    let attributes = try #require(
      layout.layoutAttributesForInterItemGap(before: IndexPath(item: 1, section: 0))
    )

    #expect(!attributes.isHidden)
    #expect(attributes.alpha == 1)
  }

  @Test @MainActor
  func dragRecognizerAcceptsDistinctMouseEventNumbers() throws {
    let tabID = TerminalTabID()
    let entryID = TerminalSidebarEntryID.tab(tabID)
    let collectionView = TerminalSidebarCollectionView(
      frame: CGRect(x: 0, y: 0, width: 200, height: 100)
    )
    let itemView = NSView(frame: collectionView.bounds)
    collectionView.installDragRecognizer(on: itemView)
    let window = NSWindow(
      contentRect: CGRect(x: 0, y: 0, width: 200, height: 100),
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.isReleasedWhenClosed = false
    window.contentView = collectionView
    defer { window.close() }
    collectionView.dragCandidate = { _ in
      TerminalSidebarDragCandidate(
        entryID: entryID
      )
    }

    var beganDrag = false
    collectionView.onDragBegan = { value, mouseDown, mouseDragged in
      #expect(value == entryID)
      #expect(mouseDown.eventNumber == 41)
      #expect(mouseDragged.eventNumber == 42)
      beganDrag = true
      return true
    }

    let recognizer = try #require(
      itemView.gestureRecognizers.compactMap { $0 as? TerminalSidebarDragGestureRecognizer }
        .first
    )
    let mouseDown = try #require(
      NSEvent.mouseEvent(
        with: .leftMouseDown,
        location: CGPoint(x: 20, y: 20),
        modifierFlags: [],
        timestamp: 0,
        windowNumber: window.windowNumber,
        context: nil,
        eventNumber: 41,
        clickCount: 1,
        pressure: 1
      )
    )
    let mouseDragged = try #require(
      NSEvent.mouseEvent(
        with: .leftMouseDragged,
        location: CGPoint(x: 40, y: 20),
        modifierFlags: [],
        timestamp: 0.1,
        windowNumber: window.windowNumber,
        context: nil,
        eventNumber: 42,
        clickCount: 1,
        pressure: 1
      )
    )
    recognizer.mouseDown(with: mouseDown)
    recognizer.mouseDragged(with: mouseDragged)

    #expect(beganDrag)
  }

  @Test @MainActor
  func dragRecognizerCoexistsWithEmbeddedRowGestures() throws {
    let collectionView = TerminalSidebarCollectionView(
      frame: CGRect(x: 0, y: 0, width: 200, height: 100)
    )
    let itemView = NSView(frame: collectionView.bounds)
    collectionView.installDragRecognizer(on: itemView)
    collectionView.installDragRecognizer(on: itemView)
    let recognizer = try #require(
      itemView.gestureRecognizers.compactMap { $0 as? TerminalSidebarDragGestureRecognizer }
        .first
    )
    let embeddedRecognizer = NSClickGestureRecognizer()

    #expect(itemView.gestureRecognizers.count == 1)
    #expect(!recognizer.shouldBeRequiredToFail(by: embeddedRecognizer))
    #expect(
      recognizer.delegate?.gestureRecognizer?(
        recognizer,
        shouldRecognizeSimultaneouslyWith: embeddedRecognizer
      ) == true
    )
  }

  @Test
  func hapticTrackerFiresOncePerSemanticDestination() {
    let group = TerminalTabGroupID()
    let destination = TerminalSidebarDropDestination.group(group, index: 0)
    var tracker = TerminalSidebarHapticTargetTracker()

    let firstEntry = tracker.shouldPerform(for: destination)
    let sameDestination = tracker.shouldPerform(for: destination)
    let changedDestination = tracker.shouldPerform(for: .group(group, index: 1))
    let exit = tracker.shouldPerform(for: nil)
    let reentry = tracker.shouldPerform(for: .group(group, index: 1))

    #expect(firstEntry)
    #expect(!sameDestination)
    #expect(changedDestination)
    #expect(!exit)
    #expect(reentry)
  }

  @Test
  func autoscrollVelocitySpansApprovedRange() {
    #expect(TerminalSidebarAutoscrollBehavior.velocity(penetration: 0) == 60)
    #expect(TerminalSidebarAutoscrollBehavior.velocity(penetration: 1) == 480)
    #expect(TerminalSidebarAutoscrollBehavior.velocity(penetration: 2) == 480)
  }

  private func resolve(
    _ drag: TerminalSidebarDragValue,
    y: CGFloat,
    outline: TerminalSidebarOutline,
    frames: [TerminalSidebarEntryID: CGRect]
  ) -> TerminalSidebarDropTarget? {
    TerminalSidebarDropTargetResolver.resolve(
      drag: drag,
      pointerY: y,
      outline: outline,
      frames: frames,
      groupFrames: [:]
    )
  }
}
