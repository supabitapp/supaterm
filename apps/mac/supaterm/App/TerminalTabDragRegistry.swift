import AppKit

enum TerminalTabDragPreviewType: Equatable {
  case window
  case contentPane
}

extension NSPasteboard.PasteboardType {
  static let terminalPaneDrag = NSPasteboard.PasteboardType(
    "app.supaterm.terminal-pane-drag.v1"
  )
  static let terminalTabDrag = NSPasteboard.PasteboardType(
    "app.supaterm.terminal-tab-drag.v1"
  )
}

enum TerminalTabDragPasteboard {
  static func write(
    _ payload: TerminalTabDragPayload,
    to item: NSPasteboardItem,
    types: [NSPasteboard.PasteboardType] = [.terminalTabDrag]
  ) -> Bool {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(payload) else { return false }
    return types.allSatisfy { item.setData(data, forType: $0) }
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
    let placement: TerminalTabPlacement
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

  struct PaneRearrangementDestination: Equatable {
    let windowControllerID: UUID
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
    let surfaceID: UUID
    let zone: TerminalSplitDropZone
  }

  enum Outcome: Equatable {
    case cancelled
    case moved
  }

  enum SourceDisposition: Equatable {
    case retained
    case removed
  }

  enum PresentationState: Equatable {
    case sourceSurface
    case sharedPreview(frame: CGRect)
  }

  private enum PreviewDestination: Equatable {
    case none
    case desktop
    case sidebar(UUID)
    case split(SplitDestination)
    case pane(PaneRearrangementDestination)

    var previewType: TerminalTabDragPreviewType {
      switch self {
      case .none, .desktop, .sidebar:
        .window
      case .split, .pane:
        .contentPane
      }
    }
  }

  private struct Session {
    let payload: TerminalTabDragPayload
    let didTransfer: (TerminalTabMoveOperationID, SourceDisposition) -> Void
    var previewImage: NSImage?
    let previewContentSize: CGSize?
    let sidebarDropGapHeight: CGFloat?
    var splitDestinationEntryAction: (() -> Void)?
    var previewDestination: PreviewDestination
    var presentationState: PresentationState
  }

  var transfer: ((TerminalTabDragPayload, Destination) -> TerminalTabTransferResult?)?
  var split: ((TerminalTabDragPayload, SplitDestination) -> Bool)?
  var rearrangePane: ((TerminalTabDragPayload, PaneRearrangementDestination) -> Bool)?
  var detach: ((TerminalTabDragPayload, CGRect) -> Bool)?
  var sessionMoved: ((TerminalTabDragPayload, CGPoint) -> Void)?
  var sessionFinished: (() -> Void)?

  private var session: Session?
  private let previewPresenter: any TerminalTabDragPreviewPresenting
  private(set) var lastOutcome: Outcome?

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
      previewDestination: .none,
      presentationState: .sourceSurface
    )
    lastOutcome = nil
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
      session.previewDestination = .none
      presentationState = .sourceSurface
    } else {
      let frame = TerminalTabDragPreviewLayout.frame(
        for: session.previewContentSize,
        at: screenPoint
      )
      presentationState = .sharedPreview(
        frame: previewPresenter.show(
          image: session.previewImage,
          frame: frame,
          type: session.previewDestination.previewType
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

  func setDesktopDestination(_ payload: TerminalTabDragPayload, isActive: Bool) {
    setPreviewDestination(payload, to: isActive ? .desktop : nil, clearing: .desktop)
  }

  func setSidebarDestination(
    _ payload: TerminalTabDragPayload,
    windowControllerID: UUID,
    isActive: Bool
  ) {
    let destination = PreviewDestination.sidebar(windowControllerID)
    setPreviewDestination(
      payload,
      to: isActive ? destination : nil,
      clearing: .sidebar(windowControllerID)
    )
  }

  func setSplitDestination(
    _ payload: TerminalTabDragPayload,
    destination: SplitDestination
  ) {
    guard payload.singleTabID != nil else { return }
    setPreviewDestination(payload, to: .split(destination))
  }

  func clearSplitDestination(
    _ payload: TerminalTabDragPayload,
    windowControllerID: UUID
  ) {
    setPreviewDestination(
      payload,
      to: nil,
      clearing: .split(windowControllerID)
    )
  }

  func setPaneDestination(
    _ payload: TerminalTabDragPayload,
    destination: PaneRearrangementDestination
  ) {
    guard case .pane = payload.source else { return }
    setPreviewDestination(payload, to: .pane(destination))
  }

  func clearPaneDestination(
    _ payload: TerminalTabDragPayload,
    surfaceID: UUID
  ) {
    setPreviewDestination(payload, to: nil, clearing: .pane(surfaceID))
  }

  func performPaneRearrangement(
    _ payload: TerminalTabDragPayload,
    to destination: PaneRearrangementDestination
  ) -> Bool {
    guard
      let session,
      session.payload == payload,
      session.previewDestination == .pane(destination),
      rearrangePane?(payload, destination) == true
    else { return false }
    session.didTransfer(payload.moveOperationID, .retained)
    return true
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

  func finish(operationID: TerminalTabMoveOperationID, outcome: Outcome) {
    guard session?.payload.operationID == operationID.rawValue else { return }
    session = nil
    previewPresenter.hide()
    lastOutcome = outcome
    sessionFinished?()
  }

  private enum PreviewDestinationKind {
    case desktop
    case sidebar(UUID)
    case split(UUID)
    case pane(UUID)

    func matches(_ destination: PreviewDestination) -> Bool {
      switch (self, destination) {
      case (.desktop, .desktop):
        true
      case (.sidebar(let expected), .sidebar(let actual)):
        expected == actual
      case (.split(let expected), .split(let actual)):
        expected == actual.windowControllerID
      case (.pane(let expected), .pane(let actual)):
        expected == actual.surfaceID
      default:
        false
      }
    }
  }

  private func setPreviewDestination(
    _ payload: TerminalTabDragPayload,
    to destination: PreviewDestination?,
    clearing kind: PreviewDestinationKind? = nil
  ) {
    guard
      var session,
      session.payload == payload
    else { return }
    if let kind, destination == nil, !kind.matches(session.previewDestination) {
      return
    }
    let nextDestination = destination ?? .none
    guard nextDestination != session.previewDestination else { return }
    let previousType = session.previewDestination.previewType
    session.previewDestination = nextDestination
    self.session = session
    let nextType = nextDestination.previewType
    guard
      previousType != nextType,
      case .sharedPreview = session.presentationState
    else { return }
    _ = previewPresenter.transition(to: nextType)
  }
}
