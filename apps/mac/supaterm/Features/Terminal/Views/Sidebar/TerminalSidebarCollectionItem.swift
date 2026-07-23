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
    _ view: TerminalSidebarHostedRow,
    entryID: TerminalSidebarEntryID,
    collectionView: TerminalSidebarCollectionView
  ) {
    containerView.host(view, entryID: entryID, collectionView: collectionView)
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
private final class TerminalSidebarHostingContainerView: NSView {
  private var hostingView: SidebarEventHostingView?
  private var isLifted = false

  override func layout() {
    super.layout()
    if !isLifted { hostingView?.frame = bounds }
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard
      let eventType = NSApp.currentEvent?.type,
      eventType == .leftMouseDown || eventType == .leftMouseDragged
        || eventType == .leftMouseUp,
      point.x < bounds.maxX - 30,
      let hostingView,
      case .group(let presentation) = hostingView.rootView.presentation,
      hostingView.rootView.context.renameState.groupID != presentation.id,
      let entryID = hostingView.entryID,
      let collectionView = hostingView.collectionView
    else { return super.hitTest(point) }
    if eventType == .leftMouseDown {
      collectionView.routeMouseDown(to: entryID)
    }
    return collectionView
  }

  func host(
    _ rootView: TerminalSidebarHostedRow,
    entryID: TerminalSidebarEntryID,
    collectionView: TerminalSidebarCollectionView
  ) {
    if let hostingView {
      hostingView.rootView = rootView
      hostingView.entryID = entryID
      hostingView.collectionView = collectionView
      if !isLifted { hostingView.frame = bounds }
      return
    }
    let hostingView = SidebarEventHostingView(rootView: rootView)
    hostingView.entryID = entryID
    hostingView.collectionView = collectionView
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
private final class SidebarEventHostingView: NSHostingView<TerminalSidebarHostedRow> {
  weak var collectionView: TerminalSidebarCollectionView?
  var entryID: TerminalSidebarEntryID?

  override func mouseDown(with event: NSEvent) {
    guard let entryID, collectionView?.rowMouseDown(entryID: entryID, event: event) == true else {
      super.mouseDown(with: event)
      return
    }
  }

  override func mouseDragged(with event: NSEvent) {
    guard
      let entryID,
      collectionView?.rowMouseDragged(entryID: entryID, event: event) == true
    else {
      super.mouseDragged(with: event)
      return
    }
  }

  override func mouseUp(with event: NSEvent) {
    guard let entryID, collectionView?.rowMouseUp(entryID: entryID, event: event) == true else {
      super.mouseUp(with: event)
      return
    }
  }
}
