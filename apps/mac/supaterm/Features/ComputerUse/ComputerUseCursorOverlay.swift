import AppKit
import CoreGraphics
import SupatermCLIShared

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
  private var alwaysFloat = false
  private var motion = SupatermComputerUseCursorMotion.default
  private var visibilityGeneration = 0
  private let visibleWindows: @MainActor () -> [ComputerUseCursorOverlayWindowSnapshot]

  init(
    visibleWindows: @escaping @MainActor () -> [ComputerUseCursorOverlayWindowSnapshot] =
      ComputerUseCursorOverlay.defaultVisibleWindows
  ) {
    self.visibleWindows = visibleWindows
  }

  func prepareClick(_ request: ComputerUseCursorOverlayClickRequest) async
    -> ComputerUsePreparedCursor?
  {
    guard request.enabled else {
      await stop(.close)
      return nil
    }
    let panel = window ?? makeWindow()
    window = panel
    alwaysFloat = request.alwaysFloat
    motion = request.motion
    panel.level = request.alwaysFloat ? .floating : .normal
    if request.alwaysFloat, !panel.isVisible {
      panel.orderFrontRegardless()
    }
    targetPid = request.targetPid
    targetWindowID = request.targetWindowID
    visibilityGeneration += 1
    hideTask?.cancel()
    hideTask = nil
    pinResolver.resetMisses()
    ensureActivationObserver()
    startRepin()
    await reapplyPin()
    await contentView?.move(
      to: request.point,
      tooltip: ComputerUseCursorOverlayTooltip(appName: appName(for: request.targetPid), activity: request.activity),
      motion: request.motion
    )
    await reapplyPin()
    return ComputerUsePreparedCursor()
  }

  func completeClick(_: ComputerUsePreparedCursor) async {
    guard window != nil else { return }
    await reapplyPin()
    if motion.dwellAfterClickMilliseconds > 0 {
      try? await Task.sleep(nanoseconds: UInt64(max(0, motion.dwellAfterClickMilliseconds)) * 1_000_000)
    }
    scheduleStop(after: Double(max(0, motion.idleHideMilliseconds)) / 1000, .hide(animated: true))
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
    alwaysFloat = false
    motion = .default
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
    let view = ComputerUseCursorOverlayView(frame: NSRect(origin: .zero, size: frame.size))
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
      if alwaysFloat {
        panel.orderFrontRegardless()
      } else {
        panel.orderFront(nil)
      }
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

  private func appName(for pid: pid_t) -> String {
    if let app = NSRunningApplication(processIdentifier: pid) {
      return app.localizedName ?? app.bundleIdentifier ?? "pid \(pid)"
    }
    return "pid \(pid)"
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
      return ComputerUseCursorOverlayWindowSnapshot(
        id: windowNumber.uint32Value,
        pid: pidNumber.intValue,
        isOnScreen: (dictionary[kCGWindowIsOnscreen as String] as? Bool) ?? true,
        zIndex: total - offset,
        layer: (dictionary[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
      )
    }
  }
}

struct ComputerUseCursorOverlayClickRequest: Sendable {
  let point: CGPoint
  let enabled: Bool
  let alwaysFloat: Bool
  let activity: String
  let targetPid: pid_t
  let targetWindowID: UInt32
  let motion: SupatermComputerUseCursorMotion
}

struct ComputerUseCursorOverlayTooltip: Equatable, Sendable {
  let appName: String
  let activity: String

  var isVisible: Bool {
    !appName.isEmpty || !activity.isEmpty
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
      return ComputerUseCursorOverlayPinDecision(relativeWindowID: nil, shouldOrderFront: true, shouldHide: false)
    }

    let visibleNormalWindows = windows.filter { $0.isOnScreen && $0.layer == 0 }
    let targetPid = Int(targetPid)
    if visibleNormalWindows.contains(where: { $0.id == targetWindowID && $0.pid == targetPid }) {
      missedTargetCount = 0
      return ComputerUseCursorOverlayPinDecision(relativeWindowID: targetWindowID, shouldOrderFront: false, shouldHide: false)
    }

    if let fallback =
      visibleNormalWindows
      .filter({ $0.pid == targetPid })
      .max(by: { $0.zIndex < $1.zIndex })
    {
      missedTargetCount = 0
      return ComputerUseCursorOverlayPinDecision(relativeWindowID: fallback.id, shouldOrderFront: false, shouldHide: false)
    }

    missedTargetCount += 1
    return ComputerUseCursorOverlayPinDecision(
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
  private let cursorView = ComputerUseCursorSymbolView(
    frame: NSRect(origin: NSPoint(x: -100, y: -100), size: ComputerUseCursorSymbolView.size)
  )
  private let tooltipView = ComputerUseCursorTooltipView(frame: .zero)
  private var hasPosition = false

  override var isFlipped: Bool { true }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    addSubview(cursorView)
    addSubview(tooltipView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  func move(
    to point: CGPoint,
    tooltip: ComputerUseCursorOverlayTooltip,
    motion: SupatermComputerUseCursorMotion
  ) async {
    cursorView.layer?.removeAllAnimations()
    tooltipView.layer?.removeAllAnimations()
    cursorView.alphaValue = 1
    tooltipView.alphaValue = 1
    cursorView.isHidden = false
    tooltipView.isHidden = !tooltip.isVisible
    tooltipView.update(tooltip)
    let cursorFrame = CGRect(origin: point, size: ComputerUseCursorSymbolView.size)
    let targetTooltipOrigin = tooltipOrigin(for: cursorFrame, size: tooltipView.frame.size)
    guard hasPosition else {
      cursorView.setFrameOrigin(point)
      tooltipView.setFrameOrigin(targetTooltipOrigin)
      hasPosition = true
      try? await Task.sleep(nanoseconds: UInt64(max(0, motion.glideDurationMilliseconds)) * 1_000_000)
      return
    }
    let start = cursorView.frame.origin
    let duration = max(0, motion.glideDurationMilliseconds)
    let frames = max(1, Int((Double(duration) / 1000) * 60))
    for frame in 1...frames {
      let progress = Double(frame) / Double(frames)
      let eased = cursorProgress(progress, spring: motion.spring)
      let next = cursorPoint(from: start, to: point, progress: eased, motion: motion)
      cursorView.setFrameOrigin(next)
      let cursorFrame = CGRect(origin: next, size: ComputerUseCursorSymbolView.size)
      tooltipView.setFrameOrigin(tooltipOrigin(for: cursorFrame, size: tooltipView.frame.size))
      if duration > 0 {
        try? await Task.sleep(nanoseconds: UInt64(duration) * 1_000_000 / UInt64(frames))
      }
    }
    cursorView.setFrameOrigin(point)
    tooltipView.setFrameOrigin(targetTooltipOrigin)
  }

  func hideCursor(isCurrent: @MainActor () -> Bool) async {
    guard !cursorView.isHidden else { return }
    await NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.18
      cursorView.animator().alphaValue = 0
      tooltipView.animator().alphaValue = 0
    }
    guard isCurrent() else { return }
    cursorView.isHidden = true
    tooltipView.isHidden = true
    cursorView.alphaValue = 1
    tooltipView.alphaValue = 1
  }

  private func tooltipOrigin(for cursorFrame: CGRect, size: CGSize) -> CGPoint {
    let margin: CGFloat = 8
    let spacing: CGFloat = 8
    let maxX = max(bounds.maxX, size.width + margin * 2)
    let maxY = max(bounds.maxY, size.height + margin * 2)
    var x = cursorFrame.maxX + spacing
    var y = cursorFrame.minY

    if x + size.width + margin > maxX {
      x = cursorFrame.minX - size.width - spacing
    }

    x = min(max(margin, x), max(margin, maxX - size.width - margin))
    y = min(max(margin, y), max(margin, maxY - size.height - margin))
    return CGPoint(x: x, y: y)
  }

  private func cursorPoint(
    from start: CGPoint,
    to end: CGPoint,
    progress: Double,
    motion: SupatermComputerUseCursorMotion
  ) -> CGPoint {
    let dx = end.x - start.x
    let dy = end.y - start.y
    let length = max(1, hypot(dx, dy))
    let normal = CGPoint(x: -dy / length, y: dx / length)
    let arc = CGFloat(motion.arcSize * motion.arcFlow)
    let startHandle = CGFloat(motion.startHandle)
    let endHandle = CGFloat(motion.endHandle)
    let c1 = CGPoint(
      x: start.x + dx * startHandle + normal.x * arc,
      y: start.y + dy * startHandle + normal.y * arc
    )
    let c2 = CGPoint(
      x: start.x + dx * endHandle + normal.x * arc,
      y: start.y + dy * endHandle + normal.y * arc
    )
    let t = CGFloat(progress)
    let mt = 1 - t
    return CGPoint(
      x: mt * mt * mt * start.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * end.x,
      y: mt * mt * mt * start.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * end.y
    )
  }

  private func cursorProgress(_ progress: Double, spring: Double) -> Double {
    let eased = 0.5 - cos(progress * .pi) / 2
    guard spring > 0 else { return eased }
    let overshoot = sin(progress * .pi) * spring * (1 - progress)
    return min(1.12, max(0, eased + overshoot))
  }
}

private final class ComputerUseCursorSymbolView: NSView {
  static let size = CGSize(width: 28, height: 28)

  private let imageView = NSImageView(
    frame: NSRect(origin: .zero, size: ComputerUseCursorSymbolView.size)
  )

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.9)
    shadow.shadowOffset = .zero
    shadow.shadowBlurRadius = 1.6
    let image = NSImage(named: Self.assetName)
    image?.isTemplate = true
    imageView.image = image
    imageView.contentTintColor = Self.tintColor
    imageView.imageAlignment = .alignTopLeft
    imageView.imageScaling = .scaleProportionallyUpOrDown
    imageView.shadow = shadow
    addSubview(imageView)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  private static let assetName = "ComputerUseCursorMagicSelection"
  private static let tintColor = NSColor(
    srgbRed: 229 / 255,
    green: 77 / 255,
    blue: 46 / 255,
    alpha: 1
  )
}

private final class ComputerUseCursorTooltipView: NSView {
  private static let horizontalPadding: CGFloat = 10
  private static let verticalPadding: CGFloat = 7
  private static let lineSpacing: CGFloat = 2
  private static let maxWidth: CGFloat = 260
  private static let minWidth: CGFloat = 104
  private static let titleFont = NSFont.systemFont(ofSize: 12, weight: .semibold)
  private static let detailFont = NSFont.systemFont(ofSize: 11, weight: .regular)

  private let titleField = NSTextField(labelWithString: "")
  private let detailField = NSTextField(labelWithString: "")

  override var isFlipped: Bool { true }

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.withAlphaComponent(0.78).cgColor
    layer?.borderColor = NSColor.white.withAlphaComponent(0.16).cgColor
    layer?.borderWidth = 1
    layer?.cornerRadius = 7
    isHidden = true
    setupLabel(titleField, font: Self.titleFont, color: .white)
    setupLabel(detailField, font: Self.detailFont, color: NSColor.white.withAlphaComponent(0.78))
    addSubview(titleField)
    addSubview(detailField)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  func update(_ tooltip: ComputerUseCursorOverlayTooltip) {
    titleField.stringValue = tooltip.appName
    detailField.stringValue = tooltip.activity
    detailField.isHidden = tooltip.activity.isEmpty
    setFrameSize(size(for: tooltip))
    needsLayout = true
  }

  override func layout() {
    super.layout()
    let inset = Self.horizontalPadding
    let titleHeight = Self.titleFont.ascender - Self.titleFont.descender + 1
    let detailHeight = Self.detailFont.ascender - Self.detailFont.descender + 1
    let availableWidth = max(0, bounds.width - inset * 2)
    titleField.frame = NSRect(
      x: inset,
      y: Self.verticalPadding,
      width: availableWidth,
      height: titleHeight
    )
    detailField.frame = NSRect(
      x: inset,
      y: Self.verticalPadding + titleHeight + Self.lineSpacing,
      width: availableWidth,
      height: detailHeight
    )
  }

  private func setupLabel(_ label: NSTextField, font: NSFont, color: NSColor) {
    label.font = font
    label.textColor = color
    label.lineBreakMode = .byTruncatingTail
    label.maximumNumberOfLines = 1
  }

  private func size(for tooltip: ComputerUseCursorOverlayTooltip) -> CGSize {
    let titleWidth = textWidth(tooltip.appName, font: Self.titleFont)
    let detailWidth = textWidth(tooltip.activity, font: Self.detailFont)
    let textWidth = max(titleWidth, detailWidth)
    let width = min(
      Self.maxWidth,
      max(Self.minWidth, ceil(textWidth + Self.horizontalPadding * 2))
    )
    let titleHeight = Self.titleFont.ascender - Self.titleFont.descender + 1
    let detailHeight =
      tooltip.activity.isEmpty
      ? 0
      : Self.lineSpacing + Self.detailFont.ascender - Self.detailFont.descender + 1
    let height = ceil(Self.verticalPadding * 2 + titleHeight + detailHeight)
    return CGSize(width: width, height: height)
  }

  private func textWidth(_ text: String, font: NSFont) -> CGFloat {
    guard !text.isEmpty else { return 0 }
    return (text as NSString).size(withAttributes: [.font: font]).width
  }
}
