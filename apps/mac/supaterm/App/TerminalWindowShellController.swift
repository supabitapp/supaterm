import AppKit
import Observation
import QuartzCore
import SwiftUI

struct TerminalWindowShellPresentation: Equatable {
  let isSidebarCollapsed: Bool
  let sidebarResizeState: TerminalSidebarResizeState?
  let sidebarWidth: CGFloat?
}

enum TerminalSidebarShellPresentation: Equatable {
  case anchored
  case hidden
  case floating
}

struct TerminalWindowShellLayout: Equatable {
  let detailFrame: CGRect
  let revealFrame: CGRect
  let resizeFrame: CGRect
  let sidebarFrame: CGRect

  init(
    bounds: CGRect,
    presentation: TerminalSidebarShellPresentation,
    isRevealPointerInside: Bool = false,
    sidebarResizeState: TerminalSidebarResizeState?,
    sidebarWidth: CGFloat?
  ) {
    let sidebarWidth = TerminalSidebarWidthPolicy.displayedWidth(
      preferredWidth: sidebarWidth,
      resizeState: sidebarResizeState,
      totalWidth: bounds.width
    )
    let isDocked = presentation == .anchored
    let isFloating = presentation == .floating
    let detailMinX = isDocked ? sidebarWidth : 0
    let detailFrame = CGRect(
      x: detailMinX,
      y: bounds.minY,
      width: max(0, bounds.width - detailMinX),
      height: bounds.height
    )
    let sidebarFrame = CGRect(
      x: isDocked || isFloating
        ? bounds.minX
        : bounds.minX - sidebarWidth - TerminalSidebarRevealMetrics.activeOutsideWidth,
      y: bounds.minY,
      width: sidebarWidth,
      height: bounds.height
    )
    self.detailFrame = detailFrame
    self.sidebarFrame = sidebarFrame
    revealFrame =
      switch presentation {
      case .anchored:
        .zero
      case .hidden:
        CGRect(
          x: bounds.minX,
          y: bounds.minY,
          width: isRevealPointerInside
            ? TerminalSidebarRevealMetrics.activeInsideWidth
            : TerminalSidebarRevealMetrics.activationWidth,
          height: bounds.height
        )
      case .floating:
        CGRect(
          x: bounds.minX,
          y: bounds.minY,
          width: sidebarWidth + TerminalSidebarRevealMetrics.retentionWidth,
          height: bounds.height
        )
      }
    if isDocked {
      resizeFrame = Self.resizeFrame(
        endingAt: detailFrame.minX + TerminalChromeMetrics.paneInset,
        in: bounds
      )
    } else if isFloating {
      resizeFrame = Self.resizeFrame(endingAt: sidebarFrame.maxX, in: bounds)
    } else {
      resizeFrame = .zero
    }
  }

  private static func resizeFrame(endingAt proposedMaxX: CGFloat, in bounds: CGRect) -> CGRect {
    let maxX = min(max(proposedMaxX, bounds.minX), bounds.maxX)
    let minX = max(bounds.minX, maxX - TerminalSidebarWidthPolicy.interactionStripWidth)
    return CGRect(
      x: minX,
      y: bounds.minY,
      width: maxX - minX,
      height: max(0, bounds.height)
    )
  }
}

nonisolated enum TerminalTabDragCaptureLayout {
  static func frame(detailFrame: CGRect, sidebarFrame: CGRect?) -> CGRect {
    guard
      let sidebarFrame,
      sidebarFrame.minX <= detailFrame.minX,
      sidebarFrame.maxX > detailFrame.minX,
      sidebarFrame.minY <= detailFrame.minY,
      sidebarFrame.maxY >= detailFrame.maxY
    else { return detailFrame }
    let minX = min(sidebarFrame.maxX, detailFrame.maxX)
    return CGRect(
      x: minX,
      y: detailFrame.minY,
      width: detailFrame.maxX - minX,
      height: detailFrame.height
    )
  }
}

