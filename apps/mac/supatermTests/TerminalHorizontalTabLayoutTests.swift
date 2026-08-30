import AppKit
import CoreGraphics
import Foundation
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

struct TerminalHorizontalTabLayoutTests {
  private struct Fixture {
    let snapshot: TerminalTabSurfaceSnapshot
    let groupID: TerminalTabGroupID
    let allEntryIDs: [TerminalSidebarEntryID]
  }

  @Test
  func wideLayoutShowsEveryItemWithoutScrollingOrOverflow() throws {
    let fixture = makeSnapshot()
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 900,
      measureTitle: { CGFloat($0.count * 7) }
    )

    #expect(layout.items.map(\.entryID) == fixture.allEntryIDs)
    #expect(layout.hiddenEntryIDs.isEmpty)
    #expect(layout.overflowFrame == nil)
    #expect(layout.sectionSeparatorFrame == CGRect(x: 74, y: 6, width: 8, height: 30))
    #expect(layout.items.allSatisfy { $0.frame.width <= 172 })
    #expect(layout.items.allSatisfy { $0.frame.height == 30 })
    #expect(layout.groups.count == 1)
    let rootTab = try #require(layout.items.first)
    let groupHeader = try #require(
      layout.items.first { $0.entryID == .group(fixture.groupID) }
    )
    #expect(rootTab.frame.width == 72)
    #expect(groupHeader.frame.width == 65)
    #expect(layout.newTabFrame == CGRect(x: 457, y: 5, width: 32, height: 32))
  }

  @Test
  func expandedGroupSurfaceJoinsItsHeaderAndTabs() throws {
    let fixture = makeSnapshot()
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 900,
      measureTitle: { CGFloat($0.count * 7) }
    )
    let group = try #require(layout.groups.first)
    let groupItems = layout.items.filter { item in
      switch item.kind {
      case .group(let id, _, _, _):
        id == fixture.groupID
      case .groupedTab(_, let groupID, _):
        groupID == fixture.groupID
      case .rootTab:
        false
      }
    }
    let itemFrame = try #require(
      groupItems.map(\.frame).reduce(Optional<CGRect>.none) { $0?.union($1) ?? $1 }
    )

    #expect(group.id == fixture.groupID)
    #expect(group.isCollapsed == false)
    #expect(group.frame.minX == itemFrame.minX - 2)
    #expect(group.frame.maxX == itemFrame.maxX + 2)
    #expect(group.frame.minY == 2)
    #expect(group.frame.maxY == TerminalHorizontalTabMetrics.height - 2)
    #expect(layout.dragSourceFrame(for: .group(fixture.groupID)) == group.frame)
    #expect(
      layout.dragSourceFrame(for: fixture.allEntryIDs[0])
        == layout.items.first?.frame
    )
  }

  @Test
  func collapsedGroupSourceFrameContainsOnlyItsProjectedHeader() throws {
    let fixture = makeSnapshot(isGroupCollapsed: true)
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 900,
      measureTitle: { CGFloat($0.count * 7) }
    )
    let group = try #require(layout.groups.first)
    let header = try #require(
      layout.items.first { $0.entryID == .group(fixture.groupID) }
    )

    #expect(layout.items.map(\.entryID) == fixture.allEntryIDs)
    #expect(group.isCollapsed)
    #expect(group.frame.minX == header.frame.minX - 2)
    #expect(group.frame.maxX == header.frame.maxX + 2)
    #expect(layout.dragSourceFrame(for: .group(fixture.groupID)) == group.frame)
  }

  @Test @MainActor
  func tabItemOwnsPointerEventsAcrossItsLabel() {
    let parent = NSView(frame: CGRect(x: 0, y: 0, width: 400, height: 100))
    let view = TerminalHorizontalTabItemView()
    view.frame = CGRect(x: 80, y: 40, width: 140, height: 30)
    parent.addSubview(view)
    view.layoutSubtreeIfNeeded()
    var pressCount = 0
    view.onAccessibilityPress = { pressCount += 1 }

    #expect(parent.hitTest(CGPoint(x: view.frame.midX, y: view.frame.midY)) === view)
    #expect(view.acceptsFirstMouse(for: nil))
    #expect(view.accessibilityPerformPress())
    #expect(pressCount == 1)
  }

  @Test @MainActor
  func tabChromeLeavesRoomForFittingTitle() throws {
    let view = TerminalHorizontalTabItemView()
    let label = try #require(view.subviews.compactMap { $0 as? NSTextField }.first)
    label.stringValue = "Shell"
    view.frame = CGRect(
      x: 0,
      y: 0,
      width: ceil(label.fittingSize.width)
        + TerminalHorizontalTabLayoutMetrics.tabTitleHorizontalInset,
      height: TerminalHorizontalTabLayoutMetrics.itemHeight
    )
    view.layoutSubtreeIfNeeded()

    #expect(label.frame.width >= label.fittingSize.width)
    #expect(label.frame.height == ceil(label.fittingSize.height))
    #expect(label.frame.midY == view.bounds.midY)
  }

  @Test @MainActor
  func sameSpaceGroupDropCommitsThroughTheLocalMoveTransaction() throws {
    let fixture = makeSnapshot()
    guard case .tab(let source) = fixture.snapshot.collection.rootItems.first else {
      Issue.record("Expected a root tab")
      return
    }
    let windowControllerID = UUID()
    let registry = TerminalTabDragRegistry()
    let controller = TerminalHorizontalTabStripController(
      windowControllerID: windowControllerID,
      tabDragRegistry: registry,
      captureRequest: { nil }
    )
    controller.view.frame = CGRect(
      x: 0,
      y: 0,
      width: 900,
      height: TerminalHorizontalTabMetrics.height
    )
    var committedCommand: TerminalSidebarDropCommand?
    controller.apply(
      snapshot: fixture.snapshot,
      palette: Palette(colorScheme: .dark),
      reduceMotion: true,
      actions: TerminalHorizontalTabStripController.Actions(
        closeTab: { _ in },
        newTab: {},
        selectTab: { _ in },
        toggleGroup: { _ in },
        performDrop: { command in
          committedCommand = command
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
        }
      )
    )
    controller.view.layoutSubtreeIfNeeded()
    let groupView = try #require(
      controller.view.subviews.compactMap { $0 as? TerminalHorizontalTabItemView }
        .first { $0.accessibilityLabel() == "Tab Group Build" }
    )
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: windowControllerID,
        sourceSpaceID: fixture.snapshot.spaceID,
        sourceTopologyRevision: fixture.snapshot.collection.topologyRevision,
        itemIDs: [.tab(source.tab.id)]
      )
    )
    registry.transfer = { _, _ in
      Issue.record("Same-space drops must not use cross-collection transfer")
      return nil
    }
    #expect(registry.begin(payload))

    #expect(
      controller.updateDrop(
        payload,
        at: CGPoint(x: groupView.frame.midX, y: groupView.frame.midY)
      ) == .move
    )
    #expect(controller.performDrop(payload))
    #expect(
      committedCommand
        == TerminalSidebarDropCommand(
          operationID: payload.moveOperationID,
          topologyStamp: TerminalSidebarTopologyStamp(
            spaceID: fixture.snapshot.spaceID,
            revision: fixture.snapshot.collection.topologyRevision
          ),
          itemIDs: [.tab(source.tab.id)],
          destination: .group(fixture.groupID, index: 0)
        )
    )
  }

  @Test
  func narrowLayoutUsesTheLongestOrderedPrefixAndExactHiddenSuffix() throws {
    let fixture = makeSnapshot(selectedTabIndex: 3)
    let selectedTabID = try #require(fixture.snapshot.collection.selectedTabID)
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 250,
      measureTitle: { CGFloat($0.count * 12) }
    )

    #expect(layout.overflowFrame != nil)
    #expect(layout.items.map(\.entryID) == Array(fixture.allEntryIDs.prefix(2)))
    #expect(layout.hiddenEntryIDs == Array(fixture.allEntryIDs.dropFirst(2)))
    #expect(layout.items.contains { $0.entryID == .tab(selectedTabID) } == false)
    #expect(layout.dragSourceFrame(for: .tab(selectedTabID)) == nil)
    #expect(layout.sectionSeparatorFrame?.width == 8)
    #expect(layout.sectionSeparatorFrame?.maxX == layout.items[1].frame.minX - 2)
    #expect(layout.items.map(\.frame.maxX).max() ?? 0 <= layout.overflowFrame?.minX ?? 0)
    #expect(layout.overflowFrame?.size == CGSize(width: 32, height: 32))
    #expect(layout.newTabFrame.size == CGSize(width: 32, height: 32))
  }

  @Test
  func selectedGroupDoesNotDisplaceTheVisiblePrefix() {
    let tabs = (0..<4).map { TerminalTabItem(title: "Tab \($0 + 1)") }
    let groupID = TerminalTabGroupID()
    let entryIDs: [TerminalSidebarEntryID] = [
      .tab(tabs[0].id),
      .tab(tabs[1].id),
      .group(groupID),
      .tab(tabs[2].id),
      .tab(tabs[3].id),
    ]
    let snapshot = TerminalTabSurfaceSnapshot(
      spaceID: TerminalSpaceID(),
      collection: TerminalTabCollectionSnapshot(
        rootItems: [
          .tab(TerminalUngroupedTabItem(tab: tabs[0], isPinned: false)),
          .tab(TerminalUngroupedTabItem(tab: tabs[1], isPinned: false)),
          .group(
            TerminalTabGroupItem(
              id: groupID,
              title: "Build",
              color: .blue,
              isPinned: false,
              tabs: Array(tabs[2...3])
            )
          ),
        ],
        selectedTabID: tabs[3].id,
        topologyRevision: 7
      ),
      collapsedGroupIDs: []
    )
    let layout = TerminalHorizontalTabLayout(
      snapshot: snapshot,
      availableWidth: 230,
      measureTitle: { _ in 0 }
    )

    #expect(layout.items.map(\.entryID) == Array(entryIDs.prefix(2)))
    #expect(layout.hiddenEntryIDs == Array(entryIDs.dropFirst(2)))
    #expect(layout.dragSourceFrame(for: .group(groupID)) == nil)
    #expect(layout.dragSourceFrame(for: .tab(tabs[3].id)) == nil)
  }

  @Test
  func sectionSeparatorConsumesBudgetOnlyWhenBothSectionsAreVisible() throws {
    let mixed = makeRootSnapshot(isPinned: [true, false])
    let regular = makeRootSnapshot(isPinned: [false, false])
    let constrainedMixedLayout = TerminalHorizontalTabLayout(
      snapshot: mixed.snapshot,
      availableWidth: 172,
      measureTitle: { _ in 0 }
    )
    let constrainedRegularLayout = TerminalHorizontalTabLayout(
      snapshot: regular.snapshot,
      availableWidth: 172,
      measureTitle: { _ in 0 }
    )
    let exactMixedLayout = TerminalHorizontalTabLayout(
      snapshot: mixed.snapshot,
      availableWidth: 178,
      measureTitle: { _ in 0 }
    )

    #expect(constrainedMixedLayout.items.map(\.entryID) == [mixed.entryIDs[0]])
    #expect(constrainedMixedLayout.hiddenEntryIDs == [mixed.entryIDs[1]])
    #expect(constrainedMixedLayout.sectionSeparatorFrame == nil)
    #expect(constrainedRegularLayout.items.map(\.entryID) == regular.entryIDs)
    #expect(constrainedRegularLayout.hiddenEntryIDs.isEmpty)
    #expect(constrainedRegularLayout.sectionSeparatorFrame == nil)
    #expect(exactMixedLayout.items.map(\.entryID) == mixed.entryIDs)
    #expect(exactMixedLayout.hiddenEntryIDs.isEmpty)
    #expect(exactMixedLayout.overflowFrame == nil)
    let separator = try #require(exactMixedLayout.sectionSeparatorFrame)
    #expect(separator == CGRect(x: 66, y: 6, width: 8, height: 30))
    #expect(exactMixedLayout.items[1].frame.minX == separator.maxX + 2)
    #expect(separator.minX == exactMixedLayout.items[0].frame.maxX)
  }

  @Test
  func controlsAndCloseGeometryUseRecoveredBounds() throws {
    let fixture = makeSnapshot(selectedTabIndex: 3)
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 250,
      measureTitle: { CGFloat($0.count * 12) }
    )
    let overflowFrame = try #require(layout.overflowFrame)

    #expect(TerminalHorizontalTabMetrics.height == 42)
    #expect(overflowFrame == CGRect(x: 180, y: 5, width: 32, height: 32))
    #expect(layout.newTabFrame == CGRect(x: 216, y: 5, width: 32, height: 32))
    #expect(
      TerminalHorizontalTabLayoutMetrics.closeButtonFrame(
        in: CGRect(x: 0, y: 0, width: 140, height: 30)
      ) == CGRect(x: 112, y: 4, width: 22, height: 22)
    )
  }

  @Test
  func zeroWidthStillProjectsTheFullNewTabControl() {
    let fixture = makeRootSnapshot(isPinned: [])
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 0,
      measureTitle: { _ in 0 }
    )

    #expect(layout.items.isEmpty)
    #expect(layout.hiddenEntryIDs.isEmpty)
    #expect(layout.overflowFrame == nil)
    #expect(layout.sectionSeparatorFrame == nil)
    #expect(layout.newTabFrame == CGRect(x: 0, y: 5, width: 32, height: 32))
  }

  @Test
  func longTabPreferredWidthStopsAt172() {
    let fixture = makeRootSnapshot(isPinned: [false])
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 500,
      measureTitle: { _ in 1_000 }
    )

    #expect(layout.items.first?.frame.width == 172)
  }

  @Test
  func dropHitTestingReturnsModelPaths() throws {
    let fixture = makeSnapshot()
    let layout = TerminalHorizontalTabLayout(
      snapshot: fixture.snapshot,
      availableWidth: 900,
      measureTitle: { CGFloat($0.count * 7) }
    )
    let root = try #require(layout.items.first)
    let group = try #require(
      layout.items.first { $0.entryID == .group(fixture.groupID) }
    )
    let groupedTab = try #require(
      layout.items.first { item in
        if case .groupedTab = item.kind { return true }
        return false
      }
    )
    let separator = try #require(layout.sectionSeparatorFrame)

    #expect(
      layout.semanticPath(at: CGPoint(x: root.frame.minX + 1, y: root.frame.midY))
        == .rootBoundary(lane: .pinned, index: 0)
    )
    #expect(
      layout.semanticPath(at: CGPoint(x: group.frame.midX, y: group.frame.midY))
        == .groupEntry(fixture.groupID)
    )
    #expect(
      layout.semanticPath(at: CGPoint(x: groupedTab.frame.maxX - 1, y: groupedTab.frame.midY))
        == .groupBoundary(fixture.groupID, index: 1)
    )
    #expect(
      layout.semanticPath(at: CGPoint(x: separator.midX, y: separator.midY))
        == .rootBoundary(lane: .pinned, index: 1)
    )
    #expect(
      layout.indicatorFrame(for: .rootBoundary(lane: .pinned, index: 0))
        == CGRect(x: 1, y: 7, width: 2, height: 28)
    )
    #expect(
      layout.indicatorFrame(for: .groupEntry(fixture.groupID))
        == CGRect(x: 115.5, y: 7, width: 2, height: 28)
    )
    #expect(
      layout.indicatorFrame(for: .groupBoundary(fixture.groupID, index: 1))
        == CGRect(x: 228, y: 7, width: 2, height: 28)
    )
  }

  @Test
  func dropMotionMatchesRecoveredReleaseCurve() {
    let motion = TerminalSidebarDropMotion.path(
      start: CGPoint(x: 10, y: 8),
      destination: CGPoint(x: 110, y: 8),
      velocity: CGVector(dx: 2_000, dy: 0)
    )

    #expect(motion.times == [0, 0.4, 0.7, 0.85, 1])
    #expect(motion.positions.count == 5)
    #expect(motion.positions[0] == CGPoint(x: 10, y: 8))
    #expect(motion.positions[1] == CGPoint(x: 60, y: 3))
    #expect(motion.positions[2] == CGPoint(x: 110, y: 8))
    #expect(motion.positions[3] == CGPoint(x: 110, y: 9))
    #expect(motion.positions[4] == CGPoint(x: 110, y: 8))
  }

  private func makeSnapshot(
    selectedTabIndex: Int = 0,
    isGroupCollapsed: Bool = false
  ) -> Fixture {
    let tabs = (0..<5).map { TerminalTabItem(title: "Tab \($0 + 1)") }
    let groupID = TerminalTabGroupID()
    let roots: [TerminalTabRootItem] = [
      .tab(TerminalUngroupedTabItem(tab: tabs[0], isPinned: true)),
      .group(
        TerminalTabGroupItem(
          id: groupID,
          title: "Build",
          color: .blue,
          isPinned: false,
          tabs: Array(tabs[1...3])
        )
      ),
      .tab(TerminalUngroupedTabItem(tab: tabs[4], isPinned: false)),
    ]
    return Fixture(
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSpaceID(),
        collection: TerminalTabCollectionSnapshot(
          rootItems: roots,
          selectedTabID: tabs[selectedTabIndex].id,
          topologyRevision: 7
        ),
        collapsedGroupIDs: isGroupCollapsed ? [groupID] : []
      ),
      groupID: groupID,
      allEntryIDs:
        isGroupCollapsed
        ? [.tab(tabs[0].id), .group(groupID), .tab(tabs[4].id)]
        : [
          .tab(tabs[0].id),
          .group(groupID),
          .tab(tabs[1].id),
          .tab(tabs[2].id),
          .tab(tabs[3].id),
          .tab(tabs[4].id),
        ]
    )
  }

  private func makeRootSnapshot(isPinned: [Bool]) -> (
    snapshot: TerminalTabSurfaceSnapshot,
    entryIDs: [TerminalSidebarEntryID]
  ) {
    let tabs = isPinned.indices.map { TerminalTabItem(title: "Tab \($0 + 1)") }
    return (
      snapshot: TerminalTabSurfaceSnapshot(
        spaceID: TerminalSpaceID(),
        collection: TerminalTabCollectionSnapshot(
          rootItems: zip(tabs, isPinned).map { tab, isPinned in
            .tab(TerminalUngroupedTabItem(tab: tab, isPinned: isPinned))
          },
          selectedTabID: tabs.first?.id,
          topologyRevision: 7
        ),
        collapsedGroupIDs: []
      ),
      entryIDs: tabs.map { .tab($0.id) }
    )
  }
}
