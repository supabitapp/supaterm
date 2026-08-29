import AppKit
import SwiftUI
import UniformTypeIdentifiers

extension EnvironmentValues {
  @Entry var terminalPaneDragClient: TerminalPaneDragClient?
}

@MainActor
final class TerminalPaneDragClient {
  private struct ActiveDrag {
    let operationID: TerminalTabMoveOperationID
    var captureTask: Task<Void, Never>?
    var didTransfer = false
  }

  private let captureClient: TerminalWindowCaptureClient
  private let registry: TerminalTabDragRegistry
  private let terminal: TerminalHostState
  private let windowControllerID: UUID
  private var activeDrag: ActiveDrag?

  init(
    terminal: TerminalHostState,
    windowControllerID: UUID,
    registry: TerminalTabDragRegistry,
    captureClient: TerminalWindowCaptureClient = .live
  ) {
    self.terminal = terminal
    self.windowControllerID = windowControllerID
    self.registry = registry
    self.captureClient = captureClient
  }

  func begin(surfaceView: GhosttySurfaceView) -> TerminalTabDragPayload? {
    guard
      activeDrag == nil,
      terminal.canMovePaneToNewTab(surfaceView.id),
      let tabID = terminal.tabID(containing: surfaceView.id),
      let instance = terminal.spaceManager.instance(for: tabID)
    else { return nil }
    let operationID = TerminalTabMoveOperationID()
    let payload = TerminalTabDragPayload(
      operationID: operationID,
      sourceWindowID: windowControllerID,
      sourceSpaceID: instance.spaceID,
      sourceTopologyRevision: instance.tabCollection.topologyRevision,
      surfaceID: surfaceView.id,
      destinationTabID: TerminalTabID()
    )
    guard
      registry.begin(
        payload,
        previewContentSize: previewContentSize(for: surfaceView),
        sidebarDropGapHeight: max(
          TerminalSidebarLayout.tabRowMinHeight,
          TerminalSidebarLayout.tabTrailingAccessorySize
            + TerminalSidebarLayout.tabRowVerticalPadding * 2
        ),
        didTransfer: { [weak self] completedOperationID, _ in
          guard
            var activeDrag = self?.activeDrag,
            activeDrag.operationID == completedOperationID
          else { return }
          activeDrag.didTransfer = true
          self?.activeDrag = activeDrag
        }
      )
    else { return nil }
    activeDrag = ActiveDrag(operationID: operationID)
    startCapture(surfaceView: surfaceView, operationID: operationID)
    return payload
  }

  func move(_ payload: TerminalTabDragPayload, to screenPoint: CGPoint) {
    guard activeDrag?.operationID == payload.moveOperationID else { return }
    _ = registry.move(to: screenPoint, sourceSurfaceFrame: .null)
  }

  func end(_ payload: TerminalTabDragPayload) {
    guard let activeDrag, activeDrag.operationID == payload.moveOperationID else { return }
    activeDrag.captureTask?.cancel()
    self.activeDrag = nil
    registry.finish(
      operationID: payload.moveOperationID,
      outcome: activeDrag.didTransfer ? .moved : .cancelled
    )
  }

  private func startCapture(
    surfaceView: GhosttySurfaceView,
    operationID: TerminalTabMoveOperationID
  ) {
    guard let request = captureRequest(for: surfaceView) else { return }
    let capture = captureClient.capture
    let task = Task { [weak self] in
      let image = await capture(request).map {
        NSImage(cgImage: $0, size: request.geometry.sourceRect.size)
      }
      guard !Task.isCancelled else { return }
      _ = self?.registry.updatePreviewImage(image, operationID: operationID)
    }
    guard var activeDrag, activeDrag.operationID == operationID else {
      task.cancel()
      return
    }
    activeDrag.captureTask = task
    self.activeDrag = activeDrag
  }

  private func captureRequest(for surfaceView: GhosttySurfaceView) -> TerminalWindowCaptureRequest? {
    guard
      let window = surfaceView.window,
      window.windowNumber > 0,
      !surfaceView.bounds.isEmpty
    else { return nil }
    let screenFrame = window.convertToScreen(surfaceView.convert(surfaceView.bounds, to: nil))
    return TerminalWindowCaptureRequest(
      windowID: CGWindowID(window.windowNumber),
      geometry: TerminalWindowCaptureGeometry(
        windowFrame: window.frame,
        viewScreenFrame: screenFrame,
        backingScaleFactor: window.backingScaleFactor
      )
    )
  }

