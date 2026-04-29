@preconcurrency import AppKit
import Combine
import SwiftUI
import UniformTypeIdentifiers

extension UTType {
  static let terminalSidebarTabItem = UTType(exportedAs: "app.supaterm.sidebar-tab-item")
}

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
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let badgeActivity: TerminalHostState.AgentActivity?
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
        let palette = TerminalPalette(colorScheme: manager.colorScheme)
        TerminalSidebarMorphingPreview(
          tab: preview.tab,
          paneWorkingDirectories: preview.paneWorkingDirectories,
          unreadCount: preview.unreadCount,
          badgeActivity: preview.badgeActivity,
          showsAgentMarks: preview.showsAgentMarks,
          showsAgentSpinner: preview.showsAgentSpinner,
          rowWidth: manager.previewRowWidth,
          palette: palette
        )
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
  let tab: TerminalTabItem
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let badgeActivity: TerminalHostState.AgentActivity?
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
  let rowWidth: CGFloat
  let palette: TerminalPalette

  var body: some View {
    TerminalSidebarTabSummaryView(
      tab: tab,
      palette: palette,
      isSelected: false,
      paneWorkingDirectories: paneWorkingDirectories,
      unreadCount: unreadCount,
      badgeActivity: badgeActivity,
      terminalProgress: nil,
      showsAgentMarks: showsAgentMarks,
      showsAgentSpinner: showsAgentSpinner,
      shortcutHint: nil,
      showsShortcutHint: false,
      isRowHovering: false
    )
    .lineLimit(10)
    .padding(.horizontal, TerminalSidebarLayout.tabRowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(width: rowWidth)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
    .background(Color(nsColor: .controlBackgroundColor).opacity(0.95))
    .clipShape(
      RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
    )
    .overlay {
      RoundedRectangle(cornerRadius: TerminalSidebarLayout.tabRowCornerRadius, style: .continuous)
        .stroke(Color.primary.opacity(0.08), lineWidth: 1)
    }
    .shadow(
      color: .black.opacity(0.25),
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
    pasteboardItem.setString(coordinator.item.tabID.rawValue.uuidString, forType: .terminalSidebarTabItem)

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
  @ViewBuilder let content: () -> Content

  var body: some View {
    content()
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
      coordinator.manager.sourceZone != nil
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
      coordinator.manager.sourceZone != nil
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
      coordinator.manager.sourceZone != nil
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
    view.registerForDraggedTypes([.terminalSidebarTabItem])
    return view
  }

  func updateNSView(
    _ nsView: TerminalSidebarDropZoneNSView,
    context: Context
  ) {
    context.coordinator.zoneID = zoneID
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
  @ViewBuilder let content: () -> Content

  var body: some View {
    content()
      .background(
        TerminalSidebarDropZoneAnchor(
          zoneID: zoneID,
          manager: manager
        )
      )
  }
}
