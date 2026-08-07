import AppKit

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
    let placement: TerminalTabPlacement
  }

  struct SplitDestination: Equatable {
    let windowControllerID: UUID
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
    let side: TerminalTabSplitSide
  }

  enum Outcome: Equatable {
    case cancelled
    case moved
  }

  private struct Session {
    let payload: TerminalTabDragPayload
    let didTransfer: (TerminalTabMoveOperationID) -> Void
    let previewImage: NSImage?
    let previewSize: CGSize
    let sourceWindowFrame: CGRect?
    var previewFrame: CGRect?
  }

  var transfer: ((TerminalTabDragPayload, Destination) -> TerminalTabTransferResult?)?
  var split: ((TerminalTabDragPayload, SplitDestination) -> TerminalTabSplitResult?)?
  var detach: ((TerminalTabDragPayload, CGRect) -> Bool)?
  var sessionMoved: ((TerminalTabDragPayload, CGPoint) -> Void)?
  var sessionFinished: (() -> Void)?

  private var session: Session?
  private let previewController = TerminalTabDragPreviewController()
  private(set) var lastOutcome: Outcome?

  var activePayload: TerminalTabDragPayload? {
    session?.payload
  }

  var previewFrame: CGRect? {
    session?.previewFrame
  }

  func begin(
    _ payload: TerminalTabDragPayload,
    previewImage: NSImage? = nil,
    previewSize: CGSize = CGSize(width: 1_000, height: 700),
    sourceWindowFrame: CGRect? = nil,
    didTransfer: @escaping (TerminalTabMoveOperationID) -> Void = { _ in }
  ) -> Bool {
    guard session == nil else { return false }
    session = Session(
      payload: payload,
      didTransfer: didTransfer,
      previewImage: previewImage,
      previewSize: previewSize,
      sourceWindowFrame: sourceWindowFrame,
      previewFrame: nil
    )
    lastOutcome = nil
    return true
  }

  func resolve(_ pasteboard: NSPasteboard) -> TerminalTabDragPayload? {
    guard let decoded = TerminalTabDragPasteboard.read(from: pasteboard), decoded == activePayload else {
      return nil
    }
    return decoded
  }

  func performTransfer(
    _ payload: TerminalTabDragPayload,
    to destination: Destination
  ) -> TerminalTabTransferResult? {
    guard let session, session.payload == payload, let result = transfer?(payload, destination) else {
      return nil
    }
    session.didTransfer(payload.moveOperationID)
    return result
  }

  func performSplit(
    _ payload: TerminalTabDragPayload,
    to destination: SplitDestination
  ) -> TerminalTabSplitResult? {
    guard let session, session.payload == payload, let result = split?(payload, destination) else {
      return nil
    }
    session.didTransfer(payload.moveOperationID)
    return result
  }

  func move(to screenPoint: CGPoint) {
    guard var session else { return }
    let size = session.previewSize
    session.previewFrame = CGRect(
      x: screenPoint.x - size.width * 0.18,
      y: screenPoint.y - size.height * 0.82,
      width: size.width,
      height: size.height
    )
    self.session = session
    previewController.update(
      image: session.previewImage,
      sourceSize: size,
      sourceWindowFrame: session.sourceWindowFrame,
      screenPoint: screenPoint
    )
    sessionMoved?(session.payload, screenPoint)
  }

  func performDetach(_ payload: TerminalTabDragPayload) -> Bool {
    guard
      let session,
      session.payload == payload,
      let previewFrame = session.previewFrame,
      detach?(payload, previewFrame) == true
    else { return false }
    session.didTransfer(payload.moveOperationID)
    return true
  }

  func finish(operationID: TerminalTabMoveOperationID, outcome: Outcome) {
    guard session?.payload.operationID == operationID.rawValue else { return }
    session = nil
    previewController.hide()
    lastOutcome = outcome
    sessionFinished?()
  }
}
