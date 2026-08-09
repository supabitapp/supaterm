import AppKit
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
      presentation: presentation(collapsed: false, visible: false, width: 240)
    )

    #expect(layout.sidebarWidth == 240)
    #expect(layout.sidebarFrame == CGRect(x: 0, y: 0, width: 240, height: 700))
    #expect(layout.detailFrame == CGRect(x: 240, y: 0, width: 760, height: 700))
    #expect(layout.revealFrame.isEmpty)
  }

  @Test
  func collapsedSidebarLeavesARevealStripAndFullDetail() {
    let layout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: presentation(collapsed: true, visible: false, width: 240)
    )

    #expect(layout.sidebarFrame == CGRect(x: -252, y: 0, width: 240, height: 700))
    #expect(layout.detailFrame == bounds)
    #expect(layout.revealFrame == CGRect(x: 0, y: 0, width: 10, height: 700))
  }

  @Test
  func floatingSidebarOverlaysFullDetailAndExpandsRevealRegion() {
    let layout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: presentation(collapsed: true, visible: true, width: 240)
    )

    #expect(layout.sidebarFrame == CGRect(x: 0, y: 0, width: 240, height: 700))
    #expect(layout.detailFrame == bounds)
    #expect(layout.revealFrame == layout.sidebarFrame)
  }

  @Test @MainActor
  func dragCaptureUsesOnlyTheVisibleDetailForEverySidebarMode() throws {
    let docked = try captureRequest(
      presentation: presentation(collapsed: false, visible: false, width: 240)
    )
    let collapsed = try captureRequest(
      presentation: presentation(collapsed: true, visible: false, width: 240)
    )
    let floating = try captureRequest(
      presentation: presentation(collapsed: true, visible: true, width: 240)
    )

    #expect(docked.geometry.sourceRect == CGRect(x: 240, y: 0, width: 760, height: 700))
    #expect(collapsed.geometry.sourceRect == CGRect(x: 0, y: 0, width: 1_000, height: 700))
    #expect(floating.geometry.sourceRect == CGRect(x: 240, y: 0, width: 760, height: 700))
  }

  @Test
  func liveResizeUsesTheSettledPolicyRange() {
    let layout = TerminalWindowShellLayout(
      bounds: bounds,
      presentation: TerminalWindowShellPresentation(
        isFloatingSidebarVisible: false,
        isSidebarCollapsed: false,
        sidebarResizeState: TerminalSidebarResizeState(startingWidth: 240, delta: 80),
        sidebarWidth: 240
      )
    )

    #expect(layout.sidebarWidth == 300)
    #expect(layout.detailFrame.minX == 300)
  }

  private func presentation(
    collapsed: Bool,
    visible: Bool,
    width: CGFloat
  ) -> TerminalWindowShellPresentation {
    TerminalWindowShellPresentation(
      isFloatingSidebarVisible: visible,
      isSidebarCollapsed: collapsed,
      sidebarResizeState: nil,
      sidebarWidth: width
    )
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
    presentation: TerminalWindowShellPresentation
  ) throws -> TerminalTabDragCaptureRequest {
    let shell = TerminalWindowShellController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry()
    )
    let sidebar = NSViewController()
    sidebar.view = NSView()
    let detail = NSViewController()
    detail.view = NSView()
    shell.install(sidebar: sidebar, detail: detail)
    shell.apply(presentation)
    let window = NSWindow(
      contentRect: CGRect(x: 100, y: 100, width: 1_000, height: 700),
      styleMask: .borderless,
      backing: .buffered,
      defer: false
    )
    window.contentViewController = shell
    window.setFrame(bounds.offsetBy(dx: 100, dy: 100), display: false)
    shell.view.frame = bounds
    shell.viewDidLayout()
    window.layoutIfNeeded()
    return try #require(shell.tabDragCaptureRequest())
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
    let cache = TerminalSidebarControllerCache(captureRequest: { nil })
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
    let cache = TerminalSidebarControllerCache(captureRequest: { nil })
    let retainedSpaceID = TerminalSpaceID()
    let deletedSpaceID = TerminalSpaceID()
    let retained = cache.controller(for: retainedSpaceID)
    _ = cache.controller(for: deletedSpaceID)

    cache.retain([retainedSpaceID])

    #expect(cache.count == 1)
    #expect(cache.controller(for: retainedSpaceID) === retained)
  }
}
