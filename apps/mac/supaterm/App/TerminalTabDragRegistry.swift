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

  enum Outcome: Equatable {
    case cancelled
    case moved
  }

  private struct Session {
    let payload: TerminalTabDragPayload
    let didTransfer: (TerminalTabMoveOperationID) -> Void
  }

  var transfer: ((TerminalTabDragPayload, Destination) -> TerminalTabTransferResult?)?

  private var session: Session?
  private(set) var lastOutcome: Outcome?

  var activePayload: TerminalTabDragPayload? {
    session?.payload
  }

  func begin(
    _ payload: TerminalTabDragPayload,
    didTransfer: @escaping (TerminalTabMoveOperationID) -> Void = { _ in }
  ) -> Bool {
    guard session == nil else { return false }
    session = Session(payload: payload, didTransfer: didTransfer)
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

  func finish(operationID: TerminalTabMoveOperationID, outcome: Outcome) {
    guard session?.payload.operationID == operationID.rawValue else { return }
    session = nil
    lastOutcome = outcome
  }
}
