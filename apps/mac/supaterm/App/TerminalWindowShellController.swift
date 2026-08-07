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

@MainActor
final class TerminalWindowShellView: NSView {
  var onRevealChanged: ((Bool) -> Void)?
  private(set) var isPointerInsideRevealFrame = false
  private var revealFrame = CGRect.zero
  private var revealTrackingArea: NSTrackingArea?

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

  private func setPointerInside(_ isInside: Bool) {
    guard isInside != isPointerInsideRevealFrame else { return }
    isPointerInsideRevealFrame = isInside
    onRevealChanged?(isInside)
  }
}

@MainActor
final class TerminalWindowShellController: NSViewController {
  let sidebarControllerCache: TerminalSidebarControllerCache
  let state = TerminalWindowShellState()
  var onFloatingSidebarVisibilityChange: ((Bool) -> Void)?
  var isSpacePaging: () -> Bool = { false }

  private var detailController: NSViewController?
  private var presentation = TerminalWindowShellPresentation(
    isFloatingSidebarVisible: false,
    isSidebarCollapsed: false,
    sidebarResizeState: nil,
    sidebarWidth: nil
  )
  private var sidebarController: NSViewController?

  init(windowControllerID: UUID, tabDragRegistry: TerminalTabDragRegistry) {
    sidebarControllerCache = TerminalSidebarControllerCache(
      windowControllerID: windowControllerID,
      tabDragRegistry: tabDragRegistry
    )
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

  private func applyLayout(animated: Bool) {
    guard let sidebarController, let detailController else { return }
    let layout = TerminalWindowShellLayout(bounds: view.bounds, presentation: presentation)
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
  }

  private func revealChanged(_ isInside: Bool) {
    guard presentation.isSidebarCollapsed else { return }
    if isInside {
      onFloatingSidebarVisibilityChange?(true)
    } else if !isSpacePaging() {
      onFloatingSidebarVisibilityChange?(false)
    }
  }
}
