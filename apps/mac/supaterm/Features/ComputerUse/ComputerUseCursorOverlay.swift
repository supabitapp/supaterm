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
  private var visibilityGeneration = 0
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
    targetWindowID: UInt32
  ) async -> ComputerUsePreparedCursor? {
    guard enabled else {
      await stop(.close)
      return nil
    }
    let panel = window ?? makeWindow()
    window = panel
    self.targetPid = targetPid
    self.targetWindowID = targetWindowID
    visibilityGeneration += 1
    hideTask?.cancel()
    hideTask = nil
    pinResolver.resetMisses()
    ensureActivationObserver()
    startRepin()
    await reapplyPin()
    await contentView?.move(to: point)
    await reapplyPin()
    return .init()
  }

  func completeClick(_: ComputerUsePreparedCursor) async {
    guard window != nil else { return }
    await reapplyPin()
    scheduleStop(after: 8, .hide(animated: true))
  }

  func cancelClick(_: ComputerUsePreparedCursor) {
    scheduleStop(after: 0.4, .hide(animated: true))
  }

  private func stop(_ reason: ComputerUseCursorOverlayStop) async {
    let generation = visibilityGeneration
    hideTask?.cancel()
    hideTask = nil
    repinTask?.cancel()
    repinTask = nil
    removeActivationObserver()
    targetPid = nil
    targetWindowID = 0
    pinResolver.resetMisses()
    if reason.isAnimated {
      await contentView?.hideCursor {
        generation == visibilityGeneration
      }
      guard generation == visibilityGeneration else { return }
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
  private let dotView = ComputerUseCursorDotView(
    frame: .init(x: -100, y: -100, width: 20, height: 20)
  )
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

  func move(to point: CGPoint) async {
    dotView.layer?.removeAllAnimations()
    dotView.alphaValue = 1
    dotView.isHidden = false
    let origin = CGPoint(x: point.x - 10, y: point.y - 10)
    guard hasPosition else {
      dotView.setFrameOrigin(origin)
      hasPosition = true
      try? await Task.sleep(nanoseconds: 220_000_000)
      return
    }
    await withCheckedContinuation { continuation in
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.22
        context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        dotView.animator().setFrameOrigin(origin)
      } completionHandler: {
        continuation.resume()
      }
    }
  }

  func hideCursor(isCurrent: @MainActor () -> Bool) async {
    guard !dotView.isHidden else { return }
    await NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.18
      dotView.animator().alphaValue = 0
    }
    guard isCurrent() else { return }
    dotView.isHidden = true
    dotView.alphaValue = 1
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
