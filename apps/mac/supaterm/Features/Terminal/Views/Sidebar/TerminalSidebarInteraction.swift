import AppKit

enum TerminalSidebarDragState: Equatable {
  case idle
  case pending
  case active
  case failed
}

enum TerminalSidebarDragActivation {
  static let threshold: CGFloat = 8

  static func shouldBegin(from origin: CGPoint, to location: CGPoint) -> Bool {
    hypot(location.x - origin.x, location.y - origin.y) >= threshold
  }
}

struct TerminalSidebarHapticTargetTracker {
  private(set) var lastValidDestination: TerminalSidebarDropTarget.Destination?

  mutating func shouldPerform(for destination: TerminalSidebarDropTarget.Destination?) -> Bool {
    guard let destination, destination != lastValidDestination else { return false }
    lastValidDestination = destination
    return true
  }

  mutating func reset() {
    lastValidDestination = nil
  }
}

enum TerminalSidebarCollapseMotion {
  static let rowDuration: TimeInterval = 0.18
  static let firstInterval: TimeInterval = 0.024
  static let lastInterval: TimeInterval = 0.008

  static func delays(rowCount: Int) -> [TimeInterval] {
    guard rowCount > 0 else { return [] }
    guard rowCount > 1 else { return [0] }
    var result: [TimeInterval] = [0]
    for index in 0..<(rowCount - 1) {
      let progress = rowCount == 2 ? 0 : Double(index) / Double(rowCount - 2)
      let eased = 1 - pow(1 - progress, 2)
      let interval = firstInterval + (lastInterval - firstInterval) * eased
      result.append(result[index] + interval)
    }
    return result
  }

  static func visibility(
    elapsed: TimeInterval,
    delay: TimeInterval
  ) -> TerminalSidebarLayoutPlan.Visibility {
    let raw = max(0, min((elapsed - delay) / rowDuration, 1))
    let eased =
      raw < 0.5
      ? 4 * raw * raw * raw
      : 1 - pow(-2 * raw + 2, 3) / 2
    return TerminalSidebarLayoutPlan.Visibility(
      height: 1 - eased,
      alpha: max(1 - 2 * raw, 0)
    )
  }

  static func totalDuration(rowCount: Int) -> TimeInterval {
    (delays(rowCount: rowCount).last ?? 0) + rowDuration
  }
}

enum TerminalSidebarAutoscrollBehavior {
  static let edgeSize: CGFloat = 60
  static let minimumViewportHeight: CGFloat = 240
  static let hysteresis: CGFloat = 20
  static let activationDelay: TimeInterval = 0.25
  static let minimumStep: CGFloat = 1
  static let maximumStep: CGFloat = 8

  static func step(penetration: CGFloat) -> CGFloat {
    let normalized = max(0, min(penetration, 1))
    return minimumStep + (maximumStep - minimumStep) * normalized
  }
}

@MainActor
private final class TerminalSidebarDragGestureRecognizer: NSGestureRecognizer {
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
    delaysPrimaryMouseButtonEvents = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func mouseDown(with event: NSEvent) {
    super.mouseDown(with: event)
    guard
      let collectionView,
      let indexPath = collectionView.indexPathForItem(
        at: collectionView.convert(event.locationInWindow, from: nil)
      ),
      let entryID = collectionView.canBeginDrag?(indexPath)
    else {
      dragState = .failed
      state = .failed
      return
    }
    pendingDrag = PendingDrag(
      entryID: entryID,
      location: collectionView.convert(event.locationInWindow, from: nil),
      mouseDownEvent: event
    )
    dragState = .pending
  }

  override func mouseDragged(with event: NSEvent) {
    super.mouseDragged(with: event)
    guard let collectionView, let pendingDrag else { return }
    let location = collectionView.convert(event.locationInWindow, from: nil)
    guard TerminalSidebarDragActivation.shouldBegin(from: pendingDrag.location, to: location)
    else { return }
    self.pendingDrag = nil
    dragState = .active
    state = .began
    guard collectionView.onDragBegan?(pendingDrag.entryID, pendingDrag.mouseDownEvent, event) == true
    else {
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
    case .idle, .failed:
      break
    }
  }

  override func reset() {
    super.reset()
    pendingDrag = nil
    dragState = .idle
  }

  func finish() {
    pendingDrag = nil
    dragState = .idle
    switch state {
    case .possible:
      state = .failed
    case .began, .changed:
      state = .cancelled
    case .ended, .cancelled, .failed:
      break
    @unknown default:
      state = .cancelled
    }
  }
}

@MainActor
final class TerminalSidebarCollectionView: NSCollectionView {
  var canBeginDrag: ((IndexPath) -> TerminalSidebarEntryID?)?
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
  private let onEnded: (TerminalSidebarDragSessionSource, NSPoint, NSDragOperation) -> Void

  init(
    onEnded: @escaping (TerminalSidebarDragSessionSource, NSPoint, NSDragOperation) -> Void
  ) {
    self.onEnded = onEnded
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .move
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    onEnded(self, screenPoint, operation)
  }
}
