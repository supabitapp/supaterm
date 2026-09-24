import AppKit
import Dependencies
import GhosttyKit
import Sharing
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct TerminalPaneDragHitTestingTests {
  @Test
  func containerRoutesHandleClicksAheadOfHostedContent() throws {
    try withFixture { fixture in
      // Handle clicks must win even when another child is first in normal hit testing.
      let coveringView = NSView(frame: fixture.container.bounds)
      fixture.container.addSubview(coveringView)
      let handlePoint = fixture.pane.convert(
        CGPoint(x: 100, y: fixture.pane.bounds.maxY - 5),
        to: fixture.container.superview
      )

      #expect(fixture.container.hitTest(handlePoint) === fixture.source)
      let bodyPoint = fixture.pane.convert(CGPoint(x: 100, y: 100), to: fixture.container.superview)
      #expect(fixture.container.hitTest(bodyPoint) === coveringView)
    }
  }

  @Test
  func hitTestingRefreshesHandlesAfterPaneGeometryChanges() throws {
    try withFixture { fixture in
      fixture.pane.frame = CGRect(x: 340, y: 50, width: 200, height: 150)
      let handlePoint = fixture.pane.convert(CGPoint(x: 100, y: 145), to: fixture.container)

      #expect(fixture.dragHost.hitTest(handlePoint) === fixture.source)
      #expect(fixture.source.frame == CGRect(x: 340, y: 190, width: 200, height: 10))
      #expect(fixture.dragHost.hitTest(CGPoint(x: 100, y: 225)) == nil)
    }
  }

  @Test
  func dragHostConvertsSuperviewCoordinates() throws {
    try withFixture { fixture in
      fixture.dragHost.frame.origin = CGPoint(x: 40, y: 60)
      fixture.dragHost.bounds.origin = CGPoint(x: 10, y: 15)
      let handlePoint = fixture.pane.convert(CGPoint(x: 100, y: 195), to: fixture.container)

      #expect(fixture.dragHost.hitTest(handlePoint) === fixture.source)
      #expect(
        fixture.source.hitTest(fixture.dragHost.convert(handlePoint, from: fixture.container)) === fixture.source)
    }
  }

  @Test
  func hiddenAndRemovedHandlesDoNotInterceptInput() throws {
    try withFixture { fixture in
      let handlePoint = fixture.pane.convert(CGPoint(x: 100, y: 195), to: fixture.container)
      fixture.dragHost.isHidden = true
      #expect(fixture.dragHost.hitTest(handlePoint) == nil)
      fixture.dragHost.isHidden = false
      fixture.dragHost.update(panes: [], client: nil)
      #expect(fixture.dragHost.hitTest(handlePoint) == nil)
    }
  }

  private struct Fixture {
    let container: TerminalSplitAXContainerView
    let dragHost: TerminalPaneDragSourceHost
    let pane: GhosttySurfaceView
    let source: TerminalPaneDragSourceNSView
  }

  private func withFixture(_ operation: (Fixture) throws -> Void) throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let runtime = GhosttyRuntime()
      let terminal = TerminalHostState.test(runtime: runtime, zmxClient: .noop, zmxSessionsEnabled: false)
      let pane = GhosttySurfaceView(
        runtime: runtime,
        tabID: UUID(),
        workingDirectory: nil,
        context: GHOSTTY_SURFACE_CONTEXT_SPLIT,
        surfaceFactory: { _, _ in nil }
      )
      let parent = NSView(frame: CGRect(x: 0, y: 0, width: 900, height: 700))
      let container = TerminalSplitAXContainerView(backgroundColor: .black)
      container.frame = CGRect(x: 40, y: 60, width: 800, height: 600)
      parent.addSubview(container)
      let rootView = TerminalSplitTreeView(
        agentPanelPresentations: [:],
        dimmingColor: .clear,
        dimmingOpacity: 0,
        focusedSurfaceID: nil,
        hiddenAgentPanelSurfaceIDs: [],
        terminalAccentColor: .clear,
        palette: Palette(colorScheme: .dark),
        agentPanelForksDown: false,
        agentPanelShortcutHint: nil,
        showsGlowingPaneRing: false,
        splitDividerColor: .clear,
        tree: SplitTree(),
        unreadSurfaceIDs: [],
        paneDragClient: nil,
        action: { _ in }
      )
      container.update(
        backgroundColor: .black,
        rootView: rootView,
        visibleNode: nil,
        action: { _ in },
        panes: [pane],
        paneDragClient: TerminalPaneDragClient(
          terminal: terminal,
          windowControllerID: UUID(),
          registry: TerminalTabDragRegistry(),
          captureClient: TerminalPaneCaptureClient { _ in nil }
        )
      )
      container.addSubview(pane)
      pane.frame = CGRect(x: 20, y: 30, width: 300, height: 200)
      let dragHost = try #require(container.subviews.compactMap { $0 as? TerminalPaneDragSourceHost }.first)
      dragHost.frame = container.bounds
      dragHost.layout()
      let source = try #require(dragHost.subviews.first as? TerminalPaneDragSourceNSView)
      try withExtendedLifetime(parent) {
        try operation(Fixture(container: container, dragHost: dragHost, pane: pane, source: source))
      }
    }
  }
}
