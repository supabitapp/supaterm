@preconcurrency import AppKit
import Combine
import SupatermTerminalFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SwiftUI

extension NSPasteboard.PasteboardType {
  static let terminalSidebarTabItem = NSPasteboard.PasteboardType(
    "app.supaterm.sidebar-tab-item"
  )
}

struct TerminalSidebarDragItem: Equatable {
  let tabID: TerminalTabID
}

struct TerminalSidebarDragPreviewItem {
  let tab: TerminalTabItem
  let notificationPreviewMarkdown: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let badgeActivities: [TerminalHostState.AgentActivity]
  let badgeActivity: TerminalHostState.AgentActivity?
  let badgeActivityIsFocused: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?
  let hasTerminalBell: Bool
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
}

struct TerminalSidebarPendingReorder: Equatable {
  let item: TerminalSidebarDragItem
  let sourceZone: TerminalSidebarDropZoneID
  let targetZone: TerminalSidebarDropZoneID
  let fromIndex: Int
  let toIndex: Int
}

@MainActor
final class TerminalSidebarDragSession: ObservableObject {
  @Published var draggedItem: TerminalSidebarDragItem?
  @Published var draggedPreview: TerminalSidebarDragPreviewItem?
  @Published var sourceZone: TerminalSidebarDropZoneID?
  @Published var sourceIndex: Int?
  @Published var activeZone: TerminalSidebarDropZoneID?
  @Published var insertionIndex: [TerminalSidebarDropZoneID: Int] = [:]
  @Published var pendingReorder: TerminalSidebarPendingReorder?
  @Published var cursorScreenLocation: NSPoint = .zero
  @Published var colorScheme: ColorScheme = .light
  @Published var sidebarScreenFrame: CGRect = .zero

  var zoneFrames: [TerminalSidebarDropZoneID: CGRect] = [:]
  var zoneScreenFrames: [TerminalSidebarDropZoneID: CGRect] = [:]
  var orderedTabIDs: [TerminalSidebarDropZoneID: [TerminalTabID]] = [:]
  var measuredTabFrames: [TerminalSidebarDropZoneID: [TerminalTabID: CGRect]] = [:]

  var isDragging: Bool {
    draggedItem != nil
  }

  var isCursorInSidebar: Bool {
    guard sidebarScreenFrame.width > 0 else { return false }
    return cursorScreenLocation.x >= sidebarScreenFrame.minX
      && cursorScreenLocation.x <= sidebarScreenFrame.maxX
  }

  var isSidebarReorder: Bool {
    TerminalSidebarLayout.centersDragPreviewInSidebar(
      sourceZone: sourceZone,
      activeZone: activeZone,
      isCursorInSidebar: isCursorInSidebar
    )
  }

  var previewRowWidth: CGFloat {
    if sidebarScreenFrame.width > 0 {
      return max(180, min(sidebarScreenFrame.width - 16, 320))
    }
    if let sourceZone, let frame = zoneFrames[sourceZone], frame.width > 0 {
      return max(180, min(frame.width - 16, 320))
    }
    return 200
  }

  private var previewWindow: TerminalSidebarDragPreviewWindow?

  private struct WeakDragSource {
    weak var view: TerminalSidebarDragSourceNSView?
  }

  private var registeredSources: [UUID: WeakDragSource] = [:]
  private var mouseMonitor: Any?
  private var activeDragSourceID: UUID?
  private var mouseDownPoint: NSPoint?
  private var dragInitiatedFromMonitor = false

  private static let dragThreshold: CGFloat = 4

  private enum MonitoredEventResult: Sendable {
    case passThrough
    case consumeAndStartDrag(UUID)
  }

  func registerDragSource(
    _ view: TerminalSidebarDragSourceNSView,
    id: UUID
  ) {
    registeredSources[id] = WeakDragSource(view: view)
    ensureEventMonitorActive()
  }

  func unregisterDragSource(
    id: UUID
  ) {
    registeredSources.removeValue(forKey: id)
    registeredSources = registeredSources.filter { $0.value.view != nil }
    if registeredSources.isEmpty {
      removeEventMonitor()
    }
  }

  func beginDrag(
    item: TerminalSidebarDragItem,
    preview: TerminalSidebarDragPreviewItem,
    from zone: TerminalSidebarDropZoneID,
    at index: Int
  ) {
    ensurePreviewWindow()
    draggedItem = item
    draggedPreview = preview
    sourceZone = zone
    sourceIndex = index
    activeZone = zone
    insertionIndex = [zone: index]
    pendingReorder = nil
    NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
  }

  nonisolated func updateCursorScreenPosition(
    _ screenPoint: NSPoint
  ) {
    Task { @MainActor in
      self.cursorScreenLocation = screenPoint
    }
  }

  func cursorEnteredZone(
    _ zone: TerminalSidebarDropZoneID
  ) {
    guard sourceZone != nil else { return }
    if activeZone != zone {
      activeZone = zone
      NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    }
  }

  func cursorExitedZone(
    _ zone: TerminalSidebarDropZoneID
  ) {
    guard activeZone == zone else { return }
    activeZone = nil
    insertionIndex[zone] = nil
  }

  func updateInsertionIndex(
    for zone: TerminalSidebarDropZoneID,
    localPoint: CGPoint
  ) {
    guard sourceZone != nil else { return }

    let orderedIDs = orderedTabIDs[zone] ?? []
    guard !orderedIDs.isEmpty else {
      insertionIndex[zone] = 0
      return
    }

    let clampedIndex = TerminalSidebarLayout.insertionIndex(
      for: localPoint.y,
      orderedIDs: orderedIDs,
      frames: measuredTabFrames[zone] ?? [:]
    )
    if insertionIndex[zone] != clampedIndex {
      insertionIndex[zone] = clampedIndex
      NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
    }
  }

