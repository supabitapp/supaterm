import AppKit

enum TerminalSidebarDragState: Equatable {
  case idle
  case pending
  case active
  case settling
  case failed
}

enum TerminalSidebarDragActivation {
  enum Decision: Equatable {
    case pending
    case begin
  }

  static let threshold: CGFloat = 8

  static func decision(
    from origin: CGPoint,
    to location: CGPoint
  ) -> Decision {
    guard hypot(location.x - origin.x, location.y - origin.y) >= threshold else {
      return .pending
    }
    return .begin
  }
}

struct TerminalSidebarDragCandidate {
  let entryID: TerminalSidebarEntryID
}

struct TerminalSidebarHapticTargetTracker {
  private(set) var lastValidDestination: TerminalSidebarDropDestination?

  mutating func shouldPerform(for destination: TerminalSidebarDropDestination?) -> Bool {
    guard let destination else {
      lastValidDestination = nil
      return false
    }
    guard destination != lastValidDestination else { return false }
    lastValidDestination = destination
    return true
  }

  mutating func reset() {
    lastValidDestination = nil
  }
}

@MainActor
final class TerminalSidebarDragGestureRecognizer: NSGestureRecognizer, NSGestureRecognizerDelegate {
  private struct PendingDrag {
    let entryID: TerminalSidebarEntryID
    let location: CGPoint
    let mouseDownEvent: NSEvent
  }

  private weak var collectionView: TerminalSidebarCollectionView?
  private var pendingDrag: PendingDrag?
  private var dragState = TerminalSidebarDragState.idle

  init(collectionView: TerminalSidebarCollectionView) {
    self.collectionView = collectionView
    super.init(target: nil, action: nil)
    delegate = self
    delaysPrimaryMouseButtonEvents = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func mouseDown(with event: NSEvent) {
    guard let collectionView else {
      state = .failed
      return
    }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    guard let candidate = collectionView.dragCandidate?(location) else {
      dragState = .failed
      state = .failed
      return
    }
    pendingDrag = PendingDrag(
      entryID: candidate.entryID,
      location: location,
      mouseDownEvent: event
    )
    dragState = .pending
    collectionView.activateDragGesture(self)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let collectionView, let pendingDrag else { return }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    switch TerminalSidebarDragActivation.decision(
      from: pendingDrag.location,
      to: location
    ) {
    case .pending:
      return
    case .begin:
      break
    }
    self.pendingDrag = nil
    dragState = .active
    state = .began
    guard collectionView.onDragBegan?(pendingDrag.entryID, pendingDrag.mouseDownEvent, event) == true else {
      dragState = .failed
      state = .cancelled
      return
    }
  }

  override func mouseUp(with event: NSEvent) {
    pendingDrag = nil
    switch dragState {
    case .pending:
      dragState = .failed
      state = .failed
    case .active:
      state = .ended
    case .idle, .settling, .failed:
      break
    }
  }

  override func reset() {
    super.reset()
    pendingDrag = nil
    dragState = .idle
  }

  func gestureRecognizer(
    _ gestureRecognizer: NSGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: NSGestureRecognizer
  ) -> Bool {
    true
  }

  func finish() {
    pendingDrag = nil
    dragState = .idle
    switch state {
    case .possible: state = .failed
    case .began, .changed: state = .cancelled
    case .ended, .cancelled, .failed: break
    @unknown default: state = .cancelled
    }
  }
}

@MainActor
final class TerminalSidebarCollectionView: NSCollectionView {
  var dragCandidate: ((CGPoint) -> TerminalSidebarDragCandidate?)?
  var onDragBegan: ((TerminalSidebarEntryID, NSEvent, NSEvent) -> Bool)?
  var onDragExited: (() -> Void)?
  private weak var activeDragRecognizer: TerminalSidebarDragGestureRecognizer?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    super.draggingExited(sender)
    onDragExited?()
  }

  func installDragRecognizer(on view: NSView) {
    guard !view.gestureRecognizers.contains(where: { $0 is TerminalSidebarDragGestureRecognizer }) else {
      return
    }
    view.addGestureRecognizer(TerminalSidebarDragGestureRecognizer(collectionView: self))
  }

  func activateDragGesture(_ recognizer: TerminalSidebarDragGestureRecognizer) {
    activeDragRecognizer = recognizer
  }

  func finishDragGesture() {
    activeDragRecognizer?.finish()
    activeDragRecognizer = nil
  }
}

@MainActor
final class TerminalSidebarDragSessionSource: NSObject, NSDraggingSource {
  private let onMoved: (NSPoint) -> Void
  private let onEnded: (TerminalSidebarDragSessionSource, NSPoint, NSDragOperation) -> Void

  init(
    onMoved: @escaping (NSPoint) -> Void,
    onEnded: @escaping (TerminalSidebarDragSessionSource, NSPoint, NSDragOperation) -> Void
  ) {
    self.onMoved = onMoved
    self.onEnded = onEnded
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    context == .withinApplication ? .move : []
  }

  func draggingSession(_ session: NSDraggingSession, movedTo screenPoint: NSPoint) {
    onMoved(screenPoint)
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    onEnded(self, screenPoint, operation)
  }
}
