import AppKit

@MainActor
final class TerminalSidebarNativeDragSession {
  private static let previewContentVerticalInset: CGFloat = 80

  struct SourceCapture {
    fileprivate let previewImage: NSImage?
    fileprivate let previewContentSize: CGSize
    fileprivate let sourceSurfaceFrame: CGRect
  }

  private let collectionView: TerminalSidebarCollectionView
  private weak var sourceSurfaceView: NSView?
  private let registry: TerminalTabDragRegistry

  init(
    collectionView: TerminalSidebarCollectionView,
    sourceSurfaceView: NSView,
    registry: TerminalTabDragRegistry
  ) {
    self.collectionView = collectionView
    self.sourceSurfaceView = sourceSurfaceView
    self.registry = registry
  }

  func captureSource() -> SourceCapture? {
    guard
      let window = collectionView.window,
      let sourceSurfaceView,
      sourceSurfaceView.window === window
    else { return nil }
    let sourceSurfaceFrame = window.convertToScreen(
      sourceSurfaceView.convert(sourceSurfaceView.bounds, to: nil)
    )
    guard !sourceSurfaceFrame.isEmpty else { return nil }
    return SourceCapture(
      previewImage: window.terminalTabDragSnapshot(),
      previewContentSize: CGSize(
        width: window.frame.width,
        height: window.frame.height - Self.previewContentVerticalInset
      ),
      sourceSurfaceFrame: sourceSurfaceFrame
    )
  }

  func register(
    _ payload: TerminalTabDragPayload,
    source: SourceCapture,
    didTransfer: @escaping (TerminalTabMoveOperationID) -> Void
  ) -> Bool {
    registry.begin(
      payload,
      previewImage: source.previewImage,
      previewContentSize: source.previewContentSize,
      sourceSurfaceFrame: source.sourceSurfaceFrame,
      didTransfer: didTransfer
    )
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
}
