import AppKit

enum TerminalTabDragPreviewType: Equatable {
  case window
  case contentPane
}

extension NSPasteboard.PasteboardType {
  static let terminalTabDrag = NSPasteboard.PasteboardType(
    "app.supaterm.terminal-tab-drag.v1"
  )
}

enum TerminalTabDragPasteboard {
  static func write(_ payload: TerminalTabDragPayload, to item: NSPasteboardItem) -> Bool {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(payload) else { return false }
    return item.setData(data, forType: .terminalTabDrag)
  }

  static func read(from pasteboard: NSPasteboard) -> TerminalTabDragPayload? {
    guard
      let data = pasteboard.data(forType: .terminalTabDrag),
      let payload = try? JSONDecoder().decode(TerminalTabDragPayload.self, from: data),
      payload.isValid
    else { return nil }
    return payload
  }
}

@MainActor
final class TerminalTabDragRegistry {
  struct Destination: Equatable {
    let windowControllerID: UUID
    let spaceID: TerminalSpaceID
    let expectedTopologyRevision: UInt64
    let destination: TerminalTabTransferDestination
  }

  struct SplitDestination: Equatable {
    let windowControllerID: UUID
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
    let zone: TerminalSplitDropZone

    func sourceDisposition(for payload: TerminalTabDragPayload) -> SourceDisposition {
      if payload.sourceWindowID == windowControllerID,
        payload.sourceSpaceID == spaceID,
        payload.singleTabID == tabID
      {
        .retained
      } else {
        .removed
      }
    }
  }

  enum SourceDisposition: Equatable {
    case retained
    case removed
  }

  enum PresentationState: Equatable {
    case sourceSurface
    case sharedPreview(frame: CGRect)
  }

  private struct Session {
    let payload: TerminalTabDragPayload
    let didTransfer: (TerminalTabMoveOperationID, SourceDisposition) -> Void
    var previewImage: NSImage?
    let previewContentSize: CGSize?
    let sidebarDropGapHeight: CGFloat?
    var splitDestinationEntryAction: (() -> Void)?
    var presentationState: PresentationState
  }

  var transfer: ((TerminalTabDragPayload, Destination) -> TerminalTabTransferResult?)?
  var split: ((TerminalTabDragPayload, SplitDestination) -> Bool)?
  var detach: ((TerminalTabDragPayload, CGRect) -> Bool)?
  var sessionMoved: ((TerminalTabDragPayload, CGPoint) -> Void)?
  var sessionFinished: (() -> Void)?

  private var session: Session?
  private let previewPresenter: any TerminalTabDragPreviewPresenting
  init(
    previewPresenter: any TerminalTabDragPreviewPresenting = TerminalTabDragPreviewController()
  ) {
    self.previewPresenter = previewPresenter
  }

  var activePayload: TerminalTabDragPayload? {
    session?.payload
  }

  func begin(
    _ payload: TerminalTabDragPayload,
    previewImage: NSImage? = nil,
    previewContentSize: CGSize? = nil,
    sidebarDropGapHeight: CGFloat? = nil,
    splitDestinationEntryAction: (() -> Void)? = nil,
    didTransfer: @escaping (TerminalTabMoveOperationID, SourceDisposition) -> Void = { _, _ in }
  ) -> Bool {
    guard session == nil else { return false }
    session = Session(
      payload: payload,
      didTransfer: didTransfer,
      previewImage: previewImage,
      previewContentSize: previewContentSize,
      sidebarDropGapHeight: sidebarDropGapHeight,
      splitDestinationEntryAction: splitDestinationEntryAction,
      presentationState: .sourceSurface
    )
    return true
  }

  func sidebarDropGapHeight(for payload: TerminalTabDragPayload) -> CGFloat? {
    guard session?.payload == payload else { return nil }
    return session?.sidebarDropGapHeight
  }

  func resolve(_ pasteboard: NSPasteboard) -> TerminalTabDragPayload? {
    guard let decoded = TerminalTabDragPasteboard.read(from: pasteboard), decoded == activePayload
    else {
      return nil
    }
    return decoded
  }

  func performTransfer(
    _ payload: TerminalTabDragPayload,
    to destination: Destination
  ) -> TerminalTabTransferResult? {
    guard let session, session.payload == payload, let result = transfer?(payload, destination)
    else {
      return nil
    }
    session.didTransfer(payload.moveOperationID, .removed)
    return result
  }

  func performSplit(
    _ payload: TerminalTabDragPayload,
    to destination: SplitDestination
  ) -> Bool {
    guard let session, session.payload == payload, split?(payload, destination) == true else {
      return false
    }
    session.didTransfer(payload.moveOperationID, destination.sourceDisposition(for: payload))
    return true
  }

  func consumeSplitDestinationEntryAction(for payload: TerminalTabDragPayload) {
    guard payload.singleTabID != nil, var session, session.payload == payload else { return }
    let action = session.splitDestinationEntryAction
    session.splitDestinationEntryAction = nil
    self.session = session
    action?()
  }

  func move(to screenPoint: CGPoint, sourceSurfaceFrame: CGRect) -> PresentationState? {
    guard var session else { return nil }
    let presentationState: PresentationState
    if sourceSurfaceFrame.contains(screenPoint) {
      previewPresenter.hide()
      presentationState = .sourceSurface
    } else {
      let frame = TerminalTabDragPreviewLayout.frame(
        for: session.previewContentSize,
        at: screenPoint
      )
      presentationState = .sharedPreview(
        frame: previewPresenter.show(
          image: session.previewImage,
          frame: frame
        )
      )
    }
    session.presentationState = presentationState
    self.session = session
    sessionMoved?(session.payload, screenPoint)
    return presentationState
  }

  @discardableResult
  func updatePreviewImage(
    _ image: NSImage?,
    operationID: TerminalTabMoveOperationID
  ) -> Bool {
    guard var session, session.payload.moveOperationID == operationID else { return false }
    session.previewImage = image
    self.session = session
    if case .sharedPreview = session.presentationState {
      previewPresenter.update(image: image)
    }
    return true
  }

  @discardableResult
  func transitionSharedPreview(
    _ payload: TerminalTabDragPayload,
    to type: TerminalTabDragPreviewType
  ) -> Bool {
    guard
      let session,
      session.payload == payload,
      case .sharedPreview = session.presentationState,
      type != .contentPane || payload.singleTabID != nil
    else { return false }
    return previewPresenter.transition(to: type)
  }

  func performDetach(_ payload: TerminalTabDragPayload) -> Bool {
    guard
      let session,
      session.payload == payload,
      case .sharedPreview(let previewFrame) = session.presentationState,
      detach?(payload, previewFrame) == true
    else { return false }
    session.didTransfer(payload.moveOperationID, .removed)
    return true
  }

  func finish(operationID: TerminalTabMoveOperationID) {
    guard session?.payload.operationID == operationID.rawValue else { return }
    session = nil
    previewPresenter.hide()
    sessionFinished?()
  }
}
