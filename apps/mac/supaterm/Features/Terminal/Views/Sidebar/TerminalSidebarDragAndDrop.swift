@preconcurrency import AppKit
import Combine
import SupaTheme
import SwiftUI

extension NSPasteboard.PasteboardType {
  static let terminalSidebarTabItem = NSPasteboard.PasteboardType(
    "app.supaterm.sidebar-tab-item"
  )
  static let terminalSidebarProjectItem = NSPasteboard.PasteboardType(
    "app.supaterm.sidebar-project-item"
  )
}

extension TerminalSidebarDropZoneID {
  var pasteboardType: NSPasteboard.PasteboardType {
    switch self {
    case .projects:
      .terminalSidebarProjectItem
    case .tabs:
      .terminalSidebarTabItem
    }
  }
}

enum TerminalSidebarDragItem: Equatable, Hashable {
  case project(TerminalProjectID)
  case tab(TerminalTabID)

  var pasteboardType: NSPasteboard.PasteboardType {
    switch self {
    case .project:
      .terminalSidebarProjectItem
    case .tab:
      .terminalSidebarTabItem
    }
  }

  var pasteboardValue: String {
    switch self {
    case .project(let projectID):
      projectID.rawValue.uuidString
    case .tab(let tabID):
      tabID.rawValue.uuidString
    }
  }
}

struct TerminalSidebarTabDragPreviewItem {
  let tab: TerminalTabItem
  let notificationPreviewText: String?
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

struct TerminalSidebarProjectDragPreviewItem {
  let project: TerminalProjectItem
  let displayName: String
  let isCollapsed: Bool
}

enum TerminalSidebarDragPreviewItem {
  case project(TerminalSidebarProjectDragPreviewItem)
  case tab(TerminalSidebarTabDragPreviewItem)
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
  @Published private(set) var measuredItemFrames: [TerminalSidebarDragItem: TerminalSidebarMeasuredDragItemFrame] = [:]

  var zoneFrames: [TerminalSidebarDropZoneID: CGRect] = [:]
  var zoneScreenFrames: [TerminalSidebarDropZoneID: CGRect] = [:]
  var orderedItems: [TerminalSidebarDropZoneID: [TerminalSidebarDragItem]] = [:]

  var isDragging: Bool {
    draggedItem != nil
  }

  var isDraggingProject: Bool {
    guard case .project? = draggedItem else { return false }
    return true
  }

