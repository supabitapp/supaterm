import AppKit
import Clocks
import Foundation
import SwiftUI
import Testing

@testable import supaterm

struct TerminalWindowShellControllerTests {
  @Test @MainActor
  func shellGivesBothHostsTheWholeWindowContentArea() {
    let shell = TerminalWindowShellController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry()
    )
    let sidebar = NSHostingController(rootView: Color.clear)
    let detail = NSHostingController(rootView: Color.clear)
    shell.install(sidebar: sidebar, detail: detail)
    let window = NSWindow(
      contentRect: CGRect(x: 0, y: 0, width: 1_000, height: 700),
      styleMask: [.titled, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = shell
    shell.view.frame = CGRect(x: 0, y: 0, width: 1_000, height: 700)
    shell.viewDidLayout()
    window.layoutIfNeeded()

    #expect(shell.view.safeAreaInsets.top == 0)
    #expect(sidebar.view.safeAreaInsets.top == 0)
    #expect(detail.view.safeAreaInsets.top == 0)
    #expect(sidebar.view.frame.minY == detail.view.frame.minY)
    #expect(sidebar.view.frame.maxY == detail.view.frame.maxY)
    #expect(shell.tabDragCaptureRequest()?.geometry.sourceRect.size == detail.view.bounds.size)
    #expect(detail.view.bounds.width < shell.view.bounds.width)
  }

  @Test @MainActor
  func confirmationOverlayCoversTheWholeWindowContentArea() {
    let shell = TerminalWindowShellController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry()
    )
    let sidebar = NSHostingController(rootView: Color.clear)
    let detail = NSHostingController(rootView: Color.clear)
    let confirmationOverlay = NSViewController()
    confirmationOverlay.view = NSView()
    shell.install(
      sidebar: sidebar,
      detail: detail,
      confirmationOverlay: confirmationOverlay
    )
    let window = NSWindow(
      contentRect: CGRect(x: 0, y: 0, width: 1_000, height: 700),
      styleMask: [.titled, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = shell
    shell.view.frame = CGRect(x: 0, y: 0, width: 1_000, height: 700)
    shell.viewDidLayout()
    window.layoutIfNeeded()

    #expect(confirmationOverlay.view.frame == shell.view.bounds)
  }

  @Test @MainActor
  func sidebarToggleInstallsSpringFrameMotion() throws {
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: false, width: 240)
    )
    let sidebarLayer = try #require(fixture.sidebar.view.layer)
    let detailLayer = try #require(fixture.detail.view.layer)
    let oldSidebarPosition = sidebarLayer.position
    let oldDetailPosition = detailLayer.position
    let oldDetailBounds = detailLayer.bounds

    fixture.shell.apply(presentation(collapsed: true, width: 240))
    fixture.shell.viewDidLayout()

    #expect(fixture.sidebar.view.frame == CGRect(x: -252, y: 0, width: 240, height: 700))
    #expect(fixture.detail.view.frame == bounds)
    let sidebarPosition = try #require(
      sidebarLayer.animation(forKey: "windowShellPosition") as? CASpringAnimation
    )
    let detailPosition = try #require(
      detailLayer.animation(forKey: "windowShellPosition") as? CASpringAnimation
    )
    let detailBounds = try #require(
      detailLayer.animation(forKey: "windowShellBounds") as? CASpringAnimation
    )
    expectSidebarSpring(
      sidebarPosition,
      from: NSValue(point: oldSidebarPosition),
      to: NSValue(point: sidebarLayer.position)
    )
    expectSidebarSpring(
      detailPosition,
      from: NSValue(point: oldDetailPosition),
      to: NSValue(point: detailLayer.position)
    )
    expectSidebarSpring(
      detailBounds,
      from: NSValue(rect: oldDetailBounds),
      to: NSValue(rect: detailLayer.bounds)
    )
    #expect(sidebarLayer.animation(forKey: "windowShellBounds") == nil)
  }

  @Test @MainActor
  func collapsedSidebarLeavesTheAccessibilityTreeUntilRevealed() async {
    let clock = TestClock()
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: false, width: 240),
      reduceMotion: { true },
      clock: clock,
      pointerLocation: CGPoint(x: 1, y: 350)
    )

    fixture.shell.apply(presentation(collapsed: true, width: 240))

    #expect(fixture.sidebar.view.isAccessibilityHidden())
    #expect(fixture.sidebar.view.isHidden)

    await advanceClock(clock, by: TerminalSidebarRevealMetrics.stoppedDuration)

    #expect(!fixture.sidebar.view.isAccessibilityHidden())
    #expect(!fixture.sidebar.view.isHidden)

    fixture.shell.apply(presentation(collapsed: false, width: 240))

    #expect(!fixture.sidebar.view.isAccessibilityHidden())
    #expect(!fixture.sidebar.view.isHidden)
  }

  @Test @MainActor
  func floatingRevealUsesEaseOutWithoutMovingDetail() async throws {
    let clock = TestClock()
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: true, width: 240),
      clock: clock,
      pointerLocation: CGPoint(x: 1, y: 350)
    )
    let sidebarLayer = try #require(fixture.sidebar.view.layer)
    let detailLayer = try #require(fixture.detail.view.layer)
    let oldSidebarPosition = sidebarLayer.position
    await advanceClock(clock, by: TerminalSidebarRevealMetrics.stoppedDuration)

    #expect(fixture.sidebar.view.frame == CGRect(x: 0, y: 0, width: 240, height: 700))
    #expect(fixture.detail.view.frame == bounds)
    let animation = try #require(
      sidebarLayer.animation(forKey: "windowShellPosition") as? CABasicAnimation
    )
    #expect(!(animation is CASpringAnimation))
    #expect(animation.duration == 0.1)
    #expect(
      (animation.fromValue as? NSValue)?.isEqual(NSValue(point: oldSidebarPosition)) == true
    )
    #expect(
      (animation.toValue as? NSValue)?.isEqual(NSValue(point: sidebarLayer.position)) == true
    )
    let timingFunction = try #require(animation.timingFunction)
    let easeOut = CAMediaTimingFunction(name: .easeOut)
    #expect(controlPoint(timingFunction, at: 1) == controlPoint(easeOut, at: 1))
    #expect(controlPoint(timingFunction, at: 2) == controlPoint(easeOut, at: 2))
    #expect(sidebarLayer.animation(forKey: "windowShellBounds") == nil)
    #expect(detailLayer.animation(forKey: "windowShellPosition") == nil)
    #expect(detailLayer.animation(forKey: "windowShellBounds") == nil)
  }

  @Test(arguments: TerminalSidebarWindowGeometryChange.allCases) @MainActor
  func revealedSidebarHidesWhenWindowGeometryMovesPointerOutside(
    _ change: TerminalSidebarWindowGeometryChange
  ) async {
    let clock = TestClock()
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: true, width: 240),
      reduceMotion: { true },
      clock: clock,
      pointerLocation: CGPoint(x: 1, y: 350)
    )
    await advanceClock(clock, by: TerminalSidebarRevealMetrics.stoppedDuration)
    #expect(!fixture.sidebar.view.isHidden)

    switch change {
    case .move:
      fixture.window.setFrameOrigin(CGPoint(x: 500, y: 0))
    case .resize:
      fixture.window.setContentSize(CGSize(width: 1_000, height: 200))
      fixture.window.layoutIfNeeded()
      fixture.shell.viewDidLayout()
    }
    #expect(
      (fixture.shell.view as? TerminalWindowShellView)?.isPointerInsideRevealFrame == false
    )
    #expect(fixture.sidebar.view.isHidden)
  }

  @Test @MainActor
  func spacePagingRetainsRevealUntilPagingEnds() async {
    let clock = TestClock()
    var isPaging = true
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: true, width: 240),
      reduceMotion: { true },
      clock: clock,
      pointerLocation: CGPoint(x: 1, y: 350)
    )
    fixture.shell.isSpacePaging = { isPaging }
    await advanceClock(clock, by: TerminalSidebarRevealMetrics.stoppedDuration)

    fixture.window.setFrameOrigin(CGPoint(x: 500, y: 0))
    #expect(!fixture.sidebar.view.isHidden)

    isPaging = false
    fixture.shell.spacePagingDidEnd()
    #expect(fixture.sidebar.view.isHidden)
  }

  @Test @MainActor
  func reduceMotionMakesSidebarToggleImmediate() throws {
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: false, width: 240),
      reduceMotion: { true }
    )

    fixture.shell.apply(presentation(collapsed: true, width: 240))

    #expect(fixture.sidebar.view.frame == CGRect(x: -252, y: 0, width: 240, height: 700))
    #expect(fixture.detail.view.frame == bounds)
    try expectNoFrameAnimations(fixture)
  }

  @Test @MainActor
  func sidebarResizeEndDoesNotAnimateCollapse() throws {
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: false, width: 240)
    )
    let resizing = TerminalWindowShellPresentation(
      isSidebarCollapsed: false,
      sidebarResizeState: TerminalSidebarResizeState(startingWidth: 240, delta: 40),
      sidebarWidth: 240
    )

    fixture.shell.apply(resizing)

    #expect(fixture.sidebar.view.frame.width == 280)
    #expect(fixture.detail.view.frame.minX == 280)
    try expectNoFrameAnimations(fixture)

    fixture.shell.apply(presentation(collapsed: true, width: 280))

    #expect(fixture.sidebar.view.frame == CGRect(x: -292, y: 0, width: 280, height: 700))
    #expect(fixture.detail.view.frame == bounds)
    try expectNoFrameAnimations(fixture)
  }

  @Test @MainActor
  func boundsChangeCancelsActiveFrameMotion() throws {
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: false, width: 240)
    )
    fixture.shell.apply(presentation(collapsed: true, width: 240))
    let sidebarLayer = try #require(fixture.sidebar.view.layer)
    let detailLayer = try #require(fixture.detail.view.layer)
    #expect(sidebarLayer.animation(forKey: "windowShellPosition") != nil)
    #expect(detailLayer.animation(forKey: "windowShellBounds") != nil)

    fixture.shell.viewDidLayout()

    #expect(sidebarLayer.animation(forKey: "windowShellPosition") != nil)
    #expect(detailLayer.animation(forKey: "windowShellBounds") != nil)

    fixture.window.setContentSize(CGSize(width: 900, height: 700))
    fixture.window.layoutIfNeeded()
    fixture.shell.viewDidLayout()

    #expect(fixture.shell.view.bounds.size == CGSize(width: 900, height: 700))
    #expect(fixture.sidebar.view.frame == CGRect(x: -252, y: 0, width: 240, height: 700))
    #expect(fixture.detail.view.frame == CGRect(x: 0, y: 0, width: 900, height: 700))
    #expect(sidebarLayer.animation(forKey: "windowShellPosition") == nil)
    #expect(sidebarLayer.animation(forKey: "windowShellBounds") == nil)
    #expect(detailLayer.animation(forKey: "windowShellPosition") == nil)
    #expect(detailLayer.animation(forKey: "windowShellBounds") == nil)
  }

  @Test @MainActor
  func interruptedToggleRetargetsFromPresentationGeometry() throws {
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: false, width: 240)
    )
    let sidebarLayer = try #require(fixture.sidebar.view.layer)
    let start = sidebarLayer.position
    let pausedTime = sidebarLayer.convertTime(CACurrentMediaTime(), from: nil)
    sidebarLayer.speed = 0
    sidebarLayer.timeOffset = pausedTime

    fixture.shell.apply(presentation(collapsed: true, width: 240))

    let collapse = try #require(
      sidebarLayer.animation(forKey: "windowShellPosition") as? CASpringAnimation
    )
    let end = sidebarLayer.position
    CATransaction.flush()
    sidebarLayer.timeOffset = pausedTime + collapse.duration / 2
    CATransaction.flush()
    let midpoint = try #require(sidebarLayer.presentation()?.position)
    #expect(midpoint.x > min(start.x, end.x))
    #expect(midpoint.x < max(start.x, end.x))

    fixture.shell.apply(presentation(collapsed: false, width: 240))

    let expand = try #require(
      sidebarLayer.animation(forKey: "windowShellPosition") as? CASpringAnimation
    )
    #expect(
      (expand.fromValue as? NSValue)?.isEqual(NSValue(point: midpoint)) == true
    )
    #expect(
      (expand.toValue as? NSValue)?.isEqual(NSValue(point: sidebarLayer.position)) == true
    )
  }

  @Test @MainActor
  func terminalDragEndKeepsTheContentPreviewUntilTheRegistryFinishes() throws {
    let fixture = try shellDragFixture()
    #expect(fixture.showContentPreview())

    _ = fixture.shellView.perform(
      NSSelectorFromString("draggingEnded:"),
      with: NSNull()
    )

    #expect(fixture.preview.currentType == .contentPane)
    #expect(fixture.preview.transitions == [.contentPane])
    fixture.registry.finish(operationID: fixture.payload.moveOperationID, outcome: .moved)
    #expect(fixture.preview.hideCount == 1)
  }

  @Test @MainActor
  func destinationExitRestoresTheWindowPreviewWhileTheDragContinues() throws {
    let fixture = try shellDragFixture()
    #expect(fixture.showContentPreview())

    fixture.shellView.draggingExited(nil)

    #expect(fixture.preview.currentType == .window)
    #expect(fixture.preview.transitions == [.contentPane, .window])
    #expect(fixture.registry.activePayload == fixture.payload)
  }

  @Test
  func tabDragPreviewUsesTheContentRatioAndPointerCenter() {
    let frame = TerminalTabDragPreviewLayout.frame(
      for: CGSize(width: 1_440, height: 820),
      at: CGPoint(x: 800, y: 500)
    )

    #expect(frame.width == 210)
    #expect(abs(frame.height - 119.583_333_333_333_33) < 0.000_001)
    #expect(frame.midX == 800)
    #expect(frame.midY == 500)

    let fallback = TerminalTabDragPreviewLayout.frame(
      for: nil,
      at: CGPoint(x: 800, y: 500)
    )
    #expect(fallback.size == CGSize(width: 210, height: 138.6))
    #expect(fallback.midX == 800)
    #expect(fallback.midY == 500)
    #expect(
      TerminalTabDragPreviewLayout.frame(
        for: CGSize(width: 1_440, height: 0),
        at: CGPoint(x: 800, y: 500)
      ).size == fallback.size
    )

    let snapshotFrame = TerminalTabDragPreviewLayout.snapshotFrame(
      for: CGSize(width: 1_440, height: 900),
      in: CGRect(origin: .zero, size: frame.size)
    )
    #expect(snapshotFrame.width == frame.width)
    #expect(snapshotFrame.height == 131.25)
    #expect(snapshotFrame.minY < 0)
    #expect(snapshotFrame.maxY == frame.height)

    let previewBounds = CGRect(origin: .zero, size: frame.size)
    #expect(
      TerminalTabDragPreviewLayout.contentFrame(for: .window, in: previewBounds)
        == CGRect(x: 47, y: 2, width: 161, height: frame.height - 4)
    )
    #expect(
      TerminalTabDragPreviewLayout.contentFrame(for: .contentPane, in: previewBounds)
        == previewBounds.insetBy(dx: 2, dy: 2)
    )
  }

  @Test
  func splitDropCoordinatorTargetsTheFirstValidUpdate() {
    var coordinator = TerminalTabSplitDropCoordinator()
    let context = splitDropContext()

    #expect(coordinator.state == .hidden)
    #expect(coordinator.presentation == .hidden)
    coordinator.update(context: context, target: .left)
    #expect(coordinator.state == .targeted(context, .left))
    #expect(coordinator.presentation == .targeted(.left))
    #expect(coordinator.canCommit)
  }

  @Test
  func splitDropCoordinatorRetainsEqualState() {
    var coordinator = TerminalTabSplitDropCoordinator()
    let context = splitDropContext()

    coordinator.update(context: context, target: nil)
    let availableState = coordinator.state
    coordinator.update(context: context, target: nil)
    #expect(coordinator.state == availableState)
    #expect(coordinator.state == .available(context))
    #expect(coordinator.presentation == .available)
    #expect(!coordinator.canCommit)

    coordinator.update(context: context, target: .right)
    let targetedState = coordinator.state
    coordinator.update(context: context, target: .right)
    #expect(coordinator.state == targetedState)
    #expect(coordinator.state == .targeted(context, .right))
    #expect(coordinator.presentation == .targeted(.right))
  }

  @Test
  func splitDropCoordinatorHidesAfterTargetedCommitAttemptOnly() {
    var coordinator = TerminalTabSplitDropCoordinator()
    let context = splitDropContext()
    var committedContext: TerminalTabSplitDropCoordinator.Context?
    var committedSide: TerminalTabSplitSide?
    var commitCount = 0
    coordinator.update(context: context, target: nil)

    let didCommitAvailable = coordinator.commit { _, _ in
      commitCount += 1
      return true
    }
    #expect(!didCommitAvailable)
    #expect(commitCount == 0)
    #expect(coordinator.state == .available(context))

    coordinator.update(context: context, target: .right)
    let didCommitTarget = coordinator.commit { context, side in
      commitCount += 1
      committedContext = context
      committedSide = side
      return false
    }

    #expect(!didCommitTarget)
    #expect(commitCount == 1)
    #expect(committedContext == context)
    #expect(committedSide == .right)
    #expect(coordinator.state == .hidden)
    #expect(coordinator.presentation == .hidden)

    let didCommitHidden = coordinator.commit { _, _ in
      commitCount += 1
      return true
    }
    coordinator.hide()
    #expect(!didCommitHidden)
    #expect(commitCount == 1)
    #expect(coordinator.state == .hidden)
  }

  @Test
  func desktopDropReceiverRequiresAPointOutsideCurrentProcessWindows() throws {
    let screens = [CGRect(x: 0, y: 0, width: 1_200, height: 800)]
    let windowFrame = try #require(
      TerminalTabDesktopDropRouting.currentProcessWindowFrame(
        CGRect(x: 100, y: 100, width: 600, height: 500),
        isVisibleOnActiveSpace: true,
        alphaValue: 1,
        isMiniaturized: false,
        ignoresMouseEvents: false
      )
    )

    #expect(
      TerminalTabDesktopDropRouting.receiverFrame(
        for: CGPoint(x: 50, y: 50),
        screenFrames: screens,
        currentProcessWindowFrames: [windowFrame]
      ) == screens[0]
    )
    #expect(
      TerminalTabDesktopDropRouting.receiverFrame(
        for: CGPoint(x: 200, y: 200),
        screenFrames: screens,
        currentProcessWindowFrames: [windowFrame]
      ) == nil
    )
  }

  @Test
  func desktopDropRoutingExcludesCurrentProcessWindowsOnAnotherSpace() {
    let frame = TerminalTabDesktopDropRouting.currentProcessWindowFrame(
      CGRect(x: 0, y: 0, width: 1_200, height: 800),
      isVisibleOnActiveSpace: false,
      alphaValue: 1,
      isMiniaturized: false,
      ignoresMouseEvents: false
    )

    #expect(frame == nil)
  }

  @Test
  func desktopDropReceiverAllowsPointsOverOtherProcesses() {
    let screen = CGRect(x: 0, y: 0, width: 1_200, height: 800)

    #expect(
      TerminalTabDesktopDropRouting.receiverFrame(
        for: CGPoint(x: 200, y: 200),
        screenFrames: [screen],
        currentProcessWindowFrames: []
      ) == screen
    )
  }

  @Test
  func detachedWindowKeepsThePreviewCenterAndUsesTheNormalWindowSize() {
    let previewFrame = CGRect(x: 700, y: 400, width: 210, height: 120)
    let windowSize = CGSize(width: 1_440, height: 900)

    let frame = TerminalTabNewWindowLayout.frame(
      previewFrame: previewFrame,
      windowSize: windowSize,
      visibleFrame: CGRect(x: 0, y: 0, width: 2_000, height: 1_200)
    )

    #expect(frame.size == windowSize)
    #expect(frame.midX == previewFrame.midX)
    #expect(frame.midY == previewFrame.midY)
  }

  private let bounds = CGRect(x: 0, y: 0, width: 1_000, height: 700)

  @Test
  func dockedSidebarOwnsLeadingWindowRegion() {
    let layout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: .anchored,
      sidebarResizeState: nil,
      sidebarWidth: 240
    )

    #expect(layout.sidebarFrame == CGRect(x: 0, y: 0, width: 240, height: 700))
    #expect(layout.detailFrame == CGRect(x: 240, y: 0, width: 760, height: 700))
    #expect(layout.resizeFrame == CGRect(x: 238, y: 0, width: 8, height: 700))
    #expect(layout.revealFrame.isEmpty)
  }

  @Test
  func collapsedSidebarLeavesARevealStripAndFullDetail() {
    let layout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: .hidden,
      sidebarResizeState: nil,
      sidebarWidth: 240
    )

    #expect(layout.sidebarFrame == CGRect(x: -252, y: 0, width: 240, height: 700))
    #expect(layout.detailFrame == bounds)
    #expect(layout.resizeFrame.isEmpty)
    #expect(layout.revealFrame == CGRect(x: 0, y: 0, width: 3.6, height: 700))

    let activeLayout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: .hidden,
      isRevealPointerInside: true,
      sidebarResizeState: nil,
      sidebarWidth: 240
    )
    #expect(activeLayout.revealFrame == CGRect(x: 0, y: 0, width: 9, height: 700))
  }

  @Test
  func floatingSidebarOverlaysFullDetailAndExpandsRevealRegion() {
    let layout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: .floating,
      sidebarResizeState: nil,
      sidebarWidth: 240
    )

    #expect(layout.sidebarFrame == CGRect(x: 0, y: 0, width: 240, height: 700))
    #expect(layout.detailFrame == bounds)
    #expect(layout.resizeFrame == CGRect(x: 232, y: 0, width: 8, height: 700))
    #expect(layout.revealFrame == CGRect(x: 0, y: 0, width: 315, height: 700))
  }

  @Test @MainActor
  func resizeViewOwnsEachVisibleSidebarEdge() async throws {
    let clock = TestClock()
    let fixture = shellMotionFixture(
      presentation: presentation(collapsed: false, width: 240),
      reduceMotion: { true },
      clock: clock,
      pointerLocation: CGPoint(x: 1, y: 350)
    )
    let resizeView = try #require(
      fixture.shell.view.subviews.first { $0 is SidebarResizeInteractionNSView }
        as? SidebarResizeInteractionNSView
    )

    #expect(resizeView.frame == CGRect(x: 238, y: 0, width: 8, height: 700))
    #expect(fixture.shell.view.hitTest(CGPoint(x: 237.5, y: 350)) === fixture.sidebar.view)
    #expect(fixture.shell.view.hitTest(CGPoint(x: 238.5, y: 350)) === resizeView)
    #expect(fixture.shell.view.hitTest(CGPoint(x: 245.5, y: 350)) === resizeView)
    #expect(fixture.shell.view.hitTest(CGPoint(x: 246.5, y: 350)) === fixture.detail.view)
    #expect(!resizeView.isHidden)
    #expect(!resizeView.isAccessibilityHidden())

    fixture.shell.apply(presentation(collapsed: false, width: 280))

    #expect(resizeView.frame == CGRect(x: 278, y: 0, width: 8, height: 700))
    #expect(fixture.shell.view.hitTest(CGPoint(x: 285.5, y: 350)) === resizeView)

    fixture.shell.apply(presentation(collapsed: true, width: 240))
    await advanceClock(clock, by: TerminalSidebarRevealMetrics.stoppedDuration)

    #expect(resizeView.frame == CGRect(x: 232, y: 0, width: 8, height: 700))
    #expect(fixture.shell.view.hitTest(CGPoint(x: 231.5, y: 350)) === fixture.sidebar.view)
    #expect(fixture.shell.view.hitTest(CGPoint(x: 232.5, y: 350)) === resizeView)
    #expect(fixture.shell.view.hitTest(CGPoint(x: 239.5, y: 350)) === resizeView)
    #expect(fixture.shell.view.hitTest(CGPoint(x: 240.5, y: 350)) === fixture.detail.view)
    #expect(!resizeView.isHidden)
    #expect(!resizeView.isAccessibilityHidden())

    fixture.window.screenPointerLocation = fixture.window.convertPoint(
      toScreen: CGPoint(x: 500, y: 350)
    )
    fixture.window.setFrameOrigin(CGPoint(x: 1, y: 0))

    #expect(resizeView.frame.isEmpty)
    #expect(resizeView.isHidden)
    #expect(resizeView.isAccessibilityHidden())
    #expect(fixture.shell.view.hitTest(CGPoint(x: 5, y: 350)) !== resizeView)
  }

  @Test @MainActor
  func dragCaptureUsesOnlyTheVisibleDetailForEverySidebarMode() async throws {
    let docked = try await captureRequest(
      presentation: presentation(collapsed: false, width: 240)
    )
    let collapsed = try await captureRequest(
      presentation: presentation(collapsed: true, width: 240)
    )
    let floating = try await captureRequest(
      presentation: presentation(collapsed: true, width: 240),
      reveal: true
    )

    #expect(docked.geometry.sourceRect == CGRect(x: 240, y: 0, width: 760, height: 700))
    #expect(collapsed.geometry.sourceRect == CGRect(x: 0, y: 0, width: 1_000, height: 700))
    #expect(floating.geometry.sourceRect == CGRect(x: 240, y: 0, width: 760, height: 700))
  }

  @Test
  func liveResizeUsesTheSettledPolicyRange() {
    let layout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: .anchored,
      sidebarResizeState: TerminalSidebarResizeState(startingWidth: 240, delta: 80),
      sidebarWidth: 240
    )

    #expect(layout.sidebarFrame.width == 300)
    #expect(layout.detailFrame.minX == 300)
  }

  private func presentation(
    collapsed: Bool,
    width: CGFloat
  ) -> TerminalWindowShellPresentation {
    TerminalWindowShellPresentation(
      isSidebarCollapsed: collapsed,
      sidebarResizeState: nil,
      sidebarWidth: width
    )
  }

  @MainActor
  private func shellMotionFixture(
    presentation: TerminalWindowShellPresentation,
    reduceMotion: @escaping () -> Bool = { false },
    clock: TestClock<Duration>? = nil,
    pointerLocation: CGPoint? = nil
  ) -> TerminalWindowShellMotionFixture {
    let shell: TerminalWindowShellController
    if let clock {
      shell = TerminalWindowShellController(
        windowControllerID: UUID(),
        tabDragRegistry: TerminalTabDragRegistry(),
        reduceMotion: reduceMotion,
        revealSleep: { try await clock.sleep(for: $0) }
      )
    } else {
      shell = TerminalWindowShellController(
        windowControllerID: UUID(),
        tabDragRegistry: TerminalTabDragRegistry(),
        reduceMotion: reduceMotion
      )
    }
    shell.view.frame = bounds
    let sidebar = NSViewController()
    sidebar.view = NSView()
    let detail = NSViewController()
    detail.view = NSView()
    shell.install(sidebar: sidebar, detail: detail)
    shell.apply(presentation)
    let window = TerminalSidebarPointerWindow(
      contentRect: bounds,
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.screenPointerLocation = window.convertPoint(
      toScreen: pointerLocation ?? CGPoint(x: 500, y: 350)
    )
    window.contentViewController = shell
    window.layoutIfNeeded()
    shell.viewDidLayout()
    return TerminalWindowShellMotionFixture(
      window: window,
      shell: shell,
      sidebar: sidebar,
      detail: detail
    )
  }

  private func expectSidebarSpring(
    _ animation: CASpringAnimation,
    from: NSValue,
    to: NSValue
  ) {
    let angularFrequency = 2 * CGFloat.pi / 0.2
    #expect(animation.mass == 1)
    #expect(abs(animation.stiffness - angularFrequency * angularFrequency) < 0.000_001)
    #expect(abs(animation.damping - 2 * angularFrequency) < 0.000_001)
    #expect(animation.initialVelocity == 0)
    #expect(animation.duration == animation.settlingDuration)
    #expect((animation.fromValue as? NSValue)?.isEqual(from) == true)
    #expect((animation.toValue as? NSValue)?.isEqual(to) == true)
  }

  private func controlPoint(
    _ timingFunction: CAMediaTimingFunction,
    at index: Int
  ) -> CGPoint {
    var values = [Float](repeating: 0, count: 2)
    values.withUnsafeMutableBufferPointer { buffer in
      timingFunction.getControlPoint(at: index, values: buffer.baseAddress!)
    }
    return CGPoint(x: CGFloat(values[0]), y: CGFloat(values[1]))
  }

  @MainActor
  private func expectNoFrameAnimations(_ fixture: TerminalWindowShellMotionFixture) throws {
    let sidebarLayer = try #require(fixture.sidebar.view.layer)
    let detailLayer = try #require(fixture.detail.view.layer)
    #expect(sidebarLayer.animation(forKey: "windowShellPosition") == nil)
    #expect(sidebarLayer.animation(forKey: "windowShellBounds") == nil)
    #expect(detailLayer.animation(forKey: "windowShellPosition") == nil)
    #expect(detailLayer.animation(forKey: "windowShellBounds") == nil)
  }

  private func splitDropContext() -> TerminalTabSplitDropCoordinator.Context {
    TerminalTabSplitDropCoordinator.Context(
      spaceID: TerminalSpaceID(),
      tabID: TerminalTabID()
    )
  }

  @MainActor
  private func shellDragFixture() throws -> TerminalWindowShellDragFixture {
    let preview = TerminalWindowShellPreviewRecorder()
    let registry = TerminalTabDragRegistry(previewPresenter: preview)
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    let shell = TerminalWindowShellController(
      windowControllerID: UUID(),
      tabDragRegistry: registry
    )
    let shellView = try #require(shell.view as? TerminalWindowShellView)
    return TerminalWindowShellDragFixture(
      preview: preview,
      registry: registry,
      payload: payload,
      shell: shell,
      shellView: shellView
    )
  }

  @MainActor
  private func captureRequest(
    presentation: TerminalWindowShellPresentation,
    reveal: Bool = false
  ) async throws -> TerminalWindowCaptureRequest {
    let clock = TestClock()
    let shell = TerminalWindowShellController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry(),
      revealSleep: { try await clock.sleep(for: $0) }
    )
    let sidebar = NSViewController()
    sidebar.view = NSView()
    let detail = NSViewController()
    detail.view = NSView()
    shell.install(sidebar: sidebar, detail: detail)
    shell.apply(presentation)
    let window = TerminalSidebarPointerWindow(
      contentRect: CGRect(x: 100, y: 100, width: 1_000, height: 700),
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.screenPointerLocation = window.convertPoint(toScreen: CGPoint(x: 1, y: 350))
    window.contentViewController = shell
    window.setFrame(bounds.offsetBy(dx: 100, dy: 100), display: false)
    shell.view.frame = bounds
    shell.viewDidLayout()
    window.layoutIfNeeded()
    if reveal {
      await advanceClock(clock, by: TerminalSidebarRevealMetrics.stoppedDuration)
    }
    return try #require(shell.tabDragCaptureRequest())
  }
}

