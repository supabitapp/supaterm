import AppKit
import SwiftUI

@MainActor
final class TerminalSidebarCollectionItem: NSCollectionViewItem {
  static let identifier = NSUserInterfaceItemIdentifier("TerminalSidebarCollectionItem")
  private let containerView = TerminalSidebarHostingContainerView()

  override func loadView() {
    view = containerView
  }

  func host(
    _ view: TerminalSidebarHostedRow
  ) {
    containerView.host(view)
  }

  func liftHostedView(sourceFrame: CGRect) -> TerminalSidebarLiftedRow? {
    guard let hostedView = containerView.liftHostedView() else { return nil }
    return TerminalSidebarLiftedRow(
      hostedView: hostedView,
      sourceFrame: sourceFrame,
      restore: { [weak self, weak hostedView] in
        guard let self, let hostedView else { return }
        restoreHostedView(hostedView)
      }
    )
  }

  func restoreHostedView(_ hostedView: NSView) {
    containerView.restoreHostedView(hostedView)
  }
}

@MainActor
struct TerminalSidebarLiftedRow {
  let hostedView: NSView
  let sourceFrame: CGRect
  let restoreAction: @MainActor () -> Void

  init(
    hostedView: NSView,
    sourceFrame: CGRect,
    restore: @escaping @MainActor () -> Void
  ) {
    self.hostedView = hostedView
    self.sourceFrame = sourceFrame
    restoreAction = restore
  }

  func restore() {
    restoreAction()
  }
}

@MainActor
class TerminalSidebarHostingContainerView: NSView {
  private var hostingView: NSHostingView<TerminalSidebarHostedRow>?
  private var isLifted = false

  override func layout() {
    super.layout()
    if !isLifted { hostingView?.frame = bounds }
  }

  func host(_ rootView: TerminalSidebarHostedRow) {
    if let hostingView {
      hostingView.rootView = rootView
      if !isLifted { hostingView.frame = bounds }
      return
    }
    let hostingView = NSHostingView(rootView: rootView)
    hostingView.frame = bounds
    hostingView.autoresizingMask = [.width, .height]
    addSubview(hostingView)
    self.hostingView = hostingView
  }

  func liftHostedView() -> NSView? {
    guard let hostingView, !isLifted else { return nil }
    isLifted = true
    hostingView.removeFromSuperview()
    return hostingView
  }

  func restoreHostedView(_ hostedView: NSView) {
    guard hostedView === hostingView else { return }
    hostedView.removeFromSuperview()
    addSubview(hostedView)
    hostedView.frame = bounds
    isLifted = false
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
    isTracking = false
    self.setPressed(false)
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard bounds.contains(point),
      collectionView != nil
    else { return nil }
    return self
  }

  override func mouseDown(with event: NSEvent) {
    guard collectionView?.rowMouseDown(entryID: entryID, event: event) == true else {
      super.mouseDown(with: event)
      return
    }
    isTracking = true
    setPressed(true)
  }

  override func mouseDragged(with event: NSEvent) {
    guard isTracking, let collectionView else {
      super.mouseDragged(with: event)
      return
    }
    if collectionView.rowMouseDragged(entryID: entryID, event: event) {
      isTracking = false
      setPressed(false)
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard isTracking, let collectionView else {
      super.mouseUp(with: event)
      return
    }
    isTracking = false
    setPressed(false)
    _ = collectionView.rowMouseUp(entryID: entryID, event: event)
  }

  override func viewWillMove(toWindow newWindow: NSWindow?) {
    if newWindow == nil, isTracking {
      isTracking = false
      setPressed(false)
    }
    super.viewWillMove(toWindow: newWindow)
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

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
