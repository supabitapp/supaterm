import AppKit

@MainActor
final class TerminalTabNativeDragSession {
  struct NativeStart {
    let begin:
      @MainActor (
        NSView,
        any NSDraggingSource,
        TerminalTabDragPayload,
        CGRect,
        NSEvent?
      ) -> Bool

    static let live = Self { sourceView, draggingSource, payload, frame, event in
      guard let event else { return false }
      let pasteboardItem = NSPasteboardItem()
      guard TerminalTabDragPasteboard.write(payload, to: pasteboardItem) else { return false }
      let draggingItem = NSDraggingItem(pasteboardWriter: pasteboardItem)
      draggingItem.setDraggingFrame(
        TerminalTabNativeDragSession.draggingFrame(for: frame),
        contents: nil
      )
      let session = sourceView.beginDraggingSession(
        with: [draggingItem],
        event: event,
        source: draggingSource
      )
      session.draggingFormation = .none
      session.animatesToStartingPositionsOnCancelOrFail = false
      return true
    }
  }

  private struct SourceCapture {
    let id: UUID
    var previewImage: NSImage?
    let previewContentSize: CGSize
  }

  private enum Lifecycle {
    case idle
    case prepared(
      source: SourceCapture,
      task: Task<Void, Never>?
    )
    case registered(
      captureID: UUID,
      operationID: TerminalTabMoveOperationID,
      task: Task<Void, Never>?
    )

    var task: Task<Void, Never>? {
      switch self {
      case .idle:
        return nil
      case .prepared(_, let task), .registered(_, _, let task):
        return task
      }
    }

    var operationID: TerminalTabMoveOperationID? {
      guard case .registered(_, let operationID, _) = self else { return nil }
      return operationID
    }
  }

  private let sourceView: NSView
  private let draggingSource: any NSDraggingSource
  private weak var sourceSurfaceView: NSView?
  private let registry: TerminalTabDragRegistry
  private let captureClient: TerminalWindowCaptureClient
  private let captureRequest: () -> TerminalWindowCaptureRequest?
  private let nativeStart: NativeStart
  private var lifecycle = Lifecycle.idle

  init(
    sourceView: NSView,
    draggingSource: any NSDraggingSource,
    sourceSurfaceView: NSView,
    registry: TerminalTabDragRegistry,
    captureClient: TerminalWindowCaptureClient,
    captureRequest: @escaping () -> TerminalWindowCaptureRequest?,
    nativeStart: NativeStart = .live
  ) {
    self.sourceView = sourceView
    self.draggingSource = draggingSource
    self.sourceSurfaceView = sourceSurfaceView
    self.registry = registry
    self.captureClient = captureClient
    self.captureRequest = captureRequest
    self.nativeStart = nativeStart
  }

  convenience init(
    collectionView: TerminalSidebarCollectionView,
    sourceSurfaceView: NSView,
    registry: TerminalTabDragRegistry,
    captureClient: TerminalWindowCaptureClient,
    captureRequest: @escaping () -> TerminalWindowCaptureRequest?
  ) {
    self.init(
      sourceView: collectionView,
      draggingSource: collectionView,
      sourceSurfaceView: sourceSurfaceView,
      registry: registry,
      captureClient: captureClient,
      captureRequest: captureRequest
    )
  }

  @discardableResult
  func prepareSourceCapture() -> Bool {
    guard
      let window = sourceView.window,
      let sourceSurfaceView,
      sourceSurfaceView.window === window
    else {
      cancelSourceCapture()
      return false
    }
    return prepareSourceCapture(
      previewContentSize: TerminalTabDragPreviewLayout.sourceContentSize(for: window.frame),
      request: captureRequest()
    )
  }

  @discardableResult
  func prepareSourceCapture(previewContentSize: CGSize) -> Bool {
    prepareSourceCapture(
      previewContentSize: previewContentSize,
      request: captureRequest()
    )
  }

