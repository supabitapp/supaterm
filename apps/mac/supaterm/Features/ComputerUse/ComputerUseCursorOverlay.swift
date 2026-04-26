import AppKit
import CoreGraphics

@MainActor
final class ComputerUseCursorOverlay {
  private var window: ComputerUseCursorOverlayWindow?
  private var contentView: ComputerUseCursorOverlayView?
  private var hideWorkItem: DispatchWorkItem?
  private var repinTimer: Timer?
  private var targetWindowID: UInt32 = 0

  func move(
    to point: CGPoint,
    enabled: Bool,
    targetWindowID: UInt32,
    focusFrame: CGRect?
  ) {
    guard enabled else {
      stop()
      return
    }
    let panel = window ?? makeWindow()
    window = panel
    self.targetWindowID = targetWindowID
    contentView?.move(to: point, focusFrame: focusFrame)
    pin(panel)
    scheduleHide()
    startRepin()
  }

  private func stop() {
    hideWorkItem?.cancel()
    hideWorkItem = nil
    repinTimer?.invalidate()
    repinTimer = nil
    window?.orderOut(nil)
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

  private func pin(_ panel: NSPanel) {
    if targetWindowID == 0 {
      panel.orderFront(nil)
    } else {
      panel.order(.above, relativeTo: Int(targetWindowID))
    }
  }

  private func scheduleHide() {
    hideWorkItem?.cancel()
    let item = DispatchWorkItem { [weak self] in
      Task { @MainActor in
        self?.contentView?.hideCursor()
      }
    }
    hideWorkItem = item
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.2, execute: item)
  }

  private func startRepin() {
    guard repinTimer == nil else { return }
    repinTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      Task { @MainActor in
        guard let self, let window = self.window, window.isVisible else { return }
        self.pin(window)
      }
    }
  }
}

private final class ComputerUseCursorOverlayWindow: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

private final class ComputerUseCursorOverlayView: NSView {
  private let cursorView = ComputerUseCursorArrowView(
    frame: .init(x: -100, y: -100, width: 34, height: 42)
  )
  private let focusView = ComputerUseFocusRectView(frame: .zero)
  private var hasPosition = false

  override var isFlipped: Bool { true }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    addSubview(focusView)
    addSubview(cursorView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  func move(to point: CGPoint, focusFrame: CGRect?) {
    cursorView.isHidden = false
    cursorView.pulse()
    let origin = CGPoint(x: point.x - 3, y: point.y - 2)
    if let focusFrame {
      focusView.isHidden = false
      focusView.frame = focusFrame.insetBy(dx: -4, dy: -4)
    } else {
      focusView.isHidden = true
    }
    guard hasPosition else {
      cursorView.setFrameOrigin(origin)
      hasPosition = true
      return
    }
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.22
      context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      cursorView.animator().setFrameOrigin(origin)
    }
  }

  func hideCursor() {
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.18
      cursorView.animator().alphaValue = 0
      focusView.animator().alphaValue = 0
    } completionHandler: {
      self.cursorView.isHidden = true
      self.focusView.isHidden = true
      self.cursorView.alphaValue = 1
      self.focusView.alphaValue = 1
    }
  }
}

private final class ComputerUseCursorArrowView: NSView {
  private let shape = CAShapeLayer()
  private let pulseLayer = CAShapeLayer()

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.addSublayer(pulseLayer)
    layer?.addSublayer(shape)
    pulseLayer.fillColor = NSColor.systemBlue.withAlphaComponent(0.18).cgColor
    shape.fillColor = NSColor.white.cgColor
    shape.strokeColor = NSColor.systemBlue.cgColor
    shape.lineWidth = 2
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  override func layout() {
    super.layout()
    let path = CGMutablePath()
    path.move(to: CGPoint(x: 2, y: 2))
    path.addLine(to: CGPoint(x: 2, y: 31))
    path.addLine(to: CGPoint(x: 11, y: 23))
    path.addLine(to: CGPoint(x: 17, y: 38))
    path.addLine(to: CGPoint(x: 24, y: 35))
    path.addLine(to: CGPoint(x: 18, y: 20))
    path.addLine(to: CGPoint(x: 31, y: 20))
    path.closeSubpath()
    shape.path = path
    pulseLayer.path = CGPath(ellipseIn: bounds.insetBy(dx: 1, dy: 3), transform: nil)
  }

  func pulse() {
    pulseLayer.removeAllAnimations()
    let scale = CABasicAnimation(keyPath: "transform.scale")
    scale.fromValue = 0.7
    scale.toValue = 1.25
    let opacity = CABasicAnimation(keyPath: "opacity")
    opacity.fromValue = 0.8
    opacity.toValue = 0
    let group = CAAnimationGroup()
    group.animations = [scale, opacity]
    group.duration = 0.32
    group.timingFunction = CAMediaTimingFunction(name: .easeOut)
    pulseLayer.add(group, forKey: "pulse")
  }
}

private final class ComputerUseFocusRectView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.borderColor = NSColor.systemBlue.withAlphaComponent(0.9).cgColor
    layer?.borderWidth = 2
    layer?.cornerRadius = 6
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }
}