@MainActor
private struct TerminalWindowShellMotionFixture {
  let window: TerminalSidebarPointerWindow
  let shell: TerminalWindowShellController
  let sidebar: NSViewController
  let detail: NSViewController
}

enum TerminalSidebarWindowGeometryChange: CaseIterable, Sendable {
  case move
  case resize
}

@MainActor
private final class TerminalSidebarPointerWindow: NSWindow {
  var screenPointerLocation = CGPoint.zero

  override var mouseLocationOutsideOfEventStream: NSPoint {
    convertPoint(fromScreen: screenPointerLocation)
  }
}

@MainActor
private struct TerminalWindowShellDragFixture {
  let preview: TerminalWindowShellPreviewRecorder
  let registry: TerminalTabDragRegistry
  let payload: TerminalTabDragPayload
  let shell: TerminalWindowShellController
  let shellView: TerminalWindowShellView

  func showContentPreview() -> Bool {
    guard
      shell.view === shellView,
      registry.begin(
        payload
      ),
      registry.move(to: CGPoint(x: 800, y: 500), sourceSurfaceFrame: .zero) != nil
    else { return false }
    return registry.transitionSharedPreview(payload, to: .contentPane)
  }
}

@MainActor
private final class TerminalWindowShellPreviewRecorder: TerminalTabDragPreviewPresenting {
  private(set) var currentType = TerminalTabDragPreviewType.window
  private(set) var transitions: [TerminalTabDragPreviewType] = []
  private(set) var hideCount = 0

