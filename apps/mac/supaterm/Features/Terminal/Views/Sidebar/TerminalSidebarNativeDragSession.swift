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

  private enum Lifecycle {
    case idle
    case prepared(source: SourceCapture, task: Task<Void, Never>?)
    case registered(
      captureID: UUID,
      operationID: TerminalTabMoveOperationID,
      task: Task<Void, Never>?
    )

    var task: Task<Void, Never>? {
      switch self {
      case .idle:
        nil
      case .prepared(_, let task), .registered(_, _, let task):
        task
      }
    }

    var operationID: TerminalTabMoveOperationID? {
      guard case .registered(_, let operationID, _) = self else { return nil }
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
      lifecycle = .prepared(source: source, task: nil)
      return true
    }
    let capture = captureClient.capture
    let task = Task(priority: .userInitiated) { [weak self] in
      let image = await capture(request)
      guard let self else { return }
      guard !Task.isCancelled else { return }
      captureCompleted(image, captureID: captureID)
    }
    lifecycle = .prepared(source: source, task: task)
    return true
  }

  func cancelSourceCapture() {
    lifecycle.task?.cancel()
    lifecycle = .idle
  }

  func captureSource() -> SourceCapture? {
    guard case .prepared(let source, _) = lifecycle else { return nil }
    return source
  }

  func register(
    _ payload: TerminalTabDragPayload,
    source: SourceCapture,
    didTransfer: @escaping (TerminalTabMoveOperationID) -> Void
  ) -> Bool {
    guard
      case .prepared(let preparedSource, let task) = lifecycle,
      preparedSource.id == source.id
    else { return false }
    let didBegin = registry.begin(
      payload,
      previewImage: preparedSource.previewImage,
      previewContentSize: preparedSource.previewContentSize,
      sourceSurfaceFrame: preparedSource.sourceSurfaceFrame,
      didTransfer: didTransfer
    )
    guard didBegin else {
      cancelSourceCapture()
      return false
    }
    lifecycle = .registered(
      captureID: source.id,
      operationID: payload.moveOperationID,
      task: task
    )
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
    switch lifecycle {
    case .idle:
      return
    case .prepared(let source, _):
      guard source.id == captureID else { return }
      lifecycle = .prepared(
        source: SourceCapture(
          id: source.id,
          previewImage: image,
          previewContentSize: source.previewContentSize,
          sourceSurfaceFrame: source.sourceSurfaceFrame
        ),
        task: nil
      )
    case .registered(let registeredCaptureID, let operationID, _):
      guard registeredCaptureID == captureID else { return }
      lifecycle = .registered(
        captureID: registeredCaptureID,
        operationID: operationID,
        task: nil
      )
      guard let image else { return }
      registry.updatePreviewImage(image, operationID: operationID)
    }
  }
}
