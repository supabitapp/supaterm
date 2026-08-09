import AppKit

@MainActor
final class TerminalSidebarNativeDragSession {
  private static let previewContentVerticalInset: CGFloat = 80

  struct SourceCapture {
    fileprivate let id: UUID
    fileprivate let previewImage: NSImage?
    fileprivate let previewContentSize: CGSize
    fileprivate let sourceSurfaceFrame: CGRect
  }

  private typealias CaptureWaiter = @MainActor (SourceCapture) -> Void

  private enum Lifecycle {
    case idle
    case pending(
      source: SourceCapture,
      task: Task<Void, Never>?,
      waiter: CaptureWaiter?
    )
    case resolved(source: SourceCapture)
    case registered(operationID: TerminalTabMoveOperationID)

    var task: Task<Void, Never>? {
      guard case .pending(_, let task, _) = self else { return nil }
      return task
    }

    var operationID: TerminalTabMoveOperationID? {
      guard case .registered(let operationID) = self else { return nil }
      return operationID
    }
  }

  private let collectionView: TerminalSidebarCollectionView
  private weak var sourceSurfaceView: NSView?
  private let registry: TerminalTabDragRegistry
  private let captureClient: TerminalTabDragCaptureClient
  private let captureRequest: () -> TerminalTabDragCaptureRequest?
  private var lifecycle = Lifecycle.idle

  init(
    collectionView: TerminalSidebarCollectionView,
    sourceSurfaceView: NSView,
    registry: TerminalTabDragRegistry,
    captureClient: TerminalTabDragCaptureClient,
    captureRequest: @escaping () -> TerminalTabDragCaptureRequest?
  ) {
    self.collectionView = collectionView
    self.sourceSurfaceView = sourceSurfaceView
    self.registry = registry
    self.captureClient = captureClient
    self.captureRequest = captureRequest
  }

  @discardableResult
  func prepareSourceCapture() -> Bool {
    guard
      let window = collectionView.window,
      let sourceSurfaceView,
      sourceSurfaceView.window === window
    else {
      cancelSourceCapture()
      return false
    }
    let sourceSurfaceFrame = window.convertToScreen(
      sourceSurfaceView.convert(sourceSurfaceView.bounds, to: nil)
    )
    return prepareSourceCapture(
      previewContentSize: CGSize(
        width: window.frame.width,
        height: window.frame.height - Self.previewContentVerticalInset
      ),
      sourceSurfaceFrame: sourceSurfaceFrame,
      request: captureRequest()
    )
  }

  @discardableResult
  func prepareSourceCapture(
    previewContentSize: CGSize,
    sourceSurfaceFrame: CGRect,
    request: TerminalTabDragCaptureRequest?
  ) -> Bool {
    cancelSourceCapture()
    guard !sourceSurfaceFrame.isEmpty else { return false }
    let captureID = UUID()
    let source = SourceCapture(
      id: captureID,
      previewImage: nil,
      previewContentSize: previewContentSize,
      sourceSurfaceFrame: sourceSurfaceFrame
    )
    guard let request else {
      lifecycle = .resolved(source: source)
      return true
    }
    lifecycle = .pending(source: source, task: nil, waiter: nil)
    let capture = captureClient.capture
    let task = Task(priority: .userInitiated) { [weak self] in
      let image = await capture(request)
      guard let self else { return }
      guard !Task.isCancelled else { return }
      captureCompleted(image, captureID: captureID)
    }
    guard case .pending(let pendingSource, nil, let waiter) = lifecycle,
      pendingSource.id == captureID
    else {
      task.cancel()
      return true
    }
    lifecycle = .pending(source: pendingSource, task: task, waiter: waiter)
    return true
  }

  func cancelSourceCapture() {
    lifecycle.task?.cancel()
    lifecycle = .idle
  }

  @discardableResult
  func whenSourceCaptureResolved(
    _ completion: @escaping @MainActor (SourceCapture) -> Void
  ) -> Bool {
    switch lifecycle {
    case .idle, .registered:
      return false
    case .pending(let source, let task, nil):
      lifecycle = .pending(source: source, task: task, waiter: completion)
      return true
    case .pending:
      return false
    case .resolved(let source):
      completion(source)
      return true
    }
  }

  func register(
    _ payload: TerminalTabDragPayload,
    source: SourceCapture,
    splitDestinationEntryAction: (() -> Void)? = nil,
    didTransfer: @escaping (TerminalTabMoveOperationID) -> Void
  ) -> Bool {
    guard
      case .resolved(let preparedSource) = lifecycle,
      preparedSource.id == source.id
    else { return false }
    let didBegin = registry.begin(
      payload,
      previewImage: preparedSource.previewImage,
      previewContentSize: preparedSource.previewContentSize,
      sourceSurfaceFrame: preparedSource.sourceSurfaceFrame,
      splitDestinationEntryAction: splitDestinationEntryAction,
      didTransfer: didTransfer
    )
    guard didBegin else {
      cancelSourceCapture()
      return false
    }
    lifecycle = .registered(operationID: payload.moveOperationID)
    return true
  }

  func move(to screenPoint: CGPoint) -> TerminalTabDragRegistry.PresentationState {
    guard let presentationState = registry.move(to: screenPoint) else {
      preconditionFailure("Native drag session is not registered")
    }
    return presentationState
  }

  func finish(
    operationID: TerminalTabMoveOperationID,
    outcome: TerminalTabDragRegistry.Outcome
  ) {
    if lifecycle.operationID == operationID {
      cancelSourceCapture()
    }
    registry.finish(operationID: operationID, outcome: outcome)
  }

  func beginDraggingSession(
    payload: TerminalTabDragPayload,
    frame: CGRect,
    event: NSEvent
  ) {
    let pasteboardItem = NSPasteboardItem()
    precondition(TerminalTabDragPasteboard.write(payload, to: pasteboardItem))
    let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
    draggingItem.setDraggingFrame(frame, contents: nil)
    let session = collectionView.beginDraggingSession(
      with: [draggingItem],
      event: event,
      source: collectionView
    )
    session.draggingFormation = .none
    session.animatesToStartingPositionsOnCancelOrFail = false
  }

  private func captureCompleted(_ image: NSImage?, captureID: UUID) {
    guard case .pending(let source, _, let waiter) = lifecycle,
      source.id == captureID
    else { return }
    let resolvedSource = SourceCapture(
      id: source.id,
      previewImage: image,
      previewContentSize: source.previewContentSize,
      sourceSurfaceFrame: source.sourceSurfaceFrame
    )
    lifecycle = .resolved(source: resolvedSource)
    waiter?(resolvedSource)
  }
}
