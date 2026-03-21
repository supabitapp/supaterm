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
  var title: String
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
  @Published var draggedTab: TerminalTabItem?
  @Published var sourceZone: TerminalSidebarDropZoneID?
  @Published var sourceIndex: Int?
  @Published var activeZone: TerminalSidebarDropZoneID?
  @Published var insertionIndex: [TerminalSidebarDropZoneID: Int] = [:]
  @Published var pendingReorder: TerminalSidebarPendingReorder?
  @Published var cursorScreenLocation: NSPoint = .zero
  @Published var colorScheme: ColorScheme = .light

  var zoneFrames: [TerminalSidebarDropZoneID: CGRect] = [:]
  var itemCounts: [TerminalSidebarDropZoneID: Int] = [:]
  var rowHeight: CGFloat = 36
  var rowSpacing: CGFloat = 2

  var isDragging: Bool {
    draggedItem != nil
  }

  var previewWidth: CGFloat {
    if let sourceZone, let frame = zoneFrames[sourceZone], frame.width > 0 {
      return max(180, min(frame.width - 16, 320))
    }
    return 240
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
    tab: TerminalTabItem,
    from zone: TerminalSidebarDropZoneID,
    at index: Int
  ) {
    ensurePreviewWindow()
    draggedItem = item
    draggedTab = tab
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

  func zoneAcceptsCurrentDrag(
    _ zone: TerminalSidebarDropZoneID
  ) -> Bool {
    sourceZone != nil
  }

  func cursorEnteredZone(
    _ zone: TerminalSidebarDropZoneID
  ) {
    guard zoneAcceptsCurrentDrag(zone) else { return }
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
    guard zoneAcceptsCurrentDrag(zone) else { return }

    let count = itemCounts[zone] ?? 0
    guard count > 0 else {
      insertionIndex[zone] = 0
      return
    }

    let step = rowHeight + rowSpacing
    let rawIndex = step > 0 ? Int(round(localPoint.y / step)) : 0
    let clampedIndex = max(0, min(rawIndex, count))
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

  func reorderOffset(
    for zone: TerminalSidebarDropZoneID,
    at index: Int
  ) -> CGFloat {
    let step = rowHeight + rowSpacing
    guard let sourceZone, let sourceIndex else { return 0 }

    if sourceZone == zone {
      if activeZone == zone {
        return TerminalSidebarLayout.reorderOffset(
          for: index,
          sourceIndex: sourceIndex,
          destinationIndex: insertionIndex[zone],
          rowHeight: rowHeight,
          spacing: rowSpacing
        )
      }
      if activeZone != sourceZone, index > sourceIndex {
        return -step
      }
      return 0
    }

    guard activeZone == zone, let destinationIndex = insertionIndex[zone] else { return 0 }
    return index >= destinationIndex ? step : 0
  }

  private func clearDrag() {
    draggedItem = nil
    draggedTab = nil
    sourceZone = nil
    sourceIndex = nil
    activeZone = nil
    insertionIndex = [:]
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

  nonisolated private func handleMonitoredEvent(
    _ event: NSEvent
  ) -> NSEvent? {
    let result = MainActor.assumeIsolated {
      handleMonitoredEventOnMain(event)
    }
    switch result {
    case .passThrough:
      return event
    case .consumeAndStartDrag(let sourceID):
      MainActor.assumeIsolated {
        registeredSources[sourceID]?.view?.initiateDrag(with: event)
      }
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
  private weak var manager: TerminalSidebarDragSession?
  private var cancellables = Set<AnyCancellable>()

  init(manager: TerminalSidebarDragSession) {
    self.manager = manager

    super.init(
      contentRect: NSRect(origin: .zero, size: .init(width: 240, height: 36)),
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
  }

  private func updatePosition(
    screenPoint: NSPoint
  ) {
    guard let manager, manager.isDragging else { return }
    let width = manager.previewWidth
    let size = NSSize(width: width, height: manager.rowHeight)
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
    if let tab = manager.draggedTab {
      let palette = TerminalPalette(colorScheme: manager.colorScheme)
      HStack(spacing: 8) {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(palette.fill(for: tab.tone))
          .frame(width: 18, height: 18)
          .overlay {
            Image(systemName: tab.symbol)
              .font(.system(size: 10, weight: .semibold))
              .foregroundStyle(palette.primaryText)
              .accessibilityHidden(true)
          }

        Text(tab.title)
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(palette.primaryText)
          .lineLimit(1)

        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .frame(width: manager.previewWidth, height: manager.rowHeight)
      .background(Color(nsColor: .controlBackgroundColor).opacity(0.95))
      .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .stroke(Color.primary.opacity(0.08), lineWidth: 1)
      }
      .shadow(color: .black.opacity(0.25), radius: 8, y: 2)
    }
  }
}

@MainActor
final class TerminalSidebarDragSourceCoordinator: NSObject, NSDraggingSource {
  var item: TerminalSidebarDragItem
  var tab: TerminalTabItem
  var zoneID: TerminalSidebarDropZoneID
  var index: Int
  let manager: TerminalSidebarDragSession

  init(
    item: TerminalSidebarDragItem,
    tab: TerminalTabItem,
    zoneID: TerminalSidebarDropZoneID,
    index: Int,
    manager: TerminalSidebarDragSession
  ) {
    self.item = item
    self.tab = tab
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
      if operation == [] {
        manager.cancelDrag()
      }
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
      tab: coordinator.tab,
      from: coordinator.zoneID,
      at: coordinator.index
    )

    let pasteboardItem = NSPasteboardItem()
    pasteboardItem.setString(coordinator.item.tabID.rawValue.uuidString, forType: .terminalSidebarTabItem)
    pasteboardItem.setString(coordinator.item.tabID.rawValue.uuidString, forType: .string)

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
  let tab: TerminalTabItem
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
    context.coordinator.tab = tab
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
      tab: tab,
      zoneID: zoneID,
      index: index,
      manager: manager
    )
  }
}

struct TerminalSidebarDragSourceView<Content: View>: View {
  let item: TerminalSidebarDragItem
  let tab: TerminalTabItem
  let zoneID: TerminalSidebarDropZoneID
  let index: Int
  let manager: TerminalSidebarDragSession
  @ViewBuilder let content: () -> Content

  var body: some View {
    content()
      .background(
        TerminalSidebarDragSourceAnchor(
          item: item,
          tab: tab,
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
    let contentHeight = contentView.bounds.height
    let flipped = CGRect(
      x: frameInWindow.origin.x,
      y: contentHeight - frameInWindow.maxY,
      width: frameInWindow.width,
      height: frameInWindow.height
    )
    Task { @MainActor in
      coordinator.manager.zoneFrames[coordinator.zoneID] = flipped
    }
  }

  override func draggingEntered(
    _ sender: any NSDraggingInfo
  ) -> NSDragOperation {
    guard
      let coordinator,
      coordinator.manager.zoneAcceptsCurrentDrag(coordinator.zoneID)
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
      coordinator.manager.zoneAcceptsCurrentDrag(coordinator.zoneID)
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
      coordinator.manager.zoneAcceptsCurrentDrag(coordinator.zoneID)
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
    view.registerForDraggedTypes([.terminalSidebarTabItem, .string])
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
