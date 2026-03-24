import AppKit
import Testing

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