  func completeDropIfPossible(
    in zone: TerminalSidebarDropZoneID
  ) {
    guard
      let draggedItem,
      let sourceZone,
      let sourceIndex,
      let destinationIndex = insertionIndex[zone]
    else {
      clearDrag()
      return
    }

    guard sourceZone != zone || sourceIndex != destinationIndex else {
      clearDrag()
      return
    }

    pendingReorder = TerminalSidebarPendingReorder(
      item: draggedItem,
      sourceZone: sourceZone,
      targetZone: zone,
      fromIndex: sourceIndex,
      toIndex: destinationIndex
    )
    NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .default)
    clearDrag()
  }

  func cancelDrag() {
    clearDrag()
  }

  func updateZoneFrame(
    for zone: TerminalSidebarDropZoneID,
    frame: CGRect,
    screenFrame: CGRect
  ) {
    zoneFrames[zone] = frame
    zoneScreenFrames[zone] = screenFrame
    sidebarScreenFrame = TerminalSidebarLayout.unionFrame(Array(zoneScreenFrames.values))
  }

  func reorderOffset(
    for zone: TerminalSidebarDropZoneID,
    tabID: TerminalTabID
  ) -> CGFloat {
    guard
      let draggedItem,
      let sourceZone,
      let sourceIndex
    else {
      return 0
    }

    let rowExtent = draggedRowExtent(for: draggedItem.tabID, in: sourceZone)
    guard let index = orderedTabIDs[zone]?.firstIndex(of: tabID) else { return 0 }

    if sourceZone == zone {
      if activeZone == zone {
        return TerminalSidebarLayout.reorderOffset(
          for: index,
          sourceIndex: sourceIndex,
          destinationIndex: insertionIndex[zone],
          rowExtent: rowExtent
        )
      }
      if activeZone != sourceZone, index > sourceIndex {
        return -rowExtent
      }
      return 0
    }

    guard activeZone == zone, let destinationIndex = insertionIndex[zone] else { return 0 }
    return index >= destinationIndex ? rowExtent : 0
  }

  func updateTabIDs(
    _ tabIDs: [TerminalTabID],
    for zone: TerminalSidebarDropZoneID
  ) {
    orderedTabIDs[zone] = tabIDs
  }

  func updateMeasuredTabFrames(
    _ frames: [TerminalTabID: TerminalSidebarMeasuredTabFrame]
  ) {
    var grouped: [TerminalSidebarDropZoneID: [TerminalTabID: CGRect]] = [:]
    for (tabID, measuredFrame) in frames {
      grouped[measuredFrame.zoneID, default: [:]][tabID] = measuredFrame.zoneFrame
    }
    measuredTabFrames = grouped
  }

  private func clearDrag() {
    draggedItem = nil
    draggedPreview = nil
    sourceZone = nil
    sourceIndex = nil
    activeZone = nil
    insertionIndex = [:]
  }

  private func draggedRowExtent(
    for tabID: TerminalTabID,
    in zone: TerminalSidebarDropZoneID
  ) -> CGFloat {
    let height = measuredTabFrames[zone]?[tabID]?.height ?? TerminalSidebarLayout.tabRowMinHeight
    return height + TerminalSidebarLayout.tabRowSpacing
  }

  private func ensurePreviewWindow() {
    guard previewWindow == nil else { return }
    previewWindow = TerminalSidebarDragPreviewWindow(manager: self)
  }

  private func ensureEventMonitorActive() {
    guard mouseMonitor == nil else { return }
    mouseMonitor = NSEvent.addLocalMonitorForEvents(
      matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]
    ) { [weak self] event in
      guard let self else { return event }
      return self.handleMonitoredEvent(event)
    }
  }

  private func removeEventMonitor() {
    if let mouseMonitor {
      NSEvent.removeMonitor(mouseMonitor)
      self.mouseMonitor = nil
    }
  }

  private func handleMonitoredEvent(
    _ event: NSEvent
  ) -> NSEvent? {
    switch handleMonitoredEventOnMain(event) {
    case .passThrough:
      return event
    case .consumeAndStartDrag(let sourceID):
      registeredSources[sourceID]?.view?.initiateDrag(with: event)
      return nil
    }
  }

  private func handleMonitoredEventOnMain(
    _ event: NSEvent
  ) -> MonitoredEventResult {
    if isDragging {
      return .passThrough
    }

    switch event.type {
    case .leftMouseDown:
      activeDragSourceID = nil
      mouseDownPoint = nil
      dragInitiatedFromMonitor = false

      for (id, source) in registeredSources {
        guard
          let view = source.view,
          let window = view.window,
          event.window == window
        else {
          continue
        }

        let localPoint = view.convert(event.locationInWindow, from: nil)
        if view.bounds.contains(localPoint) {
          activeDragSourceID = id
          mouseDownPoint = event.locationInWindow
          break
        }
      }

      return .passThrough

    case .leftMouseDragged:
      guard
        let activeDragSourceID,
        let mouseDownPoint,
        !dragInitiatedFromMonitor,
        registeredSources[activeDragSourceID]?.view != nil
      else {
        return .passThrough
      }

      let currentPoint = event.locationInWindow
      let distance = hypot(
        currentPoint.x - mouseDownPoint.x,
        currentPoint.y - mouseDownPoint.y
      )

      guard distance >= Self.dragThreshold else { return .passThrough }

      dragInitiatedFromMonitor = true
      return .consumeAndStartDrag(activeDragSourceID)

    case .leftMouseUp:
      activeDragSourceID = nil
      mouseDownPoint = nil
      dragInitiatedFromMonitor = false
      return .passThrough

    default:
      return .passThrough
    }
  }
}
