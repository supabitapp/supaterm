import AppKit
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarDragSessionTests {
  private let projectID = TerminalProjectID()
  private let session = TerminalSidebarDragSession()

  private var pinnedZone: TerminalSidebarDropZoneID {
    .tabs(projectID: projectID, isPinned: true)
  }

  private var regularZone: TerminalSidebarDropZoneID {
    .tabs(projectID: projectID, isPinned: false)
  }

  private func makePreview(tab: TerminalTabItem) -> TerminalSidebarDragPreviewItem {
    .tab(
      TerminalSidebarTabDragPreviewItem(
        tab: tab,
        notificationPreviewText: nil,
        paneWorkingDirectories: [],
        unreadCount: 0,
        badgeActivities: [],
        badgeActivity: nil,
        badgeActivityIsFocused: false,
        terminalProgress: nil,
        hasTerminalBell: false,
        showsAgentMarks: false,
        showsAgentSpinner: false
      )
    )
  }

  private func beginDrag(
    tab: TerminalTabItem,
    zone: TerminalSidebarDropZoneID,
    index: Int
  ) {
    session.beginDrag(
      item: .tab(tab.id),
      preview: makePreview(tab: tab),
      from: zone,
      at: index
    )
  }

  private func seedMeasuredFrames(
    tabs: [TerminalTabItem],
    zone: TerminalSidebarDropZoneID,
    rowHeight: CGFloat = 36,
    rowSpacing: CGFloat = 2
  ) {
    var orderedItems = session.orderedItems
    orderedItems[zone] = tabs.map { .tab($0.id) }
    session.replaceOrderedItems(orderedItems)
    var frames = session.measuredItemFrames
    for (index, tab) in tabs.enumerated() {
      let frame = CGRect(
        x: 0,
        y: CGFloat(index) * (rowHeight + rowSpacing),
        width: 200,
        height: rowHeight
      )
      frames[.tab(tab.id)] = TerminalSidebarMeasuredDragItemFrame(
        zoneID: zone,
        scrollFrame: frame,
        zoneFrame: frame
      )
    }
    session.updateMeasuredItemFrames(frames)
  }

  @Test
  func beginDragSeedsDragState() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")

    beginDrag(tab: tab, zone: regularZone, index: 1)

    #expect(session.isDragging)
    #expect(session.draggedItem == .tab(tab.id))
    #expect(session.sourceZone == regularZone)
    #expect(session.sourceIndex == 1)
    #expect(session.activeZone == regularZone)
    #expect(session.insertionIndex == [regularZone: 1])
    #expect(session.pendingReorder == nil)
  }

  @Test
  func zoneUpdatesAreIgnoredWithoutActiveDrag() {
    session.replaceOrderedItems([regularZone: [.tab(TerminalTabID())]])

    session.cursorEnteredZone(pinnedZone)
    session.updateInsertionIndex(for: regularZone, localPoint: CGPoint(x: 10, y: 10))

    #expect(session.activeZone == nil)
    #expect(session.insertionIndex.isEmpty)
  }

  @Test
  func cursorZoneTransitionsTrackActiveZone() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: pinnedZone, index: 0)

    session.cursorEnteredZone(regularZone)
    #expect(session.activeZone == regularZone)

    session.cursorExitedZone(pinnedZone)
    #expect(session.activeZone == regularZone)

    session.cursorExitedZone(regularZone)
    #expect(session.activeZone == nil)
    #expect(session.insertionIndex[regularZone] == nil)
  }

  @Test
  func insertionIndexInEmptyPinnedZoneIsZero() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: regularZone, index: 0)

    session.updateInsertionIndex(for: pinnedZone, localPoint: CGPoint(x: 10, y: 50))

    #expect(session.insertionIndex[pinnedZone] == 0)
  }

  @Test
  func insertionIndexInEmptyRegularZoneIsZero() {
    let tab = TerminalTabItem(projectID: projectID, title: "Tab", isPinned: true)
    beginDrag(tab: tab, zone: pinnedZone, index: 0)

    session.updateInsertionIndex(for: regularZone, localPoint: CGPoint(x: 10, y: 50))

    #expect(session.insertionIndex[regularZone] == 0)
  }

  @Test
  func tabDragRejectsAnotherProjectsZones() {
    let tab = TerminalTabItem(projectID: projectID, title: "Tab")
    let otherZone = TerminalSidebarDropZoneID.tabs(
      projectID: TerminalProjectID(),
      isPinned: true
    )
    beginDrag(tab: tab, zone: regularZone, index: 0)

    session.cursorEnteredZone(otherZone)
    session.updateInsertionIndex(for: otherZone, localPoint: CGPoint(x: 10, y: 10))

    #expect(session.activeZone == regularZone)
    #expect(session.insertionIndex[otherZone] == nil)
  }

  @Test
  func projectDropAcrossBoundaryProducesPinToggleReorder() {
    let project = TerminalProjectItem(folderPath: "/work/project")
    let sourceZone = TerminalSidebarDropZoneID.projects(isPinned: false)
    let targetZone = TerminalSidebarDropZoneID.projects(isPinned: true)
    session.beginDrag(
      item: .project(project.id),
      preview: .project(
        TerminalSidebarProjectDragPreviewItem(
          project: project,
          displayName: "project",
          isCollapsed: false
        )
      ),
      from: sourceZone,
      at: 1
    )
    session.cursorEnteredZone(targetZone)
    session.updateInsertionIndex(for: targetZone, localPoint: CGPoint(x: 10, y: 10))

    session.completeDropIfPossible(in: targetZone)

    #expect(
      session.pendingReorder
        == TerminalSidebarPendingReorder(
          item: .project(project.id),
          sourceZone: sourceZone,
          targetZone: targetZone,
          fromIndex: 1,
          toIndex: 0
        )
    )
  }

  @Test
  func insertionIndexClampsToRowEdges() {
    let tabs = (1...3).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: regularZone)
    beginDrag(tab: tabs[0], zone: regularZone, index: 0)

    session.updateInsertionIndex(for: regularZone, localPoint: CGPoint(x: 10, y: 5))
    #expect(session.insertionIndex[regularZone] == 0)

    session.updateInsertionIndex(for: regularZone, localPoint: CGPoint(x: 10, y: 50))
    #expect(session.insertionIndex[regularZone] == 1)

    session.updateInsertionIndex(for: regularZone, localPoint: CGPoint(x: 10, y: 500))
    #expect(session.insertionIndex[regularZone] == 3)
  }

  @Test
  func dropAtSourcePositionProducesNoReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: regularZone, index: 1)

    session.completeDropIfPossible(in: regularZone)

    #expect(session.pendingReorder == nil)
    #expect(!session.isDragging)
  }

  @Test
  func dropWithinZoneProducesReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: regularZone, index: 0)
    session.insertionIndex[regularZone] = 2

    session.completeDropIfPossible(in: regularZone)

    #expect(
      session.pendingReorder
        == TerminalSidebarPendingReorder(
          item: .tab(tab.id),
          sourceZone: regularZone,
          targetZone: regularZone,
          fromIndex: 0,
          toIndex: 2
        )
    )
    #expect(!session.isDragging)
    #expect(session.sourceZone == nil)
    #expect(session.insertionIndex.isEmpty)
  }

  @Test
  func dropAcrossZonesProducesCrossZoneReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: regularZone, index: 1)
    session.cursorEnteredZone(pinnedZone)
    session.insertionIndex[pinnedZone] = 0

    session.completeDropIfPossible(in: pinnedZone)

    #expect(session.pendingReorder?.sourceZone == regularZone)
    #expect(session.pendingReorder?.targetZone == pinnedZone)
    #expect(session.pendingReorder?.fromIndex == 1)
    #expect(session.pendingReorder?.toIndex == 0)
  }

  @Test
  func dropFromPinnedIntoRegularProducesCrossZoneReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: pinnedZone, index: 0)
    session.cursorEnteredZone(regularZone)
    session.insertionIndex[regularZone] = 2

    session.completeDropIfPossible(in: regularZone)

    #expect(session.pendingReorder?.sourceZone == pinnedZone)
    #expect(session.pendingReorder?.targetZone == regularZone)
    #expect(session.pendingReorder?.toIndex == 2)
  }

  @Test
  func dropWithoutInsertionIndexClearsDrag() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: regularZone, index: 0)
    session.insertionIndex[regularZone] = nil

    session.completeDropIfPossible(in: pinnedZone)

    #expect(session.pendingReorder == nil)
    #expect(!session.isDragging)
  }

  @Test
  func cancelDragClearsStateWithoutReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: regularZone, index: 0)
    session.cursorEnteredZone(pinnedZone)

    session.cancelDrag()

    #expect(!session.isDragging)
    #expect(session.draggedPreview == nil)
    #expect(session.sourceZone == nil)
    #expect(session.sourceIndex == nil)
    #expect(session.activeZone == nil)
    #expect(session.insertionIndex.isEmpty)
    #expect(session.pendingReorder == nil)
  }

  @Test
  func reorderOffsetIsZeroWithoutActiveDrag() {
    let tabs = (1...2).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: regularZone)

    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[1].id)) == 0)
  }

  @Test
  func reorderOffsetShiftsIntermediateRowsWithinZone() {
    let tabs = (1...3).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: regularZone)
    beginDrag(tab: tabs[0], zone: regularZone, index: 0)
    session.insertionIndex[regularZone] = 2

    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[0].id)) == 0)
    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[1].id)) == -38)
    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[2].id)) == -38)
  }

  @Test
  func reorderOffsetCollapsesSourceZoneWhenDraggedAway() {
    let tabs = (1...3).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: regularZone)
    beginDrag(tab: tabs[0], zone: regularZone, index: 0)
    session.cursorEnteredZone(pinnedZone)

    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[0].id)) == 0)
    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[1].id)) == -38)
    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[2].id)) == -38)
  }

  @Test
  func reorderOffsetMakesRoomInTargetZone() {
    let regular = TerminalTabItem(projectID: TerminalProjectID(), title: "Regular")
    let pinned = (1...2).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Pinned \($0)") }
    seedMeasuredFrames(tabs: [regular], zone: regularZone)
    seedMeasuredFrames(tabs: pinned, zone: pinnedZone)
    beginDrag(tab: regular, zone: regularZone, index: 0)
    session.cursorEnteredZone(pinnedZone)
    session.insertionIndex[pinnedZone] = 1

    #expect(session.reorderOffset(for: pinnedZone, item: .tab(pinned[0].id)) == 0)
    let expected: CGFloat = 38
    #expect(session.reorderOffset(for: pinnedZone, item: .tab(pinned[1].id)) == expected)
  }

  @Test
  func reorderOffsetFallsBackToMinimumRowExtentWhenUnmeasured() {
    let tabs = (1...2).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    session.replaceOrderedItems([regularZone: tabs.map { .tab($0.id) }])
    beginDrag(tab: tabs[0], zone: regularZone, index: 0)
    session.insertionIndex[regularZone] = 1

    let expected = TerminalSidebarLayout.tabRowMinHeight + TerminalSidebarLayout.tabRowSpacing
    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[1].id)) == -expected)
  }

  @Test
  func reorderOffsetUsesMeasuredRowHeight() {
    let tabs = (1...2).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: regularZone, rowHeight: 48)
    beginDrag(tab: tabs[0], zone: regularZone, index: 0)
    session.insertionIndex[regularZone] = 1

    #expect(session.reorderOffset(for: regularZone, item: .tab(tabs[1].id)) == -50)
  }

  @Test
  func projectReorderOffsetUsesMeasuredGroupHeightAndSpacing() {
    let projects = [
      TerminalProjectItem(folderPath: "/work/first"),
      TerminalProjectItem(folderPath: "/work/second"),
    ]
    let zone = TerminalSidebarDropZoneID.projects(isPinned: false)
    let items = projects.map { TerminalSidebarDragItem.project($0.id) }
    session.replaceOrderedItems([zone: items])
    session.updateMeasuredItemFrames(
      Dictionary(
        uniqueKeysWithValues: items.enumerated().map { index, item in
          let frame = CGRect(x: 0, y: CGFloat(index) * 108, width: 200, height: 100)
          return (
            item,
            TerminalSidebarMeasuredDragItemFrame(
              zoneID: zone,
              scrollFrame: frame,
              zoneFrame: frame
            )
          )
        }
      )
    )
    session.beginDrag(
      item: items[0],
      preview: .project(
        TerminalSidebarProjectDragPreviewItem(
          project: projects[0],
          displayName: "first",
          isCollapsed: false
        )
      ),
      from: zone,
      at: 0
    )
    session.insertionIndex[zone] = 1

    #expect(session.reorderOffset(for: zone, item: items[1]) == -108)
  }

  @Test
  func zoneFramesUnionIntoSidebarFrame() {
    session.updateZoneFrame(
      for: pinnedZone,
      frame: CGRect(x: 0, y: 0, width: 200, height: 100),
      screenFrame: CGRect(x: 0, y: 500, width: 200, height: 100)
    )
    session.updateZoneFrame(
      for: regularZone,
      frame: CGRect(x: 0, y: 100, width: 200, height: 480),
      screenFrame: CGRect(x: 0, y: 0, width: 200, height: 480)
    )

    #expect(session.sidebarScreenFrame == CGRect(x: 0, y: 0, width: 200, height: 600))

    session.cursorScreenLocation = NSPoint(x: 100, y: 50)
    #expect(session.isCursorInSidebar)

    session.cursorScreenLocation = NSPoint(x: 300, y: 50)
    #expect(!session.isCursorInSidebar)
  }

  @Test
  func previewRowWidthClampsToSidebarWidth() {
    #expect(session.previewRowWidth == 200)

    session.updateZoneFrame(
      for: regularZone,
      frame: .zero,
      screenFrame: CGRect(x: 0, y: 0, width: 200, height: 480)
    )
    #expect(session.previewRowWidth == 184)

    session.updateZoneFrame(
      for: regularZone,
      frame: .zero,
      screenFrame: CGRect(x: 0, y: 0, width: 500, height: 480)
    )
    #expect(session.previewRowWidth == 320)

    session.updateZoneFrame(
      for: regularZone,
      frame: .zero,
      screenFrame: CGRect(x: 0, y: 0, width: 100, height: 480)
    )
    #expect(session.previewRowWidth == 180)
  }
}
