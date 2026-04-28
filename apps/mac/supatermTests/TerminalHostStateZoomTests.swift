import AppKit
import ComposableArchitecture
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStateZoomTests {
  @Test
  func isPaneZoomedOnlyForFocusedZoomedPane() throws {
    let first = PaneZoomTestView()
    let second = PaneZoomTestView()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
    let zoomedTree = tree.settingZoomed(try #require(tree.find(id: second.id)))

    #expect(TerminalHostState.isPaneZoomed(focusedSurfaceID: second.id, in: zoomedTree))
    #expect(!TerminalHostState.isPaneZoomed(focusedSurfaceID: first.id, in: zoomedTree))
    #expect(!TerminalHostState.isPaneZoomed(focusedSurfaceID: nil, in: zoomedTree))
    #expect(!TerminalHostState.isPaneZoomed(focusedSurfaceID: second.id, in: tree))
  }

  @Test
  func gotoSplitPreservesZoomOnNavigationWhenConfigured() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let runtime = try makeGhosttyRuntime(
        """
        split-preserve-zoom = navigation
        """
      )
      let host = TerminalHostState(runtime: runtime)
      let setup = try makeZoomNavigationSetup(host: host)

      #expect(host.performSplitAction(.gotoSplit(direction: .next), for: setup.middleSurfaceID))
      #expect(host.selectedSurfaceView?.id == setup.lastSurfaceID)
      #expect(host.trees[setup.tabID]?.zoomed?.leftmostLeaf().id == setup.lastSurfaceID)
    }
  }

  @Test
  func gotoSplitClearsZoomOnNavigationWhenConfigIsDisabled() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let runtime = try makeGhosttyRuntime("")
      let host = TerminalHostState(runtime: runtime)
      let setup = try makeZoomNavigationSetup(host: host)

      #expect(host.performSplitAction(.gotoSplit(direction: .next), for: setup.middleSurfaceID))
      #expect(host.selectedSurfaceView?.id == setup.lastSurfaceID)
      #expect(host.trees[setup.tabID]?.zoomed == nil)
    }
  }

  @Test
  func toggleSplitZoomRestoresFirstResponderToTargetSurface() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState(runtime: GhosttyRuntime())
      let setup = try makeZoomNavigationSetup(host: host)
      let surface = try #require(host.surfaces[setup.middleSurfaceID])
      let window = NSWindow(
        contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
        styleMask: [],
        backing: .buffered,
        defer: false
      )
      let container = NSView(frame: window.contentView?.bounds ?? .zero)
      let firstResponder = PaneZoomFirstResponderView(frame: NSRect(x: 0, y: 0, width: 10, height: 10))

      window.contentView = container
      surface.frame = container.bounds
      container.addSubview(surface)
      container.addSubview(firstResponder)
      window.makeFirstResponder(firstResponder)

      #expect(host.performSplitAction(.toggleSplitZoom, for: setup.middleSurfaceID))
      await Task.yield()

      #expect(window.firstResponder === surface)
    }
  }

  private func makeZoomNavigationSetup(host: TerminalHostState) throws -> ZoomNavigationSetup {
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

    let firstSurfaceID = try #require(host.selectedSurfaceView?.id)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: true,
        equalize: false,
        target: .contextPane(firstSurfaceID)
      )
    )
    let thirdPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: true,
        equalize: false,
        target: .contextPane(secondPane.paneID)
      )
    )

    let tabID = try #require(host.selectedTabID)
    let middleSurface = try #require(host.surfaces[secondPane.paneID])
    let middleNode = try #require(host.trees[tabID]?.find(id: secondPane.paneID))
    host.trees[tabID] = host.trees[tabID]?.settingZoomed(middleNode)
    host.focusSurface(middleSurface, in: tabID)

    return ZoomNavigationSetup(
      lastSurfaceID: thirdPane.paneID,
      middleSurfaceID: secondPane.paneID,
      tabID: tabID
    )
  }
}

private final class PaneZoomTestView: NSView, Identifiable {
  let id = UUID()

  init() {
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }
}

private final class PaneZoomFirstResponderView: NSView {
  override var acceptsFirstResponder: Bool { true }
}

private struct ZoomNavigationSetup {
  let lastSurfaceID: UUID
  let middleSurfaceID: UUID
  let tabID: TerminalTabID
}
