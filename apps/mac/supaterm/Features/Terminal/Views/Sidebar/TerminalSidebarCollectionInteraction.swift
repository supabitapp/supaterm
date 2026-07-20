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
    case fail
  }

  static let threshold: CGFloat = 8
  static let envelopeInset: CGFloat = 8

  static func decision(
    from origin: CGPoint,
    to location: CGPoint,
    sourceFrame: CGRect
  ) -> Decision {
    guard hypot(location.x - origin.x, location.y - origin.y) >= threshold else {
      return .pending
    }
    return sourceFrame.insetBy(dx: -envelopeInset, dy: -envelopeInset).contains(location)
      ? .begin
      : .fail
  }
}

struct TerminalSidebarDragCandidate {
  let entryID: TerminalSidebarEntryID
  let frame: CGRect
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
final class TerminalSidebarDragGestureRecognizer: NSGestureRecognizer {
  private struct PendingDrag {
    let entryID: TerminalSidebarEntryID
    let location: CGPoint
    let sourceFrame: CGRect
    let mouseDownEvent: NSEvent
  }

  private weak var collectionView: TerminalSidebarCollectionView?
  private var pendingDrag: PendingDrag?
  private var dragState = TerminalSidebarDragState.idle

  init(collectionView: TerminalSidebarCollectionView) {
    self.collectionView = collectionView
    super.init(target: nil, action: nil)
    delaysPrimaryMouseButtonEvents = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func mouseDown(with event: NSEvent) {
    super.mouseDown(with: event)
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
      sourceFrame: candidate.frame,
      mouseDownEvent: event
    )
    dragState = .pending
  }

  override func mouseDragged(with event: NSEvent) {
    super.mouseDragged(with: event)
    guard let collectionView, let pendingDrag else { return }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    switch TerminalSidebarDragActivation.decision(
      from: pendingDrag.location,
      to: location,
      sourceFrame: pendingDrag.sourceFrame
    ) {
    case .pending:
      return
    case .fail:
      self.pendingDrag = nil
      dragState = .failed
      state = .failed
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
    super.mouseUp(with: event)
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

  override func shouldBeRequiredToFail(by otherGestureRecognizer: NSGestureRecognizer) -> Bool {
    _ = super.shouldBeRequiredToFail(by: otherGestureRecognizer)
    return true
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
  private var dragRecognizer: TerminalSidebarDragGestureRecognizer!

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    dragRecognizer = TerminalSidebarDragGestureRecognizer(collectionView: self)
    addGestureRecognizer(dragRecognizer)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    super.draggingExited(sender)
    onDragExited?()
  }

  func finishDragGesture() {
    dragRecognizer.finish()
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
