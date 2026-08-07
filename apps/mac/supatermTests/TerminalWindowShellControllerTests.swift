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
    window.layoutIfNeeded()

    #expect(shell.view.safeAreaInsets.top == 0)
    #expect(sidebar.view.safeAreaInsets.top == 0)
    #expect(detail.view.safeAreaInsets.top == 0)
    #expect(sidebar.view.frame.minY == detail.view.frame.minY)
    #expect(sidebar.view.frame.maxY == detail.view.frame.maxY)
  }

  @Test
  func tabDragPreviewKeepsTheSourceAspectRatioAndPointerAnchor() {
    let frame = TerminalTabDragPreviewLayout.frame(
      for: CGSize(width: 1_440, height: 900),
      at: CGPoint(x: 800, y: 500)
    )

    #expect(frame.size == CGSize(width: 420, height: 262.5))
    #expect(frame.minX == 724.4)
    #expect(frame.minY == 284.75)
  }

  @Test
  func splitDropTargetsUseStableSideGeometry() {
    let layout = TerminalTabSplitDropLayout(
      bounds: CGRect(x: 0, y: 0, width: 1_200, height: 800)
    )

    #expect(layout.leftFrame.minX == 22)
    #expect(layout.rightFrame.maxX == 1_178)
    #expect(layout.side(at: CGPoint(x: layout.leftFrame.midX, y: layout.leftFrame.midY)) == .left)
    #expect(
      layout.side(at: CGPoint(x: layout.rightFrame.midX, y: layout.rightFrame.midY)) == .right
    )
    #expect(layout.side(at: CGPoint(x: 600, y: 20)) == nil)
  }

  @Test
  func desktopDropReceiverRequiresAnUnblockedScreenPoint() {
    let screens = [CGRect(x: 0, y: 0, width: 1_200, height: 800)]
    let blocked = [CGRect(x: 100, y: 100, width: 600, height: 500)]

    #expect(
      TerminalTabDesktopDropRouting.receiverFrame(
        for: CGPoint(x: 50, y: 50),
        screenFrames: screens,
        blockedFrames: blocked
      ) == screens[0]
    )
    #expect(
      TerminalTabDesktopDropRouting.receiverFrame(
        for: CGPoint(x: 200, y: 200),
        screenFrames: screens,
        blockedFrames: blocked
      ) == nil
    )
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
}

@MainActor
struct TerminalSidebarControllerCacheTests {
  @Test
  func reusesOneControllerPerSpace() {
    let cache = TerminalSidebarControllerCache()
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
    let cache = TerminalSidebarControllerCache()
    let retainedSpaceID = TerminalSpaceID()
    let deletedSpaceID = TerminalSpaceID()
    let retained = cache.controller(for: retainedSpaceID)
    _ = cache.controller(for: deletedSpaceID)

    cache.retain([retainedSpaceID])

    #expect(cache.count == 1)
    #expect(cache.controller(for: retainedSpaceID) === retained)
  }
}