nonisolated enum TerminalTabSplitDropLayout {
  static func surfaceFrame(in detailFrame: CGRect) -> CGRect {
    let paneFrame = detailFrame.insetBy(
      dx: TerminalChromeMetrics.paneInset,
      dy: TerminalChromeMetrics.paneInset
    )
    return CGRect(
      x: paneFrame.minX,
      y: paneFrame.minY,
      width: max(0, paneFrame.width),
      height: max(0, paneFrame.height - TerminalChromeMetrics.detailToolbarHeight)
    )
  }
}

struct TerminalTabSplitDropDestination {
  let spaceID: TerminalSpaceID
  let tabID: TerminalTabID
  let color: Color
}

@MainActor
@Observable
final class TerminalWindowShellState {
  private(set) var isFloating = false

  func apply(presentation: TerminalWindowShellPresentation) {
    isFloating = presentation.isSidebarCollapsed
  }
}

nonisolated struct TerminalTabSplitDropCoordinator {
  struct Context: Equatable {
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
  }

  enum State: Equatable {
    case hidden
    case targeted(Context, TerminalSplitDropZone)
  }

  private(set) var state = State.hidden

  var canCommit: Bool {
    guard case .targeted = state else { return false }
    return true
  }

  mutating func update(context: Context, target: TerminalSplitDropZone) {
    let state = State.targeted(context, target)
    guard state != self.state else { return }
    self.state = state
  }

  mutating func hide() {
    guard state != .hidden else { return }
    state = .hidden
  }

  mutating func commit(
    perform: (Context, TerminalSplitDropZone) -> Bool
  ) -> Bool {
    guard case .targeted(let context, let zone) = state else { return false }
    let result = perform(context, zone)
    state = .hidden
    return result
  }
}

@MainActor
final class TerminalWindowShellView: NSView {
  var onRevealPointerEvent: ((TerminalSidebarRevealPointerEvent) -> Void)?
  var onDraggingUpdated: ((any NSDraggingInfo) -> NSDragOperation)?
  var onDraggingExited: (() -> Void)?
  var onDraggingEnded: (() -> Void)?
  var onPrepareForDragOperation: ((any NSDraggingInfo) -> Bool)?
  var onPerformDragOperation: ((any NSDraggingInfo) -> Bool)?
  private(set) var isPointerInsideRevealFrame = false
  private var frameObservers: [NSObjectProtocol] = []
  private weak var observedWindow: NSWindow?
  private var revealFrame = CGRect.zero
  private var revealTrackingArea: NSTrackingArea?

  nonisolated override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    updateWindowObservers()
  }

  func setRevealFrame(_ revealFrame: CGRect) {
    guard self.revealFrame != revealFrame else { return }
    self.revealFrame = revealFrame
    updateTrackingAreas()
    reconcilePointer(didMove: false)
  }

  override func updateTrackingAreas() {
    if let revealTrackingArea {
      removeTrackingArea(revealTrackingArea)
    }
    guard !revealFrame.isEmpty else {
      revealTrackingArea = nil
      setPointerInside(false, didMove: false)
      super.updateTrackingAreas()
      return
    }
    let revealTrackingArea = NSTrackingArea(
      rect: revealFrame,
      options: [.activeAlways, .mouseEnteredAndExited, .mouseMoved],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(revealTrackingArea)
    self.revealTrackingArea = revealTrackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    reconcilePointer(didMove: false)
  }

  override func mouseMoved(with event: NSEvent) {
    reconcilePointer(didMove: true)
  }

  override func mouseExited(with event: NSEvent) {
    reconcilePointer(didMove: false)
  }

  override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
    onDraggingUpdated?(sender) ?? []
  }

  override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
    onDraggingUpdated?(sender) ?? []
  }

  override func draggingExited(_ sender: (any NSDraggingInfo)?) {
    onDraggingExited?()
  }

  override func draggingEnded(_ sender: any NSDraggingInfo) {
    onDraggingEnded?()
  }

  override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    sender.animatesToDestination = false
    return onPrepareForDragOperation?(sender) == true
  }

  override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
    onPerformDragOperation?(sender) == true
  }

  private func updateWindowObservers() {
    if observedWindow === window {
      reconcilePointer(didMove: false)
      return
    }
    clearWindowObservers()
    observedWindow = window
    guard let window else {
      setPointerInside(false, didMove: false)
      return
    }
    let center = NotificationCenter.default
    for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
      frameObservers.append(
        center.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated {
            self?.reconcilePointer(didMove: true)
          }
        }
      )
    }
    reconcilePointer(didMove: false)
  }

  private func reconcilePointer(didMove: Bool) {
    guard let window, !revealFrame.isEmpty else {
      setPointerInside(false, didMove: didMove)
      return
    }
    let point = convert(window.mouseLocationOutsideOfEventStream, from: nil)
    let isInside = revealFrame.intersection(bounds).contains(point)
    setPointerInside(isInside, didMove: didMove)
  }

  private func setPointerInside(_ isInside: Bool, didMove: Bool) {
    let didChange = isInside != isPointerInsideRevealFrame
    isPointerInsideRevealFrame = isInside
    if didChange {
      onRevealPointerEvent?(isInside ? .entered : .exited)
    } else if didMove, isInside {
      onRevealPointerEvent?(.moved)
    }
  }

  private func clearWindowObservers() {
    let center = NotificationCenter.default
    for observer in frameObservers {
      center.removeObserver(observer)
    }
    frameObservers.removeAll()
  }

  isolated deinit {
    clearWindowObservers()
  }
}