  @discardableResult
  func prepareSourceCapture(
    previewContentSize: CGSize,
    request: TerminalWindowCaptureRequest?
  ) -> Bool {
    guard lifecycle.operationID == nil else { return false }
    cancelSourceCapture()
    let captureID = UUID()
    let source = SourceCapture(
      id: captureID,
      previewImage: nil,
      previewContentSize: previewContentSize
    )
    guard let request else {
      lifecycle = .prepared(source: source, task: nil)
      return true
    }
    lifecycle = .prepared(source: source, task: nil)
    let capture = captureClient.capture
    let task = Task(priority: .userInitiated) { [weak self] in
      let image = await capture(request).map {
        NSImage(cgImage: $0, size: request.geometry.sourceRect.size)
      }
      guard let self else { return }
      guard !Task.isCancelled else { return }
      captureCompleted(image, captureID: captureID)
    }
    guard case .prepared(let preparedSource, nil) = lifecycle,
      preparedSource.id == captureID
    else {
      task.cancel()
      return true
    }
    lifecycle = .prepared(source: preparedSource, task: task)
    return true
  }

  func cancelSourceCapture() {
    guard case .prepared = lifecycle else { return }
    lifecycle.task?.cancel()
    lifecycle = .idle
  }

  func register(
    _ payload: TerminalTabDragPayload,
    dropGapHeight: CGFloat? = nil,
    splitDestinationEntryAction: (() -> Void)? = nil,
    didTransfer:
      @escaping (
        TerminalTabMoveOperationID,
        TerminalTabDragRegistry.SourceDisposition
      ) -> Void
  ) -> Bool {
    guard case .prepared(let source, let task) = lifecycle else { return false }
    let didBegin = registry.begin(
      payload,
      previewImage: source.previewImage,
      previewContentSize: source.previewContentSize,
      sidebarDropGapHeight: dropGapHeight,
      splitDestinationEntryAction: splitDestinationEntryAction,
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

  func move(
    to screenPoint: CGPoint,
    sourceSurfaceFrame: CGRect? = nil
  ) -> TerminalTabDragRegistry.PresentationState {
    guard
      let presentationState = registry.move(
        to: screenPoint,
        sourceSurfaceFrame: sourceSurfaceFrame ?? liveSourceSurfaceFrame
      )
    else {
      preconditionFailure("Native drag session is not registered")
    }
    return presentationState
  }

  func finish(
    operationID: TerminalTabMoveOperationID,
    outcome: TerminalTabDragRegistry.Outcome
  ) {
    if lifecycle.operationID == operationID {
      lifecycle.task?.cancel()
      lifecycle = .idle
    }
    registry.finish(operationID: operationID, outcome: outcome)
  }

  @discardableResult
  func beginDraggingSession(
    payload: TerminalTabDragPayload,
    frame: CGRect,
    event: NSEvent?
  ) -> Bool {
    nativeStart.begin(sourceView, draggingSource, payload, frame, event)
  }

  private func captureCompleted(_ image: NSImage?, captureID: UUID) {
    switch lifecycle {
    case .idle:
      return
    case .prepared(var source, _) where source.id == captureID:
      source.previewImage = image
      lifecycle = .prepared(source: source, task: nil)
    case .registered(let registeredCaptureID, let operationID, _)
    where registeredCaptureID == captureID:
      lifecycle = .registered(
        captureID: registeredCaptureID,
        operationID: operationID,
        task: nil
      )
      registry.updatePreviewImage(image, operationID: operationID)
    case .prepared, .registered:
      return
    }
  }

  static func draggingFrame(for sourceFrame: CGRect) -> CGRect {
    CGRect(origin: sourceFrame.origin, size: CGSize(width: 1, height: 1))
  }

  private var liveSourceSurfaceFrame: CGRect {
    guard let sourceSurfaceView, let window = sourceSurfaceView.window else { return .null }
    return window.convertToScreen(sourceSurfaceView.convert(sourceSurfaceView.bounds, to: nil))
  }
}

typealias TerminalSidebarNativeDragSession = TerminalTabNativeDragSession
