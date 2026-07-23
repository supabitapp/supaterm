import AppKit

enum TerminalSidebarDragActivation {
  enum Decision: Equatable {
    case pending
    case rejected
    case begin
  }

  static let threshold: CGFloat = 8
  static let sourceTolerance: CGFloat = 8

  static func decision(
    mouseDownEventNumber: Int,
    currentEventNumber: Int,
    origin: CGPoint,
    location: CGPoint,
    sourceFrame: CGRect
  ) -> Decision {
    guard mouseDownEventNumber == currentEventNumber else { return .rejected }
    guard sourceFrame.insetBy(dx: -sourceTolerance, dy: -sourceTolerance).contains(location) else {
      return .rejected
    }
    guard hypot(location.x - origin.x, location.y - origin.y) >= threshold else {
      return .pending
    }
    return .begin
  }
}

struct TerminalSidebarHapticTargetTracker {
  private(set) var lastPath: TerminalSidebarSemanticPath?

  mutating func shouldPerform(for path: TerminalSidebarSemanticPath?) -> Bool {
    guard let path else {
      lastPath = nil
      return false
    }
    guard path != lastPath else { return false }
    lastPath = path
    return true
  }

  mutating func reset() {
    lastPath = nil
  }
}

struct TerminalSidebarDragCoordinator: Equatable {
  enum SnapshotDisposition: Equatable {
    case waiting
    case exact
    case superseding
    case incompatible
    case rejected
  }

  enum SnapshotAcceptance: Equatable {
    case exact
    case superseding
  }

  enum Settlement: Equatable {
    case accepted(TerminalSidebarDropReceipt)
    case superseded
    case rejected(topologyChanged: Bool)
  }

  enum Phase: Equatable {
    case tracking
    case frozen(TerminalSidebarDropPlan, TerminalSidebarDropCommand)
    case awaitingNativeEnd(
      TerminalSidebarDropCommand,
      TerminalSidebarDropReceipt?,
      SnapshotAcceptance?
    )
    case awaitingSnapshot(TerminalSidebarDropCommand, TerminalSidebarDropReceipt)
    case settling(Settlement)
    case finished
  }

  let payload: TerminalSidebarDragPayload
  private(set) var phase: Phase = .tracking

  init(payload: TerminalSidebarDragPayload) {
    self.payload = payload
  }

  mutating func freeze(_ plan: TerminalSidebarDropPlan) -> TerminalSidebarDropCommand? {
    guard case .tracking = phase, let command = plan.command(for: payload) else { return nil }
    phase = .frozen(plan, command)
    return command
  }

  mutating func complete(_ receipt: TerminalSidebarDropReceipt?) -> Bool {
    guard case .frozen(_, let command) = phase else { return false }
    guard receipt?.operationID == command.operationID || receipt == nil else { return false }
    guard receipt?.topologyStamp.spaceID == command.topologyStamp.spaceID || receipt == nil else {
      return false
    }
    guard
      (receipt?.topologyStamp.revision ?? command.topologyStamp.revision)
        >= command.topologyStamp.revision
    else { return false }
    phase = .awaitingNativeEnd(command, receipt, nil)
    return true
  }

  func snapshotDisposition(for outline: TerminalSidebarOutline) -> SnapshotDisposition {
    if case .awaitingNativeEnd(_, nil, _) = phase { return .rejected }
    guard let completedDrop else { return .waiting }
    let (command, receipt) = completedDrop
    guard let topologyStamp = outline.topologyStamp else { return .incompatible }
    guard topologyStamp.spaceID == receipt.topologyStamp.spaceID else { return .incompatible }
    if topologyStamp.revision < receipt.topologyStamp.revision { return .waiting }
    if topologyStamp.revision > receipt.topologyStamp.revision { return .superseding }
    return receipt.matches(outline, command: command) ? .exact : .incompatible
  }

  mutating func recordSnapshot(_ acceptance: SnapshotAcceptance) -> Settlement? {
    switch phase {
    case .awaitingNativeEnd(let command, let receipt?, _):
      phase = .awaitingNativeEnd(command, receipt, acceptance)
      return nil
    case .awaitingSnapshot(_, let receipt):
      let settlement: Settlement =
        acceptance == .exact ? .accepted(receipt) : .superseded
      phase = .settling(settlement)
      return settlement
    case .tracking, .frozen, .awaitingNativeEnd(_, nil, _), .settling, .finished:
      return nil
    }
  }

  mutating func cancel(topologyChanged: Bool) -> Settlement? {
    switch phase {
    case .tracking, .frozen, .awaitingNativeEnd, .awaitingSnapshot:
      let settlement = Settlement.rejected(topologyChanged: topologyChanged)
      phase = .settling(settlement)
      return settlement
    case .settling, .finished:
      return nil
    }
  }

  mutating func nativeEnded() -> Settlement? {
    switch phase {
    case .tracking, .frozen:
      let settlement = Settlement.rejected(topologyChanged: false)
      phase = .settling(settlement)
      return settlement
    case .awaitingNativeEnd(_, nil, _):
      let settlement = Settlement.rejected(topologyChanged: false)
      phase = .settling(settlement)
      return settlement
    case .awaitingNativeEnd(let command, let receipt?, nil):
      phase = .awaitingSnapshot(command, receipt)
      return nil
    case .awaitingNativeEnd(_, let receipt?, .exact):
      let settlement = Settlement.accepted(receipt)
      phase = .settling(settlement)
      return settlement
    case .awaitingNativeEnd(_, .some, .superseding):
      let settlement = Settlement.superseded
      phase = .settling(settlement)
      return settlement
    case .awaitingSnapshot, .settling, .finished:
      return nil
    }
  }