@MainActor
final class TerminalWindowShellController: NSViewController {
  private enum FrameMotion: Equatable {
    case immediate
    case sidebar
    case floating
  }

  private enum FrameProperty: CaseIterable {
    case position
    case bounds

    var animationKey: String {
      switch self {
      case .position: "windowShellPosition"
      case .bounds: "windowShellBounds"
      }
    }

    var keyPath: String {
      switch self {
      case .position: "position"
      case .bounds: "bounds"
      }
    }
  }

  private(set) lazy var sidebarControllerCache: TerminalSidebarControllerCache = {
    let cache = TerminalSidebarControllerCache(
      windowControllerID: windowControllerID,
      tabDragRegistry: tabDragRegistry,
      captureRequest: { [weak self] in self?.tabDragCaptureRequest() }
    )
    cache.hoverCardRetentionChanged = { [weak self] in
      self?.revealCoordinator.releaseRetention()
    }
    return cache
  }()
  let state = TerminalWindowShellState()
  private let sidebarResizeView = SidebarResizeInteractionNSView()
  var onSidebarResizeInput: ((TerminalSidebarResizeInput) -> Void)? {
    get { sidebarResizeView.onInput }
    set { sidebarResizeView.onInput = newValue }
  }
  var isSpacePaging: () -> Bool = { false }
  var splitDestination: () -> TerminalTabSplitDropDestination? = { nil }

  private var detailController: NSViewController?
  private var presentation = TerminalWindowShellPresentation(
    isSidebarCollapsed: false,
    sidebarResizeState: nil,
    sidebarWidth: nil
  )
  private let revealCoordinator: TerminalSidebarRevealCoordinator
  private var sidebarController: NSViewController?
  private let splitDropOverlay = TerminalTabSplitDropOverlayView()
  private var splitDropCoordinator = TerminalTabSplitDropCoordinator()
  private let reduceMotion: () -> Bool
  private let tabDragRegistry: TerminalTabDragRegistry
  private let windowControllerID: UUID

  private var currentLayout: TerminalWindowShellLayout {
    TerminalWindowShellLayout(
      bounds: view.bounds,
      presentation: sidebarPresentation,
      isRevealPointerInside: isRevealPointerInside,
      sidebarResizeState: presentation.sidebarResizeState,
      sidebarWidth: presentation.sidebarWidth
    )
  }

  private var sidebarPresentation: TerminalSidebarShellPresentation {
    guard presentation.isSidebarCollapsed else { return .anchored }
    return revealCoordinator.isVisible ? .floating : .hidden
  }

  private var isRevealPointerInside: Bool {
    (view as? TerminalWindowShellView)?.isPointerInsideRevealFrame == true
  }

