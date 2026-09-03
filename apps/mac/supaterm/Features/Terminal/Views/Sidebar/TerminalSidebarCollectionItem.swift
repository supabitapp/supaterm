import AppKit
import SwiftUI

@MainActor
final class TerminalSidebarCollectionItem: NSCollectionViewItem {
  static let identifier = NSUserInterfaceItemIdentifier("TerminalSidebarCollectionItem")
  private let containerView = TerminalSidebarHostingContainerView()

  var entryID: TerminalSidebarEntryID? { containerView.entryID }

  override func loadView() {
    containerView.wantsLayer = true
    view = containerView
  }

  func host(
    entryID: TerminalSidebarEntryID,
    _ view: TerminalSidebarHostedRow
  ) {
    containerView.host(entryID: entryID, view)
  }

  func liftHostedView(
    sourceFrame: CGRect,
    selectedSurface: TerminalSidebarLiftedSelectionSurface? = nil
  ) -> TerminalSidebarLiftedRow? {
    guard let lift = containerView.liftHostedView() else { return nil }
    return TerminalSidebarLiftedRow(
      id: lift.entryID,
      hostedView: lift.hostedView,
      sourceFrame: sourceFrame,
      selectedSurface: selectedSurface,
      restore: { [weak self, weak hostedView = lift.hostedView] in
        guard let self, let hostedView else { return }
        restoreHostedView(hostedView, entryID: lift.entryID)
      }
    )
  }

  func restoreHostedView(_ hostedView: NSView, entryID: TerminalSidebarEntryID) {
    containerView.restoreHostedView(hostedView, entryID: entryID)
  }
}

@MainActor
struct TerminalSidebarLiftedRow {
  let id: TerminalSidebarEntryID
  let hostedView: NSView
  let sourceFrame: CGRect
  let selectedSurface: TerminalSidebarLiftedSelectionSurface?
  let restoreAction: @MainActor () -> Void

  init(
    id: TerminalSidebarEntryID,
    hostedView: NSView,
    sourceFrame: CGRect,
    selectedSurface: TerminalSidebarLiftedSelectionSurface? = nil,
    restore: @escaping @MainActor () -> Void
  ) {
    self.id = id
    self.hostedView = hostedView
    self.sourceFrame = sourceFrame
    self.selectedSurface = selectedSurface
    restoreAction = restore
  }

  func restore() {
    restoreAction()
  }
}

@MainActor
class TerminalSidebarHostingContainerView: NSView {
  private(set) var entryID: TerminalSidebarEntryID?
  private var hostingView: NSHostingView<TerminalSidebarHostedRow>?
  private weak var liftedHostingView: NSHostingView<TerminalSidebarHostedRow>?

  override func layout() {
    super.layout()
    hostingView?.frame = bounds
  }

  func host(entryID: TerminalSidebarEntryID, _ rootView: TerminalSidebarHostedRow) {
    if self.entryID != entryID {
      hostingView?.removeFromSuperview()
      hostingView = nil
    }
    self.entryID = entryID
    if let hostingView {
      hostingView.rootView = rootView
      hostingView.frame = bounds
      return
    }
    liftedHostingView = nil
    let hostingView = NSHostingView(rootView: rootView)
    hostingView.frame = bounds
    hostingView.autoresizingMask = [.width, .height]
    addSubview(hostingView)
    self.hostingView = hostingView
  }

  func liftHostedView() -> (entryID: TerminalSidebarEntryID, hostedView: NSView)? {
    guard let entryID, let hostingView else { return nil }
    self.hostingView = nil
    liftedHostingView = hostingView
    hostingView.removeFromSuperview()
    return (entryID, hostingView)
  }

