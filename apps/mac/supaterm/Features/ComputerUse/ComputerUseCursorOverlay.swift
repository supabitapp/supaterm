import AppKit
import CoreGraphics

@MainActor
final class ComputerUseCursorOverlay {
  private var window: NSPanel?

  func move(to point: CGPoint, enabled: Bool) {
    guard enabled else {
      window?.orderOut(nil)
      return
    }
    let panel = window ?? makeWindow()
    window = panel
    panel.setFrame(
      .init(x: point.x - 10, y: point.y - 10, width: 20, height: 20),
      display: true
    )
    panel.orderFrontRegardless()
  }

  private func makeWindow() -> NSPanel {
    let panel = NSPanel(
      contentRect: .init(x: 0, y: 0, width: 20, height: 20),
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )
    panel.backgroundColor = .clear
    panel.collectionBehavior = [.canJoinAllSpaces, .transient, .ignoresCycle]
    panel.hasShadow = false
    panel.ignoresMouseEvents = true
    panel.isOpaque = false
    panel.level = .floating
    panel.contentView = ComputerUseCursorDotView(
      frame: panel.contentView?.bounds ?? .init(x: 0, y: 0, width: 20, height: 20))
    return panel
  }
}

private final class ComputerUseCursorDotView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.systemBlue.withAlphaComponent(0.28).cgColor
    layer?.borderColor = NSColor.systemBlue.cgColor
    layer?.borderWidth = 2
    layer?.cornerRadius = 10
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }
}
