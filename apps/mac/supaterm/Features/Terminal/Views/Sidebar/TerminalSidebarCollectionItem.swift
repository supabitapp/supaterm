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
      item: self,
      hostedView: hostedView,
      sourceFrame: sourceFrame
    )
  }

  func restoreHostedView(_ hostedView: NSView) {
    containerView.restoreHostedView(hostedView)
  }
}

@MainActor
struct TerminalSidebarLiftedRow {
  let item: TerminalSidebarCollectionItem
  let hostedView: NSView
  let sourceFrame: CGRect
  let size: CGSize

  init(item: TerminalSidebarCollectionItem, hostedView: NSView, sourceFrame: CGRect) {
    self.item = item
    self.hostedView = hostedView
    self.sourceFrame = sourceFrame
    size = hostedView.frame.size
  }

  func restore() {
    item.restoreHostedView(hostedView)
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
    guard let entryID, collectionView?.rowMouseUp(entryID: entryID) == true else {
      super.mouseUp(with: event)
      return
    }
  }
}

@MainActor
final class TerminalSidebarDropIndicatorView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.controlAccentColor.cgColor
    layer?.cornerRadius = 1
    layer?.zPosition = 100
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }
}