  init(
    windowControllerID: UUID,
    tabDragRegistry: TerminalTabDragRegistry,
    reduceMotion: @escaping () -> Bool = {
      NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    },
    revealSleep: @escaping TerminalSidebarRevealCoordinator.Sleep = {
      try await Task.sleep(for: $0)
    }
  ) {
    self.reduceMotion = reduceMotion
    revealCoordinator = TerminalSidebarRevealCoordinator(sleep: revealSleep)
    self.tabDragRegistry = tabDragRegistry
    self.windowControllerID = windowControllerID
    super.init(nibName: nil, bundle: nil)
    revealCoordinator.isPointerInside = { [weak self] in
      self?.isRevealPointerInside == true
    }
    revealCoordinator.isRetained = { [weak self] in
      guard let self else { return false }
      return isSpacePaging() || sidebarControllerCache.isHoverCardPresented
    }
    revealCoordinator.onVisibilityChange = { [weak self] in
      self?.applyRevealVisibilityChange()
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func loadView() {
    let shellView = TerminalWindowShellView()
    shellView.onRevealPointerEvent = { [weak self] event in
      self?.revealPointerChanged(event)
    }
    shellView.onDraggingUpdated = { [weak self] in
      self?.draggingUpdated($0) ?? []
    }
    shellView.onDraggingExited = { [weak self] in
      self?.dragDestinationExited()
    }
    shellView.onDraggingEnded = { [weak self] in
      self?.dragDestinationEnded()
    }
    shellView.onPrepareForDragOperation = { [weak self] in
      self?.prepareForDragOperation($0) == true
    }
    shellView.onPerformDragOperation = { [weak self] in
      self?.performDragOperation($0) == true
    }
    shellView.registerForDraggedTypes([.terminalTabDrag])
    view = shellView
  }

  override func viewDidLayout() {
    super.viewDidLayout()
    guard let sidebarController, let detailController else { return }
    let layout = currentLayout
    guard
      sidebarController.view.frame != layout.sidebarFrame
        || detailController.view.frame != layout.detailFrame
        || sidebarResizeView.frame != layout.resizeFrame
    else { return }
    applyLayout(motion: .immediate)
  }

  func install(
    background: NSViewController,
    sidebar: NSViewController,
    detail: NSViewController,
    dialogOverlay: NSViewController? = nil
  ) {
    precondition(sidebarController == nil && detailController == nil)
    sidebar.view.wantsLayer = true
    detail.view.wantsLayer = true
    addChild(background)
    background.view.frame = view.bounds
    background.view.autoresizingMask = [.width, .height]
    view.addSubview(background.view)
    addChild(detail)
    view.addSubview(detail.view)
    view.addSubview(splitDropOverlay)
    addChild(sidebar)
    view.addSubview(sidebar.view)
    view.addSubview(sidebarResizeView)
    if let dialogOverlay {
      addChild(dialogOverlay)
      dialogOverlay.view.frame = view.bounds
      dialogOverlay.view.autoresizingMask = [.width, .height]
      view.addSubview(dialogOverlay.view)
    }
    sidebarController = sidebar
    detailController = detail
    applyLayout(motion: .immediate)
  }

  func apply(_ presentation: TerminalWindowShellPresentation) {
    guard presentation != self.presentation else { return }
    let motion = frameMotion(from: self.presentation, to: presentation)
    let collapseChanged = presentation.isSidebarCollapsed != self.presentation.isSidebarCollapsed
    self.presentation = presentation
    if collapseChanged {
      revealCoordinator.reset()
    }
    applyLayout(motion: motion)
  }

  func spacePagingDidEnd() {
    guard presentation.isSidebarCollapsed else { return }
    revealCoordinator.releaseRetention()
  }

  func tabDragCaptureRequest() -> TerminalWindowCaptureRequest? {
    guard
      let sourceView = detailController?.view,
      !sourceView.bounds.isEmpty,
      let window = sourceView.window,
      window.windowNumber > 0
    else { return nil }
    let detailFrame = sourceView.convert(sourceView.bounds, to: view)
    let sidebarFrame = sidebarController.map {
      $0.view.convert($0.view.bounds, to: view)
    }
    let captureFrame = TerminalTabDragCaptureLayout.frame(
      detailFrame: detailFrame,
      sidebarFrame: sidebarFrame
    )
    guard !captureFrame.isEmpty else { return nil }
    let viewScreenFrame = window.convertToScreen(view.convert(captureFrame, to: nil))
    return TerminalWindowCaptureRequest(
      windowID: CGWindowID(window.windowNumber),
      geometry: TerminalWindowCaptureGeometry(
        windowFrame: window.frame,
        viewScreenFrame: viewScreenFrame,
        backingScaleFactor: window.backingScaleFactor
      )
    )
  }

  private func applyLayout(motion: FrameMotion) {
    guard let sidebarController, let detailController else { return }
    let layout = currentLayout
    let sidebarPresentation = sidebarPresentation
    state.apply(presentation: presentation)
    sidebarController.view.setAccessibilityHidden(
      sidebarPresentation == .hidden
    )
    (view as? TerminalWindowShellView)?.setRevealFrame(layout.revealFrame)
    setSidebarFrame(
      layout.sidebarFrame,
      of: sidebarController.view,
      motion: motion,
      hidesSidebar: sidebarPresentation == .hidden
    )
    setFrame(layout.detailFrame, of: detailController.view, motion: motion)
    splitDropOverlay.frame = TerminalTabSplitDropLayout.surfaceFrame(in: layout.detailFrame)
    sidebarResizeView.sidebarWidth = layout.sidebarFrame.width
    setFrame(layout.resizeFrame, of: sidebarResizeView, motion: .immediate)
    sidebarResizeView.isHidden = layout.resizeFrame.isEmpty
    sidebarResizeView.setAccessibilityHidden(layout.resizeFrame.isEmpty)
  }

  private func setSidebarFrame(
    _ frame: CGRect,
    of sidebarView: NSView,
    motion: FrameMotion,
    hidesSidebar: Bool
  ) {
    sidebarView.isHidden = false
    guard hidesSidebar else {
      setFrame(frame, of: sidebarView, motion: motion)
      return
    }
    guard motion != .immediate, view.window != nil, sidebarView.layer != nil else {
      setFrame(frame, of: sidebarView, motion: motion)
      sidebarView.isHidden = true
      return
    }
    CATransaction.begin()
    CATransaction.setCompletionBlock { [weak self, weak sidebarView] in
      Task { @MainActor in
        guard
          let self,
          self.sidebarPresentation == .hidden
        else { return }
        sidebarView?.isHidden = true
      }
    }
    setFrame(frame, of: sidebarView, motion: motion)
    CATransaction.commit()
  }

  private func frameMotion(
    from current: TerminalWindowShellPresentation,
    to next: TerminalWindowShellPresentation
  ) -> FrameMotion {
    guard
      !reduceMotion(),
      !view.inLiveResize,
      current.sidebarResizeState == nil,
      next.sidebarResizeState == nil
    else { return .immediate }
    if current.isSidebarCollapsed != next.isSidebarCollapsed {
      return .sidebar
    }
    return .immediate
  }

  private func setFrame(_ frame: CGRect, of childView: NSView, motion: FrameMotion) {
    guard motion != .immediate, view.window != nil, let layer = childView.layer else {
      removeFrameAnimations(from: childView.layer)
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      childView.frame = frame
      childView.layoutSubtreeIfNeeded()
      CATransaction.commit()
      return
    }
    let modelPosition = layer.position
    let modelBounds = layer.bounds
    let oldPosition = layer.presentation()?.position ?? layer.position
    let oldBounds = layer.presentation()?.bounds ?? layer.bounds
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    childView.frame = frame
    childView.layoutSubtreeIfNeeded()
    CATransaction.commit()
    if modelPosition != layer.position {
      addFrameAnimation(
        to: layer,
        property: .position,
        from: NSValue(point: oldPosition),
        to: NSValue(point: layer.position),
        motion: motion
      )
    }
    if modelBounds != layer.bounds {
      addFrameAnimation(
        to: layer,
        property: .bounds,
        from: NSValue(rect: oldBounds),
        to: NSValue(rect: layer.bounds),
        motion: motion
      )
    }
  }

  private func addFrameAnimation(
    to layer: CALayer,
    property: FrameProperty,
    from: NSValue,
    to: NSValue,
    motion: FrameMotion
  ) {
    guard !from.isEqual(to) else {
      layer.removeAnimation(forKey: property.animationKey)
      return
    }
    let animation: CABasicAnimation
    switch motion {
    case .immediate:
      layer.removeAnimation(forKey: property.animationKey)
      return
    case .sidebar:
      animation = TerminalLayerAnimation.spring(
        keyPath: property.keyPath,
        from: from,
        to: to,
        spring: TerminalLayerSpring(response: 0.2, dampingRatio: 1)
      )
    case .floating:
      animation = TerminalLayerAnimation.basic(
        keyPath: property.keyPath,
        from: from,
        to: to,
        duration: 0.1,
        timingFunction: CAMediaTimingFunction(name: .easeOut)
      )
    }
    layer.add(animation, forKey: property.animationKey)
  }

  private func removeFrameAnimations(from layer: CALayer?) {
    guard let layer else { return }
    for property in FrameProperty.allCases {
      layer.removeAnimation(forKey: property.animationKey)
    }
  }

  private func revealPointerChanged(_ event: TerminalSidebarRevealPointerEvent) {
    guard presentation.isSidebarCollapsed else { return }
    revealCoordinator.handle(event)
    if sidebarPresentation == .hidden {
      (view as? TerminalWindowShellView)?.setRevealFrame(currentLayout.revealFrame)
    }
  }

  private func applyRevealVisibilityChange() {
    guard presentation.isSidebarCollapsed else { return }
    let motion: FrameMotion =
      reduceMotion() || view.inLiveResize || presentation.sidebarResizeState != nil
      ? .immediate
      : .floating
    applyLayout(motion: motion)
  }

  private func draggingUpdated(_ info: any NSDraggingInfo) -> NSDragOperation {
    guard
      let payload = tabDragRegistry.resolve(info.draggingPasteboard)
    else {
      dragDestinationExited()
      return []
    }
    let location = view.convert(info.draggingLocation, from: nil)
    let surfaceFrame = TerminalTabSplitDropLayout.surfaceFrame(in: currentLayout.detailFrame)
    guard surfaceFrame.contains(location) else {
      dragDestinationExited()
      return []
    }
    guard payload.singleTabID != nil else {
      dragDestinationExited()
      return []
    }
    tabDragRegistry.consumeSplitDestinationEntryAction(for: payload)
    guard let destination = splitDestination() else {
      dragDestinationExited()
      return []
    }
    let overlayPoint = splitDropOverlay.convert(location, from: view)
    let target = splitDropOverlay.target(at: overlayPoint)
    let context = TerminalTabSplitDropCoordinator.Context(
      spaceID: destination.spaceID,
      tabID: destination.tabID
    )
    let registryDestination = TerminalTabDragRegistry.SplitDestination(
      windowControllerID: windowControllerID,
      spaceID: destination.spaceID,
      tabID: destination.tabID,
      zone: target
    )
    tabDragRegistry.setSplitDestination(payload, destination: registryDestination)
    splitDropCoordinator.update(context: context, target: target)
    splitDropOverlay.render(target, color: destination.color)
    info.numberOfValidItemsForDrop = 1
    return .move
  }

  private func prepareForDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard tabDragRegistry.resolve(info.draggingPasteboard) != nil else { return false }
    return splitDropCoordinator.canCommit
  }

  private func performDragOperation(_ info: any NSDraggingInfo) -> Bool {
    guard let payload = tabDragRegistry.resolve(info.draggingPasteboard) else { return false }
    guard splitDropCoordinator.canCommit else { return false }
    let tabDragRegistry = tabDragRegistry
    let windowControllerID = windowControllerID
    let didSplit = splitDropCoordinator.commit { context, zone in
      tabDragRegistry.performSplit(
        payload,
        to: TerminalTabDragRegistry.SplitDestination(
          windowControllerID: windowControllerID,
          spaceID: context.spaceID,
          tabID: context.tabID,
          zone: zone
        )
      )
    }
    resetSplitDrop()
    return didSplit
  }

  private func dragDestinationExited() {
    if let payload = tabDragRegistry.activePayload {
      tabDragRegistry.clearSplitDestination(payload, windowControllerID: windowControllerID)
    }
    resetSplitDrop()
  }

  private func dragDestinationEnded() {
    resetSplitDrop()
  }

  private func resetSplitDrop() {
    splitDropCoordinator.hide()
    splitDropOverlay.hide()
  }
}
