import AppKit

struct TerminalTabDesktopDropRouting {
  static func receiverFrame(
    for point: CGPoint,
    screenFrames: [CGRect],
    blockedFrames: [CGRect]
  ) -> CGRect? {
    guard !blockedFrames.contains(where: { $0.contains(point) }) else { return nil }
    return screenFrames.first { $0.contains(point) }
  }
}

struct TerminalTabNewWindowLayout {
  static func frame(
    previewFrame: CGRect,
    windowSize: CGSize,
    visibleFrame: CGRect
  ) -> CGRect {
    let frame = CGRect(
      x: previewFrame.midX - windowSize.width / 2,
      y: previewFrame.midY - windowSize.height / 2,
      width: windowSize.width,
      height: windowSize.height
    )
    return frame.constrained(to: visibleFrame)
  }
}

@MainActor
final class TerminalTabNewWindowDropController {
  private let destinationView: TerminalTabNewWindowDestinationView
  private let destinationWindow: TerminalTabNewWindowDestinationWindow
  private let tabDragRegistry: TerminalTabDragRegistry

  init(tabDragRegistry: TerminalTabDragRegistry) {
    self.tabDragRegistry = tabDragRegistry
    destinationView = TerminalTabNewWindowDestinationView(tabDragRegistry: tabDragRegistry)
    destinationWindow = TerminalTabNewWindowDestinationWindow(contentView: destinationView)
    tabDragRegistry.sessionMoved = { [weak self] payload, point in
      self?.route(payload: payload, point: point)
    }
    tabDragRegistry.sessionFinished = { [weak self] in
      self?.destinationWindow.orderOut(nil)
    }
  }

  func stop() {
    tabDragRegistry.sessionMoved = nil
    tabDragRegistry.sessionFinished = nil
    destinationWindow.orderOut(nil)
  }

  private func route(payload: TerminalTabDragPayload, point: CGPoint) {
    guard tabDragRegistry.activePayload == payload else {
      destinationWindow.orderOut(nil)
      return
    }
    let frame = TerminalTabDesktopDropRouting.receiverFrame(
      for: point,
      screenFrames: NSScreen.screens.map(\.frame),
      blockedFrames: appWindowFrames() + externalWindowFrames()
    )
    guard let frame else {
      destinationWindow.orderOut(nil)
      return
    }
    destinationWindow.setFrame(frame, display: false)
    destinationWindow.orderFrontRegardless()
  }

  private func appWindowFrames() -> [CGRect] {
    NSApp.windows.compactMap { window in
      guard
        window !== destinationWindow,
        window.isVisible,
        window.alphaValue > 0,
        !window.isMiniaturized,
        !window.ignoresMouseEvents
      else { return nil }
      return window.frame
    }
  }

  private func externalWindowFrames() -> [CGRect] {
    guard
      let windowInfo = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
      ) as? [[CFString: Any]]
    else { return [] }
    let ownProcessID = ProcessInfo.processInfo.processIdentifier
    let primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
    return windowInfo.compactMap { info in
      guard
        let ownerProcessID = info[kCGWindowOwnerPID] as? Int,
        ownerProcessID != ownProcessID,
        let alpha = info[kCGWindowAlpha] as? Double,
        alpha > 0,
        let layer = info[kCGWindowLayer] as? Int,
        layer <= 0,
        let bounds = info[kCGWindowBounds] as? [String: Any],
        let quartzFrame = CGRect(dictionaryRepresentation: bounds as CFDictionary)
      else { return nil }
      return CGRect(
        x: quartzFrame.minX,
        y: primaryTop - quartzFrame.maxY,
        width: quartzFrame.width,
        height: quartzFrame.height
      )
    }
  }
}

@MainActor
private final class TerminalTabNewWindowDestinationWindow: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }

  init(contentView: NSView) {
    super.init(
      contentRect: .zero,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.contentView = contentView
    hidesOnDeactivate = false
    isOpaque = false
    isFloatingPanel = true
    backgroundColor = .clear
    level = .floating
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    acceptsMouseMovedEvents = true
    ignoresMouseEvents = false
    hasShadow = false
  }
}

@MainActor
private final class TerminalTabNewWindowDestinationView: NSView {
  private let tabDragRegistry: TerminalTabDragRegistry

  init(tabDragRegistry: TerminalTabDragRegistry) {
    self.tabDragRegistry = tabDragRegistry
    super.init(frame: .zero)
    registerForDraggedTypes([.terminalTabDrag])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    tabDragRegistry.resolve(sender.draggingPasteboard) == nil ? [] : .move
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    draggingEntered(sender)
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return tabDragRegistry.resolve(sender.draggingPasteboard) != nil
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    guard let payload = tabDragRegistry.resolve(sender.draggingPasteboard) else { return false }
    return tabDragRegistry.performDetach(payload)
  }
}