  func restoreHostedView(_ view: NSView, entryID: TerminalSidebarEntryID) {
    guard
      hostingView == nil,
      self.entryID == entryID,
      let hostedView = view as? NSHostingView<TerminalSidebarHostedRow>,
      liftedHostingView === hostedView
    else { return }
    liftedHostingView = nil
    hostedView.removeFromSuperview()
    hostingView = hostedView
    addSubview(hostedView)
    hostedView.frame = bounds
  }
}

@MainActor
final class TerminalSidebarPinnedControlView: TerminalSidebarHostingContainerView {
  var onDraggingUpdated: (((any NSDraggingInfo)) -> NSDragOperation)?
  var onDraggingExited: (() -> Void)?
  var onDraggingEnded: (() -> Void)?
  var onPrepareForDragOperation: (((any NSDraggingInfo)) -> Bool)?
  var onPerformDragOperation: (((any NSDraggingInfo)) -> Bool)?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    registerForDraggedTypes([.terminalTabDrag])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    onDraggingUpdated?(sender) ?? []
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    onDraggingUpdated?(sender) ?? []
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    onDraggingExited?()
  }

  override func draggingEnded(_ sender: any NSDraggingInfo) {
    onDraggingEnded?()
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return onPrepareForDragOperation?(sender) == true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    onPerformDragOperation?(sender) == true
  }
}

struct TerminalSidebarRowPointerView: NSViewRepresentable {
  let entryID: TerminalSidebarEntryID
  @Binding var isPressed: Bool

  init(entryID: TerminalSidebarEntryID, isPressed: Binding<Bool> = .constant(false)) {
    self.entryID = entryID
    _isPressed = isPressed
  }

  func makeNSView(context: Context) -> TerminalSidebarRowPointerNSView {
    TerminalSidebarRowPointerNSView(entryID: entryID) { isPressed in
      self.isPressed = isPressed
    }
  }

  func updateNSView(_ nsView: TerminalSidebarRowPointerNSView, context: Context) {
    nsView.update(entryID: entryID) { isPressed in
      self.isPressed = isPressed
    }
  }
}

final class TerminalSidebarRowPointerNSView: NSView {
  var entryID: TerminalSidebarEntryID
  private var setPressed: (Bool) -> Void
  private var isTracking = false

  init(entryID: TerminalSidebarEntryID, setPressed: @escaping (Bool) -> Void = { _ in }) {
    self.entryID = entryID
    self.setPressed = setPressed
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func update(
    entryID: TerminalSidebarEntryID,
    setPressed: @escaping (Bool) -> Void
  ) {
    let entryChanged = self.entryID != entryID
    self.entryID = entryID
    self.setPressed = setPressed
    guard entryChanged, isTracking else { return }
    finishTracking()
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point),
      collectionView != nil
    else { return nil }
    return self
  }

  override func mouseDown(with event: NSEvent) {
    guard
      let collectionView,
      collectionView.rowMouseDown(entryID: entryID, event: event)
    else {
      super.mouseDown(with: event)
      return
    }
    isTracking = true
    collectionView.beginTrackingRowPointer(self)
    setPressed(true)
  }

  override func mouseDragged(with event: NSEvent) {
    guard isTracking, let collectionView else {
      super.mouseDragged(with: event)
      return
    }
    if collectionView.rowMouseDragged(entryID: entryID, event: event) {
      finishTracking()
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard isTracking, let collectionView else {
      super.mouseUp(with: event)
      return
    }
    finishTracking()
    _ = collectionView.rowMouseUp(entryID: entryID, event: event)
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow == nil, isTracking {
      finishTracking()
    }
    super.viewWillMove(toWindow: newWindow)
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

  func finishTracking() {
    guard isTracking else { return }
    isTracking = false
    setPressed(false)
    collectionView?.finishTrackingRowPointer(self)
  }

  private var collectionView: TerminalSidebarCollectionView? {
    var view = superview
    while let current = view {
      if let collectionView = current as? TerminalSidebarCollectionView {
        return collectionView
      }
      view = current.superview
    }
    return nil
  }
}
