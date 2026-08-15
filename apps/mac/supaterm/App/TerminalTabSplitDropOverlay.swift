import AppKit
import SwiftUI

@MainActor
final class TerminalTabSplitDropOverlayView: NSView {
  private let hostingView = NSHostingView(
    rootView: TerminalSplitDropOverlay(zone: .left, color: .clear)
  )

  override var isFlipped: Bool { true }

  init() {
    super.init(frame: .zero)
    isHidden = true
    hostingView.autoresizingMask = [.width, .height]
    addSubview(hostingView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    nil
  }

  override func layout() {
    super.layout()
    hostingView.frame = bounds
  }

  func target(at point: CGPoint) -> TerminalSplitDropZone {
    TerminalSplitDropZone.calculate(at: point, in: bounds.size)
  }

  func render(_ zone: TerminalSplitDropZone, color: Color) {
    hostingView.rootView = TerminalSplitDropOverlay(zone: zone, color: color)
    isHidden = false
  }

  func hide() {
    isHidden = true
  }
}
