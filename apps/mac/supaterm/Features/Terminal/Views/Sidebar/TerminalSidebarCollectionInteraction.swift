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

struct TerminalSidebarDropLifecycle: Equatable {
  enum State: Equatable {
    case tracking
    case completing(TerminalSidebarDropPlan)
    case completed(TerminalSidebarDropReceipt?)
  }

  enum SnapshotDisposition: Equatable {
    case waiting
    case matching
    case stale
    case rejected
  }

  let operationID: TerminalTabMoveOperationID
  let sourceTopologyStamp: TerminalSidebarTopologyStamp
  private(set) var state: State = .tracking

  init(
    operationID: TerminalTabMoveOperationID,
    sourceTopologyStamp: TerminalSidebarTopologyStamp
  ) {
    self.operationID = operationID
    self.sourceTopologyStamp = sourceTopologyStamp
  }

  mutating func freeze(_ plan: TerminalSidebarDropPlan) -> Bool {
    guard case .tracking = state else { return false }
    state = .completing(plan)
    return true
  }

  mutating func complete(_ receipt: TerminalSidebarDropReceipt?) -> Bool {
    guard case .completing = state else { return false }
    guard receipt?.operationID == operationID || receipt == nil else { return false }
    guard receipt?.topologyStamp.spaceID == sourceTopologyStamp.spaceID || receipt == nil else {
      return false
    }
    guard
      (receipt?.topologyStamp.revision ?? sourceTopologyStamp.revision)
        >= sourceTopologyStamp.revision
    else { return false }
    state = .completed(receipt)
    return true
  }

  func snapshotDisposition(for outline: TerminalSidebarOutline) -> SnapshotDisposition {
    guard case .completed(let receipt) = state else { return .waiting }
    guard let receipt else { return .rejected }
    guard let topologyStamp = outline.topologyStamp else { return .stale }
    guard topologyStamp.spaceID == receipt.topologyStamp.spaceID else { return .stale }
    if topologyStamp.revision < receipt.topologyStamp.revision { return .waiting }
    guard topologyStamp.revision == receipt.topologyStamp.revision else { return .stale }
    return receipt.matches(outline) ? .matching : .stale
  }

  var receipt: TerminalSidebarDropReceipt? {
    guard case .completed(let receipt) = state else { return nil }
    return receipt
  }
}

enum TerminalSidebarDropReconciliation {
  enum Decision: Equatable {
    case wait
    case acceptApplied
    case applyQueued
    case cancel
    case rejected
  }

  static func decision(
    lifecycle: TerminalSidebarDropLifecycle,
    appliedOutline: TerminalSidebarOutline,
    queuedOutline: TerminalSidebarOutline?
  ) -> Decision {
    if let queuedOutline {
      switch lifecycle.snapshotDisposition(for: queuedOutline) {
      case .matching: return .applyQueued
      case .stale: return .cancel
      case .rejected: return .rejected
      case .waiting: break
      }
    }
    switch lifecycle.snapshotDisposition(for: appliedOutline) {
    case .waiting: return .wait
    case .matching: return .acceptApplied
    case .stale: return .cancel
    case .rejected: return .rejected
    }
  }
}

@MainActor
final class TerminalSidebarCollectionView: NSCollectionView {
  var onRowMouseDown: ((TerminalSidebarEntryID, NSEvent) -> Bool)?
  var onRowMouseDragged: ((TerminalSidebarEntryID, NSEvent) -> Bool)?
  var onRowMouseUp: ((TerminalSidebarEntryID) -> Bool)?
  var onDraggingUpdated: (((any NSDraggingInfo)) -> NSDragOperation)?
  var onDraggingExited: (() -> Void)?
  var onDraggingEnded: (() -> Void)?
  var onPrepareForDragOperation: (((any NSDraggingInfo)) -> Bool)?
  var onPerformDragOperation: (((any NSDraggingInfo)) -> Bool)?
  var onDraggingSessionMoved: ((NSPoint) -> Void)?
  var onDraggingSessionEnded: ((NSPoint, NSDragOperation) -> Void)?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func rowMouseDown(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    onRowMouseDown?(entryID, event) == true
  }

  func rowMouseDragged(entryID: TerminalSidebarEntryID, event: NSEvent) -> Bool {
    onRowMouseDragged?(entryID, event) == true
  }

  func rowMouseUp(entryID: TerminalSidebarEntryID) -> Bool {
    onRowMouseUp?(entryID) == true
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
