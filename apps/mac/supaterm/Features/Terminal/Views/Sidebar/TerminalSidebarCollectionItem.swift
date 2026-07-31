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
final class TerminalSidebarHostingContainerView: NSView {
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

struct TerminalSidebarRowPointerView: NSViewRepresentable {
  let entryID: TerminalSidebarEntryID

  func makeNSView(context: Context) -> TerminalSidebarRowPointerNSView {
    TerminalSidebarRowPointerNSView(entryID: entryID)
  }

  func updateNSView(_ nsView: TerminalSidebarRowPointerNSView, context: Context) {
    nsView.entryID = entryID
  }
}

final class TerminalSidebarRowPointerNSView: NSView {
  var entryID: TerminalSidebarEntryID
  private var isTracking = false

  init(entryID: TerminalSidebarEntryID) {
    self.entryID = entryID
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

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
  }

  override func mouseDragged(with event: NSEvent) {
    guard isTracking, let collectionView else {
      super.mouseDragged(with: event)
      return
    }
    if collectionView.rowMouseDragged(entryID: entryID, event: event) {
      isTracking = false
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard isTracking, let collectionView else {
      super.mouseUp(with: event)
      return
    }
    isTracking = false
    _ = collectionView.rowMouseUp(entryID: entryID, event: event)
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
