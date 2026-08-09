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
  private(set) lazy var sidebarControllerCache = TerminalSidebarControllerCache(
    windowControllerID: windowControllerID,
    tabDragRegistry: tabDragRegistry,
    captureRequest: { [weak self] in self?.tabDragCaptureRequest() }
  )
  let state = TerminalWindowShellState()
  var onFloatingSidebarVisibilityChange: ((Bool) -> Void)?
  var isSpacePaging: () -> Bool = { false }
  var splitDestination:
    (TerminalTabID) -> (
      spaceID: TerminalSpaceID,
      tabID: TerminalTabID
    )? = { _ in nil }

  private var detailController: NSViewController?
  private var detailFrame = CGRect.zero
  private var presentation = TerminalWindowShellPresentation(
    isFloatingSidebarVisible: false,
    isSidebarCollapsed: false,
    sidebarResizeState: nil,
    sidebarWidth: nil
  )
  private var sidebarController: NSViewController?
  private let splitDropOverlay = TerminalTabSplitDropOverlayView()
  private var splitDropCoordinator = TerminalTabSplitDropCoordinator()
  private let tabDragRegistry: TerminalTabDragRegistry
  private let windowControllerID: UUID

  init(windowControllerID: UUID, tabDragRegistry: TerminalTabDragRegistry) {
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
    applyLayout(animated: false)
  }

  func install(sidebar: NSViewController, detail: NSViewController) {
    precondition(sidebarController == nil && detailController == nil)
    addChild(detail)
    view.addSubview(detail.view)
    view.addSubview(splitDropOverlay)
    addChild(sidebar)
    view.addSubview(sidebar.view)
    sidebarController = sidebar
    detailController = detail
    applyLayout(animated: false)
  }

  func apply(_ presentation: TerminalWindowShellPresentation) {
    guard presentation != self.presentation else { return }
    let shouldAnimate =
      presentation.sidebarResizeState == nil
      && self.presentation.sidebarResizeState == nil
    self.presentation = presentation
    applyLayout(animated: shouldAnimate)
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

  private func applyLayout(animated: Bool) {
    guard let sidebarController, let detailController else { return }
    let layout = TerminalWindowShellLayout(bounds: view.bounds, presentation: presentation)
    detailFrame = layout.detailFrame
    state.apply(layout: layout, presentation: presentation)
    (view as? TerminalWindowShellView)?.setRevealFrame(layout.revealFrame)
    if animated, view.window != nil {
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.2
        context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        sidebarController.view.animator().frame = layout.sidebarFrame
        detailController.view.animator().frame = layout.detailFrame
      }
    } else {
      sidebarController.view.frame = layout.sidebarFrame
      detailController.view.frame = layout.detailFrame
    }
    splitDropOverlay.frame = layout.detailFrame
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
    guard let sourceTabID = payload.singleTabID else {
      dragDestinationExited()
      return []
    }
    tabDragRegistry.consumeSplitDestinationEntryAction(for: payload)
    guard let destination = splitDestination(sourceTabID) else {
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
