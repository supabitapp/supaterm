import AppKit
import CoreGraphics

@MainActor
final class ComputerUseCursorOverlay {
  private var window: ComputerUseCursorOverlayWindow?
  private var contentView: ComputerUseCursorOverlayView?

  func move(to point: CGPoint, enabled: Bool, targetWindowID: UInt32) {
    guard enabled else {
      window?.orderOut(nil)
      return
    }
    let panel = window ?? makeWindow()
    window = panel
    contentView?.move(to: point)
    if targetWindowID == 0 {
      panel.orderFront(nil)
    } else {
      panel.order(.above, relativeTo: Int(targetWindowID))
    }
  }

  private func makeWindow() -> ComputerUseCursorOverlayWindow {
    let frame = NSScreen.main?.frame ?? NSScreen.screens.first?.frame ?? .zero
    let panel = ComputerUseCursorOverlayWindow(
      contentRect: frame,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.backgroundColor = .clear
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.hasShadow = false
    panel.hidesOnDeactivate = false
    panel.ignoresMouseEvents = true
    panel.isOpaque = false
    panel.isReleasedWhenClosed = false
    panel.level = .normal
    let view = ComputerUseCursorOverlayView(frame: .init(origin: .zero, size: frame.size))
    contentView = view
    panel.contentView = view
    return panel
  }
}

private final class ComputerUseCursorOverlayWindow: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

private final class ComputerUseCursorOverlayView: NSView {
  private let dotView = ComputerUseCursorDotView(
    frame: .init(x: -100, y: -100, width: 20, height: 20))
  private var hasPosition = false

  override var isFlipped: Bool { true }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    addSubview(dotView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  func move(to point: CGPoint) {
    let origin = CGPoint(x: point.x - 10, y: point.y - 10)
    guard hasPosition else {
      dotView.setFrameOrigin(origin)
      hasPosition = true
      return
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.32
      context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      dotView.animator().setFrameOrigin(origin)
    }
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
