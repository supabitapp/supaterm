import AppKit
import CoreGraphics

@MainActor
final class ComputerUseCursorOverlay {
  private var window: ComputerUseCursorOverlayWindow?
  private var contentView: ComputerUseCursorOverlayView?
  private var hideTask: Task<Void, Never>?
  private var repinTask: Task<Void, Never>?
  private var activationObserver: NSObjectProtocol?
  private var pinResolver = ComputerUseCursorOverlayPinResolver()
  private var targetPid: pid_t?
  private var targetWindowID: UInt32 = 0
  private let visibleWindows: @MainActor () -> [ComputerUseCursorOverlayWindowSnapshot]

  init(
    visibleWindows: @escaping @MainActor () -> [ComputerUseCursorOverlayWindowSnapshot] =
      ComputerUseCursorOverlay.defaultVisibleWindows
  ) {
    self.visibleWindows = visibleWindows
  }

  func prepareClick(
    to point: CGPoint,
    enabled: Bool,
    targetPid: pid_t,
    targetWindowID: UInt32,
    focusFrame: CGRect?
  ) async -> ComputerUsePreparedCursor? {
    guard enabled else {
      await stop(.close)
      return nil
    }
    let panel = window ?? makeWindow()
    window = panel
    self.targetPid = targetPid
    self.targetWindowID = targetWindowID
    hideTask?.cancel()
    hideTask = nil
    pinResolver.resetMisses()
    ensureActivationObserver()
    startRepin()
    await reapplyPin()
    await contentView?.move(to: point, focusFrame: focusFrame)
    await reapplyPin()
    return .init()
  }

  func completeClick(_: ComputerUsePreparedCursor) async {
    guard window != nil else { return }
    await reapplyPin()
    contentView?.pulse()
    try? await Task.sleep(nanoseconds: 180_000_000)
    scheduleStop(after: 8, .hide(animated: true))
  }

  func cancelClick(_: ComputerUsePreparedCursor) {
    scheduleStop(after: 0.4, .hide(animated: true))
  }