  func show(image _: NSImage?, frame: CGRect) -> CGRect {
    frame
  }

  func update(image _: NSImage?) {}

  func transition(to type: TerminalTabDragPreviewType) -> Bool {
    guard type != currentType else { return false }
    currentType = type
    transitions.append(type)
    return true
  }

  func hide() {
    hideCount += 1
  }
}

@MainActor
struct TerminalSidebarControllerCacheTests {
  @Test
  func reusesOneControllerPerSpace() {
    let cache = TerminalSidebarControllerCache(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry(),
      captureRequest: { nil }
    )
    let firstSpaceID = TerminalSpaceID()
    let secondSpaceID = TerminalSpaceID()

    let first = cache.controller(for: firstSpaceID)
    let repeated = cache.controller(for: firstSpaceID)
    let second = cache.controller(for: secondSpaceID)

    #expect(first === repeated)
    #expect(first !== second)
    #expect(cache.count == 2)
  }

  @Test
  func dropsControllersForDeletedSpaces() {
    let cache = TerminalSidebarControllerCache(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry(),
      captureRequest: { nil }
    )
    let retainedSpaceID = TerminalSpaceID()
    let deletedSpaceID = TerminalSpaceID()
    let retained = cache.controller(for: retainedSpaceID)
    _ = cache.controller(for: deletedSpaceID)

    cache.retain([retainedSpaceID])

    #expect(cache.count == 1)
    #expect(cache.controller(for: retainedSpaceID) === retained)
  }
}