  mutating func finish() {
    guard case .settling = phase else { return }
    phase = .finished
  }

  var frozenPlan: TerminalSidebarDropPlan? {
    guard case .frozen(let plan, _) = phase else { return nil }
    return plan
  }

  var command: TerminalSidebarDropCommand? {
    switch phase {
    case .frozen(_, let command),
      .awaitingNativeEnd(let command, _, _),
      .awaitingSnapshot(let command, _):
      return command
    case .tracking, .settling, .finished:
      return nil
    }
  }

  private var completedDrop: (command: TerminalSidebarDropCommand, receipt: TerminalSidebarDropReceipt)? {
    switch phase {
    case .awaitingNativeEnd(let command, let receipt?, _),
      .awaitingSnapshot(let command, let receipt):
      return (command, receipt)
    case .tracking, .frozen, .awaitingNativeEnd(_, nil, _), .settling, .finished:
      return nil
    }
  }
}

@MainActor
final class TerminalSidebarCollectionView: NSCollectionView {
  private var pointerTrackingArea: NSTrackingArea?
  private var capturedRowEntryID: TerminalSidebarEntryID?
  private var routedRowEntryID: TerminalSidebarEntryID?

  var onRowMouseDown: ((TerminalSidebarEntryID, NSEvent) -> Bool)?
  var onRowMouseDragged: ((TerminalSidebarEntryID, NSEvent) -> Bool)?
  var onRowMouseUp: ((TerminalSidebarEntryID, NSEvent) -> Bool)?
  var onDraggingUpdated: (((any NSDraggingInfo)) -> NSDragOperation)?
  var onDraggingExited: (() -> Void)?
  var onDraggingEnded: (() -> Void)?
  var onPrepareForDragOperation: (((any NSDraggingInfo)) -> Bool)?
  var onPerformDragOperation: (((any NSDraggingInfo)) -> Bool)?
  var onDraggingSessionMoved: ((NSPoint) -> Void)?
  var onDraggingSessionEnded: ((NSPoint, NSDragOperation) -> Void)?
  var onPointerMoved: ((CGPoint?) -> Void)?

  var pointerLocation: CGPoint? {
    guard let window, window.isKeyWindow else { return nil }
    let point = convert(window.mouseLocationOutsideOfEventStream, from: nil)
    return visibleRect.contains(point) ? point : nil
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func routeMouseDown(to entryID: TerminalSidebarEntryID) {
    routedRowEntryID = entryID
  }

  override func mouseDown(with event: NSEvent) {
    capturedRowEntryID = nil
    let entryID = routedRowEntryID
    routedRowEntryID = nil
    guard
      let entryID,
      rowMouseDown(entryID: entryID, event: event)
    else {
      super.mouseDown(with: event)
      return
    }
    capturedRowEntryID = entryID
  }

  override func mouseDragged(with event: NSEvent) {
    guard let entryID = capturedRowEntryID else {
      super.mouseDragged(with: event)
      return
    }
    if rowMouseDragged(entryID: entryID, event: event) {
      capturedRowEntryID = nil
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard let entryID = capturedRowEntryID else {
      super.mouseUp(with: event)
      return
    }
    capturedRowEntryID = nil
    _ = rowMouseUp(entryID: entryID, event: event)
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    if let pointerTrackingArea { removeTrackingArea(pointerTrackingArea) }
    let pointerTrackingArea = NSTrackingArea(
      rect: .zero,
      options: [.activeInKeyWindow, .inVisibleRect, .mouseEnteredAndExited, .mouseMoved],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(pointerTrackingArea)
    self.pointerTrackingArea = pointerTrackingArea
  }

  override func mouseEntered(with event: NSEvent) {
    updatePointer(with: event)
    super.mouseEntered(with: event)
  }

  override func mouseMoved(with event: NSEvent) {
    updatePointer(with: event)
    super.mouseMoved(with: event)
  }

  override func mouseExited(with event: NSEvent) {
    onPointerMoved?(nil)
    super.mouseExited(with: event)
  }

  func rowMouseDown(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    onRowMouseDown?(entryID, event) == true
  }

  func rowMouseDragged(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    onRowMouseDragged?(entryID, event) == true
  }

  func rowMouseUp(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    onRowMouseUp?(entryID, event) == true
  }

  private func updatePointer(with event: NSEvent) {
    onPointerMoved?(convert(event.locationInWindow, from: nil))
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    onDraggingUpdated?(sender) ?? []
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    onDraggingUpdated?(sender) ?? []
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    onDraggingExited?()
  }

  override func draggingEnded(_ sender: any NSDraggingInfo) {
    onDraggingEnded?()
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return onPrepareForDragOperation?(sender) == true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    onPerformDragOperation?(sender) == true
  }

  override func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    [.copy, .move]
  }

  override func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
    onDraggingSessionMoved?(screenPoint)
  }

  override func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    onDraggingSessionEnded?(screenPoint, operation)
  }
}

extension NSPasteboard.PasteboardType {
  static let terminalSidebarOutlineItem = NSPasteboard.PasteboardType(
    "app.supaterm.sidebar-outline-item"
  )
}
