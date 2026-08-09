import AppKit
import Observation
import QuartzCore

struct TerminalWindowShellPresentation: Equatable {
  let isFloatingSidebarVisible: Bool
  let isSidebarCollapsed: Bool
  let sidebarResizeState: TerminalSidebarResizeState?
  let sidebarWidth: CGFloat?
}

struct TerminalWindowShellLayout: Equatable {
  let detailFrame: CGRect
  let revealFrame: CGRect
  let sidebarFrame: CGRect
  let sidebarWidth: CGFloat

  init(bounds: CGRect, presentation: TerminalWindowShellPresentation) {
    let sidebarWidth = TerminalSidebarWidthPolicy.displayedWidth(
      preferredWidth: presentation.sidebarWidth,
      resizeState: presentation.sidebarResizeState,
      totalWidth: bounds.width
    )
    let isDocked = !presentation.isSidebarCollapsed
    let isFloating = presentation.isSidebarCollapsed && presentation.isFloatingSidebarVisible
    let detailMinX = isDocked ? sidebarWidth : 0
    self.sidebarWidth = sidebarWidth
    detailFrame = CGRect(
      x: detailMinX,
      y: bounds.minY,
      width: max(0, bounds.width - detailMinX),
      height: bounds.height
    )
    sidebarFrame = CGRect(
      x: isDocked || isFloating ? bounds.minX : bounds.minX - sidebarWidth - 12,
      y: bounds.minY,
      width: sidebarWidth,
      height: bounds.height
    )
    revealFrame = CGRect(
      x: bounds.minX,
      y: bounds.minY,
      width: presentation.isSidebarCollapsed ? (isFloating ? sidebarWidth : 10) : 0,
      height: bounds.height
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

@MainActor
@Observable
final class TerminalWindowShellState {
  private(set) var isFloating = false
  private(set) var sidebarWidth: CGFloat = 0
  private(set) var totalWidth: CGFloat = 0

  func apply(layout: TerminalWindowShellLayout, presentation: TerminalWindowShellPresentation) {
    isFloating = presentation.isSidebarCollapsed
    sidebarWidth = layout.sidebarWidth
    totalWidth = layout.detailFrame.width + (presentation.isSidebarCollapsed ? 0 : layout.sidebarWidth)
  }
}

nonisolated struct TerminalTabSplitDropCoordinator {
  struct Context: Equatable {
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
  }

  enum State: Equatable {
    case hidden
    case available(Context)
    case targeted(Context, TerminalTabSplitSide)
  }

  private(set) var state = State.hidden

  var presentation: TerminalTabSplitDropPresentation {
    switch state {
    case .hidden:
      .hidden
    case .available:
      .available
    case .targeted(_, let side):
      .targeted(side)
    }
  }

  var canCommit: Bool {
    guard case .targeted = state else { return false }
    return true
  }

  mutating func update(context: Context, target: TerminalTabSplitSide?) {
    let state = target.map { State.targeted(context, $0) } ?? .available(context)
    guard state != self.state else { return }
    self.state = state
  }

  mutating func hide() {
    guard state != .hidden else { return }
    state = .hidden
  }

  mutating func commit(
    perform: (Context, TerminalTabSplitSide) -> Bool
  ) -> Bool {
    guard case .targeted(let context, let side) = state else { return false }
    let result = perform(context, side)
    state = .hidden
    return result
  }
}

@MainActor
final class TerminalWindowShellView: NSView {
  var onRevealChanged: ((Bool) -> Void)?
  var onDraggingUpdated: ((any NSDraggingInfo) -> NSDragOperation)?
  var onDraggingExited: (() -> Void)?
  var onDraggingEnded: (() -> Void)?
  var onPrepareForDragOperation: ((any NSDraggingInfo) -> Bool)?
  var onPerformDragOperation: ((any NSDraggingInfo) -> Bool)?
  private(set) var isPointerInsideRevealFrame = false
  private var revealFrame = CGRect.zero
  private var revealTrackingArea: NSTrackingArea?

  nonisolated override var safeAreaInsets: NSEdgeInsets { NSEdgeInsetsZero }

  func setRevealFrame(_ revealFrame: CGRect) {
    guard self.revealFrame != revealFrame else { return }
    self.revealFrame = revealFrame
    updateTrackingAreas()
  }

  override func updateTrackingAreas() {
    if let revealTrackingArea {
      removeTrackingArea(revealTrackingArea)
    }
    guard !revealFrame.isEmpty else {
      revealTrackingArea = nil
      setPointerInside(false)
      super.updateTrackingAreas()
      return
    }
    let revealTrackingArea = NSTrackingArea(
      rect: revealFrame,
      options: [.activeAlways, .mouseEnteredAndExited],
      owner: self,
      userInfo: nil
    )
    addTrackingArea(revealTrackingArea)
    self.revealTrackingArea = revealTrackingArea
    super.updateTrackingAreas()
  }

  override func mouseEntered(with event: NSEvent) {
    setPointerInside(true)
  }

  override func mouseExited(with event: NSEvent) {
    setPointerInside(false)
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

  private func setPointerInside(_ isInside: Bool) {
    guard isInside != isPointerInsideRevealFrame else { return }
    isPointerInsideRevealFrame = isInside
    onRevealChanged?(isInside)
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

  private(set) lazy var sidebarControllerCache = TerminalSidebarControllerCache(
    windowControllerID: windowControllerID,
    tabDragRegistry: tabDragRegistry,
    captureRequest: { [weak self] in self?.tabDragCaptureRequest() }
  )
  let state = TerminalWindowShellState()
  var onFloatingSidebarVisibilityChange: ((Bool) -> Void)?
  var isSpacePaging: () -> Bool = { false }
  var splitDestination:
    () -> (
      spaceID: TerminalSpaceID,
      tabID: TerminalTabID
    )? = { nil }

  private var detailController: NSViewController?
  private var detailFrame = CGRect.zero
  private var layoutBounds = CGRect.null
  private var presentation = TerminalWindowShellPresentation(
    isFloatingSidebarVisible: false,
    isSidebarCollapsed: false,
    sidebarResizeState: nil,
    sidebarWidth: nil
  )
  private var sidebarController: NSViewController?
  private let splitDropOverlay = TerminalTabSplitDropOverlayView()
  private var splitDropCoordinator = TerminalTabSplitDropCoordinator()
  private let reduceMotion: () -> Bool
  private let tabDragRegistry: TerminalTabDragRegistry
  private let windowControllerID: UUID

  init(
    windowControllerID: UUID,
    tabDragRegistry: TerminalTabDragRegistry,
    reduceMotion: @escaping () -> Bool = {
      NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    }
  ) {
    self.reduceMotion = reduceMotion
    self.tabDragRegistry = tabDragRegistry
    self.windowControllerID = windowControllerID
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) is unavailable")
  }

  override func loadView() {
    let shellView = TerminalWindowShellView()
    shellView.onRevealChanged = { [weak self] isInside in
      self?.revealChanged(isInside)
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
    guard view.bounds != layoutBounds else { return }
    applyLayout(motion: .immediate)
  }

  func install(sidebar: NSViewController, detail: NSViewController) {
    precondition(sidebarController == nil && detailController == nil)
    sidebar.view.wantsLayer = true
    detail.view.wantsLayer = true
    addChild(detail)
    view.addSubview(detail.view)
    view.addSubview(splitDropOverlay)
    addChild(sidebar)
    view.addSubview(sidebar.view)
    sidebarController = sidebar
    detailController = detail
    applyLayout(motion: .immediate)
  }

  func apply(_ presentation: TerminalWindowShellPresentation) {
    guard presentation != self.presentation else { return }
    let motion = frameMotion(from: self.presentation, to: presentation)
    self.presentation = presentation
    applyLayout(motion: motion)
  }

  func spacePagingDidEnd() {
    guard presentation.isSidebarCollapsed,
      presentation.isFloatingSidebarVisible,
      let shellView = view as? TerminalWindowShellView,
      !shellView.isPointerInsideRevealFrame
    else { return }
    onFloatingSidebarVisibilityChange?(false)
  }

  func tabDragCaptureRequest() -> TerminalTabDragCaptureRequest? {
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
    return TerminalTabDragCaptureRequest(
      windowID: CGWindowID(window.windowNumber),
      geometry: TerminalTabDragCaptureGeometry(
        windowFrame: window.frame,
        viewScreenFrame: viewScreenFrame,
        backingScaleFactor: window.backingScaleFactor
      )
    )
  }

  private func applyLayout(motion: FrameMotion) {
    guard let sidebarController, let detailController else { return }
    let layout = TerminalWindowShellLayout(bounds: view.bounds, presentation: presentation)
    layoutBounds = view.bounds
    detailFrame = layout.detailFrame
    state.apply(layout: layout, presentation: presentation)
    (view as? TerminalWindowShellView)?.setRevealFrame(layout.revealFrame)
    setFrame(layout.sidebarFrame, of: sidebarController.view, motion: motion)
    setFrame(layout.detailFrame, of: detailController.view, motion: motion)
    splitDropOverlay.frame = layout.detailFrame
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
    if current.isFloatingSidebarVisible != next.isFloatingSidebarVisible {
      return .floating
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
    for property in FrameProperty.allCases {
      layer?.removeAnimation(forKey: property.animationKey)
    }
  }

  private func revealChanged(_ isInside: Bool) {
    guard presentation.isSidebarCollapsed else { return }
    if isInside {
      onFloatingSidebarVisibilityChange?(true)
    } else if !isSpacePaging() {
      onFloatingSidebarVisibilityChange?(false)
    }
  }

  private func draggingUpdated(_ info: any NSDraggingInfo) -> NSDragOperation {
    guard
      let payload = tabDragRegistry.resolve(info.draggingPasteboard)
    else {
      dragDestinationExited()
      return []
    }
    let location = view.convert(info.draggingLocation, from: nil)
    guard detailFrame.contains(location) else {
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
    let overlayPoint = CGPoint(
      x: location.x - detailFrame.minX,
      y: location.y - detailFrame.minY
    )
    let sharedPreviewReady = tabDragRegistry.hasSharedPreview(for: payload)
    tabDragRegistry.transitionSharedPreview(payload, to: .contentPane)
    let target = splitDropOverlay.target(at: overlayPoint)
    let context = TerminalTabSplitDropCoordinator.Context(
      spaceID: destination.spaceID,
      tabID: destination.tabID
    )
    splitDropCoordinator.update(context: context, target: target)
    splitDropOverlay.render(
      splitDropCoordinator.presentation,
      at: overlayPoint,
      sharedPreviewReady: sharedPreviewReady
    )
    guard target != nil else {
      return .move
    }
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
    let didSplit = splitDropCoordinator.commit { context, side in
      tabDragRegistry.performSplit(
        payload,
        to: TerminalTabDragRegistry.SplitDestination(
          windowControllerID: windowControllerID,
          spaceID: context.spaceID,
          tabID: context.tabID,
          side: side
        )
      )
    }
    resetSplitDrop()
    return didSplit
  }

  private func dragDestinationExited() {
    if let payload = tabDragRegistry.activePayload {
      tabDragRegistry.transitionSharedPreview(payload, to: .window)
    }
    resetSplitDrop()
  }

  private func dragDestinationEnded() {
    resetSplitDrop()
  }

  private func resetSplitDrop() {
    splitDropCoordinator.hide()
    splitDropOverlay.render(
      splitDropCoordinator.presentation,
      at: nil,
      sharedPreviewReady: false
    )
  }
}
