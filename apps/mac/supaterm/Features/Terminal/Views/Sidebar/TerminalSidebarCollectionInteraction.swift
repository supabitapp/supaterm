import AppKit

enum TerminalSidebarDragOutlineDisposition: Equatable {
  case inactive
  case unchanged
  case queue
  case replaceAndCancel(reason: String)

  static func tracking(
    incoming: TerminalSidebarOutline,
    applied: TerminalSidebarOutline,
    sourceTopologyStamp: TerminalSidebarTopologyStamp
  ) -> Self {
    guard incoming.topologyStamp == sourceTopologyStamp else {
      return .replaceAndCancel(reason: "sourceTopologyChanged")
    }
    guard incoming.topologyStamp == applied.topologyStamp, incoming.roots == applied.roots else {
      return .replaceAndCancel(reason: "sourceSnapshotMismatch")
    }
    guard incoming.collapsedGroupIDs == applied.collapsedGroupIDs else { return .queue }
    return .unchanged
  }
}

struct TerminalSidebarPendingDrag {
  let entryID: TerminalSidebarEntryID
  let origin: CGPoint
  let selectedTabIDs: [TerminalTabID]
  let defersSelection: Bool
  let selectionHandoff: TerminalSidebarTabDragSelectionHandoff?
  var isActivationFailed = false
}

struct TerminalSidebarDragSourceGeometry {
  let itemByID: [TerminalSidebarEntryID: TerminalSidebarLayoutPlan.Item]
  let fanAnchorIndex: Int?
  let frame: CGRect

  static func resolve(
    payload: TerminalSidebarDragPayload,
    liftedEntryIDs: [TerminalSidebarEntryID],
    anchorEntryID: TerminalSidebarEntryID,
    plan: TerminalSidebarLayoutPlan
  ) -> Self? {
    let sourceIDs = Set(liftedEntryIDs)
    let sourceItems = plan.items.filter {
      sourceIDs.contains($0.id) && $0.frame.height > 0
    }
    guard sourceItems.count == liftedEntryIDs.count else { return nil }
    let itemByID = Dictionary(uniqueKeysWithValues: sourceItems.map { ($0.id, $0) })
    switch payload.source {
    case .tabs:
      guard
        let anchorIndex = liftedEntryIDs.firstIndex(of: anchorEntryID),
        let anchorFrame = itemByID[anchorEntryID]?.frame
      else { return nil }
      return Self(
        itemByID: itemByID,
        fanAnchorIndex: anchorIndex,
        frame: TerminalSidebarLiveDragGeometry.fanFrame(
          anchorFrame: anchorFrame,
          rowHeights: liftedEntryIDs.compactMap { itemByID[$0]?.frame.height },
          anchorIndex: anchorIndex
        )
      )
    case .group:
      guard
        let frame = sourceItems.map(\.frame).reduce(
          Optional<CGRect>.none,
          { $0?.union($1) ?? $1 }
        )
      else { return nil }
      return Self(itemByID: itemByID, fanAnchorIndex: nil, frame: frame)
    }
  }
}

enum TerminalSidebarExternalDragCompletion: Equatable {
  case pending
  case moved(TerminalTabDragRegistry.SourceDisposition)

  var sourceDisposition: TerminalTabDragRegistry.SourceDisposition? {
    guard case .moved(let sourceDisposition) = self else { return nil }
    return sourceDisposition
  }
}

struct TerminalSidebarActiveDrag {
  let payload: TerminalSidebarDragPayload
  let liftedEntryIDs: [TerminalSidebarEntryID]
  var coordinator: TerminalSidebarDragCoordinator
  var target: TerminalSidebarDropPlan?
  var externalCompletion = TerminalSidebarExternalDragCompletion.pending

  mutating func completeExternal(
    operationID: TerminalTabMoveOperationID,
    sourceDisposition: TerminalTabDragRegistry.SourceDisposition
  ) -> Bool {
    guard payload.operationID == operationID else { return false }
    externalCompletion = .moved(sourceDisposition)
    return true
  }

  func registryOutcome(receipt: TerminalSidebarDropReceipt?) -> TerminalTabDragRegistry.Outcome {
    receipt != nil || externalCompletion.sourceDisposition != nil ? .moved : .cancelled
  }
}

enum TerminalSidebarDragActivation {
  enum Decision: Equatable {
    case pending
    case begin
    case failed
  }

  static let threshold: CGFloat = 8

  static func decision(
    origin: CGPoint,
    location: CGPoint,
    sourceFrame: CGRect
  ) -> Decision {
    guard hypot(location.x - origin.x, location.y - origin.y) >= threshold else {
      return .pending
    }
    return sourceFrame.insetBy(dx: -threshold, dy: -threshold).contains(location)
      ? .begin
      : .failed
  }
}

enum TerminalSidebarPinnedDropRouting {
  static func autoscrollPointerY(in visibleRect: CGRect) -> CGFloat {
    visibleRect.maxY
  }
}

enum TerminalSidebarOptionTabClick {
  static func accepts(
    modifiers: NSEvent.ModifierFlags,
    clickCount: Int
  ) -> Bool {
    let selectionModifiers = modifiers.intersection([.command, .shift, .option, .control])
    return clickCount == 1 && selectionModifiers == .option
  }
}

enum TerminalSidebarTabPressDecision: Equatable {
  case applySelection
  case deferSelection([TerminalTabID])