  private func previewContentSize(for surfaceView: GhosttySurfaceView) -> CGSize {
    guard let window = surfaceView.window else { return surfaceView.bounds.size }
    return TerminalTabDragPreviewLayout.sourceContentSize(for: window.frame)
  }
}

enum TerminalPaneDragSourceLayout {
  static let height: CGFloat = 10

  static func frame(for paneFrame: CGRect) -> CGRect {
    CGRect(
      x: paneFrame.minX,
      y: paneFrame.maxY - height,
      width: paneFrame.width,
      height: height
    )
  }
}

enum TerminalPaneDragSourceHitTesting {
  static func source<View: NSView>(
    at point: NSPoint,
    in sources: [View]
  ) -> View? {
    sources.first { $0.frame.contains(point) }
  }
}

@MainActor
final class TerminalPaneDragSourceNSView: NSView, NSDraggingSource {
  private var client: TerminalPaneDragClient
  private var dragOrigin: CGPoint?
  private let indicatorView = NSImageView()
  private var payload: TerminalTabDragPayload?
  private var surfaceView: GhosttySurfaceView

  var showsIndicator = false {
    didSet { indicatorView.isHidden = !showsIndicator }
  }

  override var mouseDownCanMoveWindow: Bool { false }

  init(surfaceView: GhosttySurfaceView, client: TerminalPaneDragClient) {
    self.surfaceView = surfaceView
    self.client = client
    super.init(frame: .zero)
    setAccessibilityElement(false)
    indicatorView.image = NSImage(systemSymbolName: "ellipsis", accessibilityDescription: nil)
    indicatorView.symbolConfiguration = NSImage.SymbolConfiguration(
      pointSize: 13,
      weight: .semibold
    )
    indicatorView.contentTintColor = NSColor.labelColor.withAlphaComponent(0.5)
    indicatorView.isHidden = true
    indicatorView.setAccessibilityElement(false)
    addSubview(indicatorView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  func update(surfaceView: GhosttySurfaceView, client: TerminalPaneDragClient) {
    self.surfaceView = surfaceView
    self.client = client
  }

  override func layout() {
    super.layout()
    indicatorView.frame = bounds
  }

  override func resetCursorRects() {
    addCursorRect(bounds, cursor: .openHand)
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    bounds.contains(point) ? self : nil
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
    true
  }

  override func mouseDown(with event: NSEvent) {
    dragOrigin = convert(event.locationInWindow, from: nil)
  }

  override func mouseDragged(with event: NSEvent) {
    guard payload == nil, let dragOrigin else { return }
    let location = convert(event.locationInWindow, from: nil)
    guard
      TerminalSidebarDragActivation.decision(origin: dragOrigin, location: location) == .begin
    else { return }
    self.dragOrigin = nil
    beginDragging(with: event)
  }

  override func mouseUp(with event: NSEvent) {
    dragOrigin = nil
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .move
  }

  func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
    guard let payload else { return }
    client.move(payload, to: screenPoint)
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    guard let payload else { return }
    client.end(payload)
    self.payload = nil
  }

  func ignoreModifierKeys(for session: NSDraggingSession) -> Bool {
    true
  }

  private func beginDragging(with event: NSEvent) {
    let pasteboardItem = NSPasteboardItem()
    let splitType = NSPasteboard.PasteboardType(TerminalSplitTreeView.dragType.identifier)
    precondition(pasteboardItem.setString(surfaceView.id.uuidString, forType: splitType))
    let payload = client.begin(surfaceView: surfaceView)
    if let payload {
      precondition(TerminalTabDragPasteboard.write(payload, to: pasteboardItem))
    }
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(
      CGRect(origin: convert(event.locationInWindow, from: nil), size: CGSize(width: 1, height: 1)),
      contents: nil
    )
    let session = beginDraggingSession(with: [draggingItem], event: event, source: self)
    session.animatesToStartingPositionsOnCancelOrFail = false
    session.draggingFormation = .none
    self.payload = payload
    if let payload {
      client.move(payload, to: NSEvent.mouseLocation)
    }
  }
}
