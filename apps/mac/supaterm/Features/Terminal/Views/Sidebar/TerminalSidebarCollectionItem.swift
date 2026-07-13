import AppKit
import SwiftUI

@MainActor
final class TerminalSidebarCollectionItem: NSCollectionViewItem {
  static let identifier = NSUserInterfaceItemIdentifier("TerminalSidebarCollectionItem")
  private let containerView = TerminalSidebarHostingContainerView()

  override func loadView() {
    view = containerView
  }

  func host(_ view: AnyView) {
    containerView.host(view)
  }
}

@MainActor
private final class TerminalSidebarHostingContainerView: NSView {
  private var hostingView: NSHostingView<AnyView>?

  override func layout() {
    super.layout()
    hostingView?.frame = bounds
  }

  func host(_ rootView: AnyView) {
    if let hostingView {
      hostingView.rootView = rootView
      hostingView.frame = bounds
      return
    }
    let hostingView = NSHostingView(rootView: rootView)
    hostingView.frame = bounds
    hostingView.autoresizingMask = [.width, .height]
    addSubview(hostingView)
    self.hostingView = hostingView
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