  static func resolve(
    tabID: TerminalTabID,
    modifiers: NSEvent.ModifierFlags,
    selectedTabIDs: [TerminalTabID]
  ) -> Self {
    guard
      modifiers.isDisjoint(with: [.command, .shift]),
      selectedTabIDs.count > 1,
      selectedTabIDs.contains(tabID)
    else { return .applySelection }
    return .deferSelection(selectedTabIDs)
  }
}

struct TerminalSidebarTabDragSelectionHandoff: Equatable {
  let priorTabID: TerminalTabID

  static func resolve(
    entryID: TerminalSidebarEntryID,
    primaryTabID: TerminalTabID?,
    modifiers: NSEvent.ModifierFlags,
    selectedTabIDs: [TerminalTabID]
  ) -> Self? {
    guard
      case .tab(let tabID) = entryID,
      modifiers.isDisjoint(with: [.command, .shift, .option, .control]),
      let primaryTabID,
      primaryTabID != tabID,
      selectedTabIDs == [tabID]
    else { return nil }
    return Self(priorTabID: primaryTabID)
  }

  func tabIDToRestore(
    draggedTabID: TerminalTabID,
    liveSelectedTabID: TerminalTabID?
  ) -> TerminalTabID? {
    liveSelectedTabID == draggedTabID ? priorTabID : nil
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
  enum Settlement: Equatable {
    case accepted(TerminalSidebarDropReceipt)
    case rejected(topologyChanged: Bool)
  }

  enum Phase: Equatable {
    case tracking
    case frozen(TerminalSidebarDropPlan, TerminalSidebarDropCommand)
    case awaitingNativeEnd(TerminalSidebarDropCommand, TerminalSidebarDropReceipt?)
    case cancelled(topologyChanged: Bool)
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
    if let receipt {
      guard receipt.operationID == command.operationID else { return false }
      guard receipt.topologyStamp.spaceID == command.topologyStamp.spaceID else { return false }
      guard receipt.topologyStamp.revision >= command.topologyStamp.revision else { return false }
      guard receipt.result.itemIDs == command.itemIDs else { return false }
      guard receipt.result.location == command.destination else { return false }
    }
    phase = .awaitingNativeEnd(command, receipt)
    return true
  }

  mutating func cancel(topologyChanged: Bool) {
    switch phase {
    case .tracking, .frozen, .awaitingNativeEnd:
      phase = .cancelled(topologyChanged: topologyChanged)
    case .cancelled, .settling, .finished:
      break
    }
  }

  mutating func nativeEnded() -> Settlement? {
    switch phase {
    case .tracking, .frozen:
      let settlement = Settlement.rejected(topologyChanged: false)
      phase = .settling(settlement)
      return settlement
    case .awaitingNativeEnd(_, nil):
      let settlement = Settlement.rejected(topologyChanged: false)
      phase = .settling(settlement)
      return settlement
    case .awaitingNativeEnd(_, let receipt?):
      let settlement = Settlement.accepted(receipt)
      phase = .settling(settlement)
      return settlement
    case .cancelled(let topologyChanged):
      let settlement = Settlement.rejected(topologyChanged: topologyChanged)
      phase = .settling(settlement)
      return settlement
    case .settling, .finished:
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
      .awaitingNativeEnd(let command, _):
      return command
    case .tracking, .cancelled, .settling, .finished:
      return nil
    }
  }
}

struct TerminalSidebarDropHandoff: Equatable {
  enum RevisionRequirement: Equatable {
    case sameOrNewer
    case newer
  }

  let topologyStamp: TerminalSidebarTopologyStamp
  let revisionRequirement: RevisionRequirement

  func accepts(_ candidate: TerminalSidebarTopologyStamp?) -> Bool {
    guard let candidate else { return false }
    guard candidate.spaceID == topologyStamp.spaceID else { return false }
    switch revisionRequirement {
    case .sameOrNewer:
      return candidate.revision >= topologyStamp.revision
    case .newer:
      return candidate.revision > topologyStamp.revision
    }
  }
}

enum TerminalSidebarGroupClick {
  static func acceptsRelease(_ location: CGPoint, frame: CGRect?) -> Bool {
    frame?.contains(location) == true
  }
}

@MainActor
final class TerminalSidebarCollectionView: NSCollectionView {
  private var pointerTrackingArea: NSTrackingArea?
  private weak var trackingRowPointer: TerminalSidebarRowPointerNSView?

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
  var onPointerExited: (() -> Void)?
  var onWindowChanged: ((NSWindow?) -> Void)?

  var pointerLocation: CGPoint? {
    guard let window, window.isKeyWindow else { return nil }
    let point = convert(window.mouseLocationOutsideOfEventStream, from: nil)
    return TerminalSidebarHoverCardGeometry.isPointVisible(point, visibleRect: visibleRect)
      ? point : nil
  }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    onWindowChanged?(window)
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
    updatePointer()
    super.mouseEntered(with: event)
  }

  override func mouseMoved(with event: NSEvent) {
    updatePointer()
    super.mouseMoved(with: event)
  }

  override func mouseExited(with event: NSEvent) {
    onPointerExited?()
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

  func beginTrackingRowPointer(_ pointer: TerminalSidebarRowPointerNSView) {
    trackingRowPointer?.finishTracking()
    trackingRowPointer = pointer
  }

  func finishTrackingRowPointer(_ pointer: TerminalSidebarRowPointerNSView) {
    guard trackingRowPointer === pointer else { return }
    trackingRowPointer = nil
  }

  func finishTrackingRowPointer(entryID: TerminalSidebarEntryID) {
    guard trackingRowPointer?.entryID == entryID else { return }
    trackingRowPointer?.finishTracking()
  }

  private func updatePointer() {
    onPointerMoved?(pointerLocation)
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
    .move
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
