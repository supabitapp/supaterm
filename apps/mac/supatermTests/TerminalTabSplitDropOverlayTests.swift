import AppKit
import Testing

@testable import supaterm

struct TerminalTabSplitDropOverlayTests {
  @Test
  func nearestEdgeChoosesAllFourZones() {
    let size = CGSize(width: 800, height: 600)

    #expect(TerminalSplitDropZone.calculate(at: CGPoint(x: 10, y: 300), in: size) == .left)
    #expect(TerminalSplitDropZone.calculate(at: CGPoint(x: 790, y: 300), in: size) == .right)
    #expect(TerminalSplitDropZone.calculate(at: CGPoint(x: 400, y: 10), in: size) == .top)
    #expect(TerminalSplitDropZone.calculate(at: CGPoint(x: 400, y: 590), in: size) == .bottom)
  }

  @Test
  func zoneSemanticsMatchSplitTreePlacement() {
    #expect(TerminalSplitDropZone.top.opposite == .bottom)
    #expect(TerminalSplitDropZone.bottom.opposite == .top)
    #expect(TerminalSplitDropZone.left.opposite == .right)
    #expect(TerminalSplitDropZone.right.opposite == .left)
    #expect(TerminalSplitDropZone.allCases.filter(\.isHorizontal) == [.left, .right])
    #expect(TerminalSplitDropZone.allCases.filter(\.isAfter) == [.bottom, .right])
  }

  @Test @MainActor
  func tabOverlayConvertsWindowCoordinatesAndHidesWithoutATarget() {
    let shell = NSView(frame: CGRect(x: 0, y: 0, width: 800, height: 600))
    let overlay = TerminalTabSplitDropOverlayView()
    overlay.frame = shell.bounds
    shell.addSubview(overlay)
    let topPoint = overlay.convert(CGPoint(x: 400, y: 590), from: shell)

    #expect(overlay.isFlipped)
    #expect(overlay.isHidden)
    #expect(topPoint == CGPoint(x: 400, y: 10))
    #expect(overlay.target(at: topPoint) == .top)
    overlay.render(.top)
    #expect(!overlay.isHidden)
    overlay.render(nil)
    #expect(overlay.isHidden)
  }
}