  private func stop(_ reason: ComputerUseCursorOverlayStop) async {
    hideTask?.cancel()
    hideTask = nil
    repinTask?.cancel()
    repinTask = nil
    removeActivationObserver()
    targetPid = nil
    targetWindowID = 0
    pinResolver.resetMisses()
    if reason.isAnimated {
      await contentView?.hideCursor()
    }
    window?.orderOut(nil)
    if reason.closesWindow {
      window?.close()
      window = nil
      contentView = nil
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

  private func reapplyPin() async {
    guard let panel = window, let targetPid else { return }
    let decision = pinResolver.resolve(
      targetPid: targetPid,
      targetWindowID: targetWindowID,
      windows: visibleWindows()
    )
    if decision.shouldOrderFront {
      panel.orderFront(nil)
    } else if let windowID = decision.relativeWindowID {
      panel.order(.above, relativeTo: Int(windowID))
    } else if decision.shouldHide {
      await stop(.hide(animated: true))
    }
  }

  private func scheduleStop(after delay: TimeInterval, _ reason: ComputerUseCursorOverlayStop) {
    hideTask?.cancel()
    hideTask = Task { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
      guard !Task.isCancelled else { return }
      await self?.stop(reason)
    }
  }

  private func startRepin() {
    guard repinTask == nil else { return }
    repinTask = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: 33_000_000)
        guard let self, !Task.isCancelled, self.window != nil, self.targetPid != nil else { return }
        await self.reapplyPin()
      }
    }
  }

  private func ensureActivationObserver() {
    guard activationObserver == nil else { return }
    activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.didActivateApplicationNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      Task { @MainActor in
        await self?.reapplyPin()
      }
    }
  }

  private func removeActivationObserver() {
    if let activationObserver {
      NSWorkspace.shared.notificationCenter.removeObserver(activationObserver)
      self.activationObserver = nil
    }
  }

  private static func defaultVisibleWindows() -> [ComputerUseCursorOverlayWindowSnapshot] {
    guard
      let array = CGWindowListCopyWindowInfo(
        [.optionAll, .excludeDesktopElements],
        kCGNullWindowID
      )
        as? [[String: Any]]
    else {
      return []
    }
    let total = array.count
    return array.enumerated().compactMap { offset, dictionary in
      guard
        let windowNumber = dictionary[kCGWindowNumber as String] as? NSNumber,
        let pidNumber = dictionary[kCGWindowOwnerPID as String] as? NSNumber
      else {
        return nil
      }
      return .init(
        id: windowNumber.uint32Value,
        pid: pidNumber.intValue,
        isOnScreen: (dictionary[kCGWindowIsOnscreen as String] as? Bool) ?? true,
        zIndex: total - offset,
        layer: (dictionary[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
      )
    }
  }
}

struct ComputerUsePreparedCursor: Sendable {
  fileprivate init() {}
}

private enum ComputerUseCursorOverlayStop: Sendable {
  case hide(animated: Bool)
  case close

  var isAnimated: Bool {
    switch self {
    case .hide(let animated):
      return animated
    case .close:
      return false
    }
  }

  var closesWindow: Bool {
    switch self {
    case .hide:
      return false
    case .close:
      return true
    }
  }
}

struct ComputerUseCursorOverlayWindowSnapshot: Equatable {
  let id: UInt32
  let pid: Int
  let isOnScreen: Bool
  let zIndex: Int
  let layer: Int

  init(
    id: UInt32,
    pid: Int,
    isOnScreen: Bool = true,
    zIndex: Int = 0,
    layer: Int = 0
  ) {
    self.id = id
    self.pid = pid
    self.isOnScreen = isOnScreen
    self.zIndex = zIndex
    self.layer = layer
  }
}

struct ComputerUseCursorOverlayPinDecision: Equatable {
  let relativeWindowID: UInt32?
  let shouldOrderFront: Bool
  let shouldHide: Bool
}

struct ComputerUseCursorOverlayPinResolver {
  private var missedTargetCount = 0

  mutating func resetMisses() {
    missedTargetCount = 0
  }

  mutating func resolve(
    targetPid: pid_t,
    targetWindowID: UInt32,
    windows: [ComputerUseCursorOverlayWindowSnapshot]
  ) -> ComputerUseCursorOverlayPinDecision {
    if targetWindowID == 0 {
      missedTargetCount = 0
      return .init(relativeWindowID: nil, shouldOrderFront: true, shouldHide: false)
    }

    let visibleNormalWindows = windows.filter { $0.isOnScreen && $0.layer == 0 }
    let targetPid = Int(targetPid)
    if visibleNormalWindows.contains(where: { $0.id == targetWindowID && $0.pid == targetPid }) {
      missedTargetCount = 0
      return .init(relativeWindowID: targetWindowID, shouldOrderFront: false, shouldHide: false)
    }

    if let fallback =
      visibleNormalWindows
      .filter({ $0.pid == targetPid })
      .max(by: { $0.zIndex < $1.zIndex })
    {
      missedTargetCount = 0
      return .init(relativeWindowID: fallback.id, shouldOrderFront: false, shouldHide: false)
    }

    missedTargetCount += 1
    return .init(
      relativeWindowID: nil,
      shouldOrderFront: false,
      shouldHide: missedTargetCount >= 2
    )
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

  func move(to point: CGPoint, focusFrame: CGRect?) async {
    cursorView.isHidden = false
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
      try? await Task.sleep(nanoseconds: 220_000_000)
      return
    }
    await withCheckedContinuation { continuation in
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.22
        context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        cursorView.animator().setFrameOrigin(origin)
      } completionHandler: {
        continuation.resume()
      }
    }
  }

  func pulse() {
    cursorView.pulse()
  }

  func hideCursor() async {
    guard !cursorView.isHidden || !focusView.isHidden else { return }
    await withCheckedContinuation { continuation in
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.18
        cursorView.animator().alphaValue = 0
        focusView.animator().alphaValue = 0
      } completionHandler: {
        self.cursorView.isHidden = true
        self.focusView.isHidden = true
        self.cursorView.alphaValue = 1
        self.focusView.alphaValue = 1
        continuation.resume()
      }
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
