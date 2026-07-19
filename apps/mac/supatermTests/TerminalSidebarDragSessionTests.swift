import AppKit
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarDragSessionTests {
  private let session = TerminalSidebarDragSession()

  private func makePreview(tab: TerminalTabItem) -> TerminalSidebarDragPreviewItem {
    TerminalSidebarDragPreviewItem(
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
  }

  private func beginDrag(
    tab: TerminalTabItem,
    zone: TerminalSidebarDropZoneID,
    index: Int
  ) {
    session.beginDrag(
      item: TerminalSidebarDragItem(tabID: tab.id),
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
    session.updateTabIDs(tabs.map(\.id), for: zone)
    var frames: [TerminalTabID: TerminalSidebarMeasuredTabFrame] = [:]
    for (index, tab) in tabs.enumerated() {
      let frame = CGRect(
        x: 0,
        y: CGFloat(index) * (rowHeight + rowSpacing),
        width: 200,
        height: rowHeight
      )
      frames[tab.id] = TerminalSidebarMeasuredTabFrame(
        zoneID: zone,
        scrollFrame: frame,
        zoneFrame: frame
      )
    }
    session.updateMeasuredTabFrames(frames)
  }

  @Test
  func beginDragSeedsDragState() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")

    beginDrag(tab: tab, zone: .regular, index: 1)

    #expect(session.isDragging)
    #expect(session.draggedItem == TerminalSidebarDragItem(tabID: tab.id))
    #expect(session.sourceZone == .regular)
    #expect(session.sourceIndex == 1)
    #expect(session.activeZone == .regular)
    #expect(session.insertionIndex == [.regular: 1])
    #expect(session.pendingReorder == nil)
  }

  @Test
  func zoneUpdatesAreIgnoredWithoutActiveDrag() {
    session.updateTabIDs([TerminalTabID()], for: .regular)

    session.cursorEnteredZone(.pinned)
    session.updateInsertionIndex(for: .regular, localPoint: CGPoint(x: 10, y: 10))

    #expect(session.activeZone == nil)
    #expect(session.insertionIndex.isEmpty)
  }

  @Test
  func cursorZoneTransitionsTrackActiveZone() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: .pinned, index: 0)

    session.cursorEnteredZone(.regular)
    #expect(session.activeZone == .regular)

    session.cursorExitedZone(.pinned)
    #expect(session.activeZone == .regular)

    session.cursorExitedZone(.regular)
    #expect(session.activeZone == nil)
    #expect(session.insertionIndex[.regular] == nil)
  }

  @Test
  func insertionIndexInEmptyZoneIsZero() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: .regular, index: 0)

    session.updateInsertionIndex(for: .pinned, localPoint: CGPoint(x: 10, y: 50))

    #expect(session.insertionIndex[.pinned] == 0)
  }

  @Test
  func insertionIndexClampsToRowEdges() {
    let tabs = (1...3).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: .regular)
    beginDrag(tab: tabs[0], zone: .regular, index: 0)

    session.updateInsertionIndex(for: .regular, localPoint: CGPoint(x: 10, y: 5))
    #expect(session.insertionIndex[.regular] == 0)

    session.updateInsertionIndex(for: .regular, localPoint: CGPoint(x: 10, y: 50))
    #expect(session.insertionIndex[.regular] == 1)

    session.updateInsertionIndex(for: .regular, localPoint: CGPoint(x: 10, y: 500))
    #expect(session.insertionIndex[.regular] == 3)
  }

  @Test
  func dropAtSourcePositionProducesNoReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: .regular, index: 1)

    session.completeDropIfPossible(in: .regular)

    #expect(session.pendingReorder == nil)
    #expect(!session.isDragging)
  }

  @Test
  func dropWithinZoneProducesReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: .regular, index: 0)
    session.insertionIndex[.regular] = 2

    session.completeDropIfPossible(in: .regular)

    #expect(
      session.pendingReorder
        == TerminalSidebarPendingReorder(
          item: TerminalSidebarDragItem(tabID: tab.id),
          sourceZone: .regular,
          targetZone: .regular,
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
    beginDrag(tab: tab, zone: .regular, index: 1)
    session.cursorEnteredZone(.pinned)
    session.insertionIndex[.pinned] = 0

    session.completeDropIfPossible(in: .pinned)

    #expect(session.pendingReorder?.sourceZone == .regular)
    #expect(session.pendingReorder?.targetZone == .pinned)
    #expect(session.pendingReorder?.fromIndex == 1)
    #expect(session.pendingReorder?.toIndex == 0)
  }

  @Test
  func dropFromPinnedIntoRegularProducesCrossZoneReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: .pinned, index: 0)
    session.cursorEnteredZone(.regular)
    session.insertionIndex[.regular] = 2

    session.completeDropIfPossible(in: .regular)

    #expect(session.pendingReorder?.sourceZone == .pinned)
    #expect(session.pendingReorder?.targetZone == .regular)
    #expect(session.pendingReorder?.toIndex == 2)
  }

  @Test
  func dropWithoutInsertionIndexClearsDrag() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: .regular, index: 0)
    session.insertionIndex[.regular] = nil

    session.completeDropIfPossible(in: .pinned)

    #expect(session.pendingReorder == nil)
    #expect(!session.isDragging)
  }

  @Test
  func cancelDragClearsStateWithoutReorder() {
    let tab = TerminalTabItem(projectID: TerminalProjectID(), title: "Tab")
    beginDrag(tab: tab, zone: .regular, index: 0)
    session.cursorEnteredZone(.pinned)

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
    seedMeasuredFrames(tabs: tabs, zone: .regular)

    #expect(session.reorderOffset(for: .regular, tabID: tabs[1].id) == 0)
  }

  @Test
  func reorderOffsetShiftsIntermediateRowsWithinZone() {
    let tabs = (1...3).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: .regular)
    beginDrag(tab: tabs[0], zone: .regular, index: 0)
    session.insertionIndex[.regular] = 2

    #expect(session.reorderOffset(for: .regular, tabID: tabs[0].id) == 0)
    #expect(session.reorderOffset(for: .regular, tabID: tabs[1].id) == -38)
    #expect(session.reorderOffset(for: .regular, tabID: tabs[2].id) == -38)
  }

  @Test
  func reorderOffsetCollapsesSourceZoneWhenDraggedAway() {
    let tabs = (1...3).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: .regular)
    beginDrag(tab: tabs[0], zone: .regular, index: 0)
    session.cursorEnteredZone(.pinned)

    #expect(session.reorderOffset(for: .regular, tabID: tabs[0].id) == 0)
    #expect(session.reorderOffset(for: .regular, tabID: tabs[1].id) == -38)
    #expect(session.reorderOffset(for: .regular, tabID: tabs[2].id) == -38)
  }

  @Test
  func reorderOffsetMakesRoomInTargetZone() {
    let regular = TerminalTabItem(projectID: TerminalProjectID(), title: "Regular")
    let pinned = (1...2).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Pinned \($0)") }
    seedMeasuredFrames(tabs: [regular], zone: .regular)
    seedMeasuredFrames(tabs: pinned, zone: .pinned)
    beginDrag(tab: regular, zone: .regular, index: 0)
    session.cursorEnteredZone(.pinned)
    session.insertionIndex[.pinned] = 1

    #expect(session.reorderOffset(for: .pinned, tabID: pinned[0].id) == 0)
    let expected = TerminalSidebarLayout.tabRowMinHeight + TerminalSidebarLayout.tabRowSpacing
    #expect(session.reorderOffset(for: .pinned, tabID: pinned[1].id) == expected)
  }

  @Test
  func reorderOffsetFallsBackToMinimumRowExtentWhenUnmeasured() {
    let tabs = (1...2).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    session.updateTabIDs(tabs.map(\.id), for: .regular)
    beginDrag(tab: tabs[0], zone: .regular, index: 0)
    session.insertionIndex[.regular] = 1

    let expected = TerminalSidebarLayout.tabRowMinHeight + TerminalSidebarLayout.tabRowSpacing
    #expect(session.reorderOffset(for: .regular, tabID: tabs[1].id) == -expected)
  }

  @Test
  func reorderOffsetUsesMeasuredRowHeight() {
    let tabs = (1...2).map { TerminalTabItem(projectID: TerminalProjectID(), title: "Tab \($0)") }
    seedMeasuredFrames(tabs: tabs, zone: .regular, rowHeight: 48)
    beginDrag(tab: tabs[0], zone: .regular, index: 0)
    session.insertionIndex[.regular] = 1

    #expect(session.reorderOffset(for: .regular, tabID: tabs[1].id) == -50)
  }

  @Test
  func zoneFramesUnionIntoSidebarFrame() {
    session.updateZoneFrame(
      for: .pinned,
      frame: CGRect(x: 0, y: 0, width: 200, height: 100),
      screenFrame: CGRect(x: 0, y: 500, width: 200, height: 100)
    )
    session.updateZoneFrame(
      for: .regular,
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
      for: .regular,
      frame: .zero,
      screenFrame: CGRect(x: 0, y: 0, width: 200, height: 480)
    )
    #expect(session.previewRowWidth == 184)

    session.updateZoneFrame(
      for: .regular,
      frame: .zero,
      screenFrame: CGRect(x: 0, y: 0, width: 500, height: 480)
    )
    #expect(session.previewRowWidth == 320)

    session.updateZoneFrame(
      for: .regular,
      frame: .zero,
      screenFrame: CGRect(x: 0, y: 0, width: 100, height: 480)
    )
    #expect(session.previewRowWidth == 180)
  }
}