  func isDraggingTab(
    in projectID: TerminalProjectID
  ) -> Bool {
    guard
      case .tab? = draggedItem,
      case .tabs(let sourceProjectID, _)? = sourceZone
    else {
      return false
    }
    return sourceProjectID == projectID
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
    guard canDrop(in: zone) else { return }
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
    guard canDrop(in: zone) else { return }

    let orderedItems = orderedItems[zone] ?? []
    guard !orderedItems.isEmpty else {
      insertionIndex[zone] = 0
      return
    }

    let clampedIndex = TerminalSidebarLayout.insertionIndex(
      for: localPoint.y,
      orderedIDs: orderedItems,
      frames: Dictionary(
        uniqueKeysWithValues: orderedItems.compactMap { item in
          guard let frame = measuredItemFrames[item], frame.zoneID == zone else { return nil }
          return (item, frame.zoneFrame)
        }
      )
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
      canDrop(in: zone),
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

  func removeZone(
    _ zone: TerminalSidebarDropZoneID
  ) {
    zoneFrames[zone] = nil
    zoneScreenFrames[zone] = nil
    Task { @MainActor [weak self] in
      guard let self else { return }
      sidebarScreenFrame = TerminalSidebarLayout.unionFrame(Array(zoneScreenFrames.values))
    }
  }

  func reorderOffset(
    for zone: TerminalSidebarDropZoneID,
    item: TerminalSidebarDragItem
  ) -> CGFloat {
    guard
      let draggedItem,
      let sourceZone,
      let sourceIndex
    else {
      return 0
    }

    let rowExtent = draggedRowExtent(for: draggedItem, in: sourceZone)
    guard let index = orderedItems[zone]?.firstIndex(of: item) else { return 0 }

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

  func replaceOrderedItems(
    _ orderedItems: [TerminalSidebarDropZoneID: [TerminalSidebarDragItem]]
  ) {
    self.orderedItems = orderedItems
  }

  func updateMeasuredItemFrames(
    _ frames: [TerminalSidebarDragItem: TerminalSidebarMeasuredDragItemFrame]
  ) {
    measuredItemFrames = frames
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
    for item: TerminalSidebarDragItem,
    in zone: TerminalSidebarDropZoneID
  ) -> CGFloat {
    let measuredFrame = measuredItemFrames[item]
    let height =
      if let measuredFrame, measuredFrame.zoneID == zone {
        measuredFrame.zoneFrame.height
      } else {
        TerminalSidebarLayout.tabRowMinHeight
      }
    let spacing =
      switch zone {
      case .projects:
        TerminalSidebarLayout.projectGroupSpacing
      case .tabs:
        TerminalSidebarLayout.tabRowSpacing
      }
    return height + spacing
  }

  func canDrop(
    in zone: TerminalSidebarDropZoneID
  ) -> Bool {
    guard let draggedItem, let sourceZone else { return false }
    return switch (draggedItem, sourceZone, zone) {
    case (.project, .projects, .projects):
      true
    case (
      .tab,
      .tabs(let sourceProjectID, _),
      .tabs(let targetProjectID, _)
    ):
      sourceProjectID == targetProjectID
    default:
      false
    }
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

@MainActor
final class TerminalSidebarDragPreviewWindow: NSWindow {
  static let previewSize = NSSize(width: 320, height: 160)

  private weak var manager: TerminalSidebarDragSession?
  private var cancellables = Set<AnyCancellable>()

  init(manager: TerminalSidebarDragSession) {
    self.manager = manager

    super.init(
      contentRect: NSRect(origin: .zero, size: Self.previewSize),
      styleMask: [.borderless],
      backing: .buffered,
      defer: true
    )

    isOpaque = false
    backgroundColor = .clear
    level = .floating
    ignoresMouseEvents = true
    hasShadow = false
    isReleasedWhenClosed = false
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    contentView = NSHostingView(
      rootView: AnyView(TerminalSidebarDragPreviewContent(manager: manager))
    )

    manager.$draggedItem
      .map { $0 != nil }
      .removeDuplicates()
      .receive(on: RunLoop.main)
      .sink { [weak self] isVisible in
        guard let self else { return }
        if isVisible {
          self.orderFront(nil)
        } else {
          self.orderOut(nil)
        }
      }
      .store(in: &cancellables)

    manager.$cursorScreenLocation
      .receive(on: RunLoop.main)
      .sink { [weak self] screenPoint in
        self?.updatePosition(screenPoint: screenPoint)
      }
      .store(in: &cancellables)

    manager.$activeZone
      .receive(on: RunLoop.main)
      .sink { [weak self] _ in
        guard let self, let manager = self.manager else { return }
        self.updatePosition(screenPoint: manager.cursorScreenLocation)
      }
      .store(in: &cancellables)

    manager.$sidebarScreenFrame
      .receive(on: RunLoop.main)
      .sink { [weak self] _ in
        guard let self, let manager = self.manager else { return }
        self.updatePosition(screenPoint: manager.cursorScreenLocation)
      }
      .store(in: &cancellables)
  }

  private func updatePosition(
    screenPoint: NSPoint
  ) {
    guard let manager, manager.isDragging else { return }
    let size = Self.previewSize

    if manager.isSidebarReorder {
      let origin = NSPoint(
        x: manager.sidebarScreenFrame.midX - (size.width / 2),
        y: screenPoint.y - (size.height / 2)
      )
      setFrame(NSRect(origin: origin, size: size), display: true)
      return
    }

    let origin = NSPoint(
      x: screenPoint.x - (size.width / 2),
      y: screenPoint.y - (size.height / 2)
    )
    setFrame(NSRect(origin: origin, size: size), display: true)
  }
}

private struct TerminalSidebarDragPreviewContent: View {
  @ObservedObject var manager: TerminalSidebarDragSession

  var body: some View {
    Group {
      if let preview = manager.draggedPreview {
        let palette = Palette(colorScheme: manager.colorScheme)
        switch preview {
        case .project(let projectPreview):
          TerminalSidebarProjectDragPreview(
            preview: projectPreview,
            rowWidth: manager.previewRowWidth,
            palette: palette
          )
        case .tab(let tabPreview):
          TerminalSidebarMorphingPreview(
            preview: tabPreview,
            rowWidth: manager.previewRowWidth,
            palette: palette
          )
        }
      } else {
        Color.clear
      }
    }
    .frame(
      width: TerminalSidebarDragPreviewWindow.previewSize.width,
      height: TerminalSidebarDragPreviewWindow.previewSize.height
    )
  }
}

private struct TerminalSidebarMorphingPreview: View {
  let preview: TerminalSidebarTabDragPreviewItem
  let rowWidth: CGFloat
  let palette: Palette

  var body: some View {
    TerminalSidebarTabSummaryView(
      tab: preview.tab,
      palette: palette,
      isSelected: true,
      notificationPreviewText: preview.notificationPreviewText,
      paneWorkingDirectories: preview.paneWorkingDirectories,
      unreadCount: preview.unreadCount,
      badgeActivities: preview.badgeActivities,
      badgeActivity: preview.badgeActivity,
      badgeActivityIsFocused: preview.badgeActivityIsFocused,
      hasTerminalBell: preview.hasTerminalBell,
      terminalProgress: preview.terminalProgress,
      showsAgentMarks: preview.showsAgentMarks,
      showsAgentSpinner: preview.showsAgentSpinner,
      shortcutHint: nil,
      showsShortcutHint: false,
      isRowHovering: false
    )
    .lineLimit(10)
    .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(width: rowWidth)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .background(palette.sidebarDragPreviewFill)
    .clipShape(
      RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
    )
    .shadow(
      color: palette.overlayShadow,
      radius: 8,
      y: 2
    )
  }
}

private struct TerminalSidebarProjectDragPreview: View {
  let preview: TerminalSidebarProjectDragPreviewItem
  let rowWidth: CGFloat
  let palette: Palette

  var body: some View {
    TerminalSidebarProjectHeaderLabel(
      project: preview.project,
      displayName: preview.displayName,
      isCollapsed: preview.isCollapsed,
      palette: palette
    )
    .frame(width: rowWidth)
    .background(palette.sidebarDragPreviewFill)
    .clipShape(
      RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
    )
    .shadow(
      color: palette.overlayShadow,
      radius: 8,
      y: 2
    )
  }
}

@MainActor
final class TerminalSidebarDragSourceCoordinator: NSObject, NSDraggingSource {
  var item: TerminalSidebarDragItem
  var preview: TerminalSidebarDragPreviewItem
  var zoneID: TerminalSidebarDropZoneID
  var index: Int
  let manager: TerminalSidebarDragSession

  init(
    item: TerminalSidebarDragItem,
    preview: TerminalSidebarDragPreviewItem,
    zoneID: TerminalSidebarDropZoneID,
    index: Int,
    manager: TerminalSidebarDragSession
  ) {
    self.item = item
    self.preview = preview
    self.zoneID = zoneID
    self.index = index
    self.manager = manager
  }

  nonisolated func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    context == .withinApplication ? .move : []
  }

  nonisolated func draggingSession(
    _ session: NSDraggingSession,
    movedTo screenPoint: NSPoint
  ) {
    manager.updateCursorScreenPosition(screenPoint)
  }

  nonisolated func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    Task { @MainActor in
      manager.cancelDrag()
    }
  }
}

final class TerminalSidebarDragSourceNSView: NSView {
  var coordinator: TerminalSidebarDragSourceCoordinator?
  private(set) var registrationID: UUID?

  func registerWithManager() {
    guard let coordinator else { return }
    let registrationID = UUID()
    self.registrationID = registrationID
    coordinator.manager.registerDragSource(self, id: registrationID)
  }

  func unregisterFromManager() {
    guard let registrationID, let coordinator else { return }
    coordinator.manager.unregisterDragSource(id: registrationID)
    self.registrationID = nil
  }

  func initiateDrag(
    with event: NSEvent
  ) {
    guard let coordinator else { return }

    coordinator.manager.beginDrag(
      item: coordinator.item,
      preview: coordinator.preview,
      from: coordinator.zoneID,
      at: coordinator.index
    )

    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(
      coordinator.item.pasteboardValue,
      forType: coordinator.item.pasteboardType
    )

    let transparentImage = NSImage(size: NSSize(width: 1, height: 1))
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(
      NSRect(x: 0, y: 0, width: 1, height: 1),
      contents: transparentImage
    )

    beginDraggingSession(with: [draggingItem], event: event, source: coordinator)
  }
}

private struct TerminalSidebarDragSourceAnchor: NSViewRepresentable {
  let item: TerminalSidebarDragItem
  let preview: TerminalSidebarDragPreviewItem
  let zoneID: TerminalSidebarDropZoneID
  let index: Int
  let manager: TerminalSidebarDragSession

  func makeNSView(
    context: Context
  ) -> TerminalSidebarDragSourceNSView {
    let view = TerminalSidebarDragSourceNSView()
    view.coordinator = context.coordinator
    view.registerWithManager()
    return view
  }

  func updateNSView(
    _ nsView: TerminalSidebarDragSourceNSView,
    context: Context
  ) {
    context.coordinator.item = item
    context.coordinator.preview = preview
    context.coordinator.zoneID = zoneID
    context.coordinator.index = index
  }

  static func dismantleNSView(
    _ nsView: TerminalSidebarDragSourceNSView,
    coordinator: TerminalSidebarDragSourceCoordinator
  ) {
    nsView.unregisterFromManager()
  }

  func makeCoordinator() -> TerminalSidebarDragSourceCoordinator {
    TerminalSidebarDragSourceCoordinator(
      item: item,
      preview: preview,
      zoneID: zoneID,
      index: index,
      manager: manager
    )
  }
}

struct TerminalSidebarDragSourceView<Content: View>: View {
  let item: TerminalSidebarDragItem
  let preview: TerminalSidebarDragPreviewItem
  let zoneID: TerminalSidebarDropZoneID
  let index: Int
  let manager: TerminalSidebarDragSession
  @ViewBuilder let content: Content

  var body: some View {
    content
      .background(
        TerminalSidebarDragSourceAnchor(
          item: item,
          preview: preview,
          zoneID: zoneID,
          index: index,
          manager: manager
        )
      )
  }
}

@MainActor
final class TerminalSidebarDropZoneCoordinator: NSObject {
  var zoneID: TerminalSidebarDropZoneID
  let manager: TerminalSidebarDragSession

  init(
    zoneID: TerminalSidebarDropZoneID,
    manager: TerminalSidebarDragSession
  ) {
    self.zoneID = zoneID
    self.manager = manager
  }
}

final class TerminalSidebarDropZoneNSView: NSView {
  weak var coordinator: TerminalSidebarDropZoneCoordinator?
  private var registeredPasteboardType: NSPasteboard.PasteboardType?

  func register(
    for pasteboardType: NSPasteboard.PasteboardType
  ) {
    guard registeredPasteboardType != pasteboardType else { return }
    unregisterDraggedTypes()
    registerForDraggedTypes([pasteboardType])
    registeredPasteboardType = pasteboardType
  }

  override func layout() {
    super.layout()
    guard
      let coordinator,
      let window,
      let contentView = window.contentView
    else {
      return
    }

    let frameInWindow = convert(bounds, to: nil)
    let frameInScreen = window.convertToScreen(frameInWindow)
    let contentHeight = contentView.bounds.height
    let flipped = CGRect(
      x: frameInWindow.origin.x,
      y: contentHeight - frameInWindow.maxY,
      width: frameInWindow.width,
      height: frameInWindow.height
    )
    Task { @MainActor in
      coordinator.manager.updateZoneFrame(
        for: coordinator.zoneID,
        frame: flipped,
        screenFrame: frameInScreen
      )
    }
  }

  override func draggingEntered(
    _ sender: any NSDraggingInfo
  ) -> NSDragOperation {
    guard
      let coordinator,
      coordinator.manager.canDrop(in: coordinator.zoneID)
    else {
      return []
    }

    Task { @MainActor in
      coordinator.manager.cursorEnteredZone(coordinator.zoneID)
    }
    updateInsertionIndex(sender)
    return .move
  }

  override func draggingUpdated(
    _ sender: any NSDraggingInfo
  ) -> NSDragOperation {
    guard
      let coordinator,
      coordinator.manager.canDrop(in: coordinator.zoneID)
    else {
      return []
    }

    updateInsertionIndex(sender)
    return .move
  }

  override func draggingExited(
    _ sender: (any NSDraggingInfo)?
  ) {
    guard let coordinator else { return }
    Task { @MainActor in
      coordinator.manager.cursorExitedZone(coordinator.zoneID)
    }
  }

  override func performDragOperation(
    _ sender: any NSDraggingInfo
  ) -> Bool {
    guard
      let coordinator,
      coordinator.manager.canDrop(in: coordinator.zoneID)
    else {
      return false
    }

    MainActor.assumeIsolated {
      coordinator.manager.completeDropIfPossible(in: coordinator.zoneID)
    }
    return true
  }

  private func updateInsertionIndex(
    _ sender: NSDraggingInfo
  ) {
    guard let coordinator else { return }
    let localPoint = convert(sender.draggingLocation, from: nil)
    let flippedPoint = CGPoint(
      x: localPoint.x,
      y: bounds.height - localPoint.y
    )
    Task { @MainActor in
      coordinator.manager.updateInsertionIndex(
        for: coordinator.zoneID,
        localPoint: flippedPoint
      )
    }
  }
}

private struct TerminalSidebarDropZoneAnchor: NSViewRepresentable {
  let zoneID: TerminalSidebarDropZoneID
  let manager: TerminalSidebarDragSession

  func makeNSView(
    context: Context
  ) -> TerminalSidebarDropZoneNSView {
    let view = TerminalSidebarDropZoneNSView()
    view.coordinator = context.coordinator
    view.register(for: zoneID.pasteboardType)
    return view
  }

  func updateNSView(
    _ nsView: TerminalSidebarDropZoneNSView,
    context: Context
  ) {
    context.coordinator.zoneID = zoneID
    nsView.register(for: zoneID.pasteboardType)
  }

  static func dismantleNSView(
    _ nsView: TerminalSidebarDropZoneNSView,
    coordinator: TerminalSidebarDropZoneCoordinator
  ) {
    MainActor.assumeIsolated {
      coordinator.manager.removeZone(coordinator.zoneID)
    }
  }

  func makeCoordinator() -> TerminalSidebarDropZoneCoordinator {
    TerminalSidebarDropZoneCoordinator(
      zoneID: zoneID,
      manager: manager
    )
  }
}

struct TerminalSidebarDropZoneHostView<Content: View>: View {
  let zoneID: TerminalSidebarDropZoneID
  let manager: TerminalSidebarDragSession
  @ViewBuilder let content: Content

  var body: some View {
    content
      .background(
        TerminalSidebarDropZoneAnchor(
          zoneID: zoneID,
          manager: manager
        )
      )
  }
}
