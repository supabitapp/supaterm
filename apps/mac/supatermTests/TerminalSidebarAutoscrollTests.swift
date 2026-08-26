import AppKit
import Testing

@testable import supaterm

struct TerminalSidebarAutoscrollTests {
  @Test
  func reducerRefreshesTheAwaitingAnchorWithoutRefreshingItsDeadline() {
    let visibleRect = CGRect(x: 0, y: 100, width: 220, height: 300)
    var state = TerminalSidebarAutoscrollState.initial

    #expect(
      TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: 120,
        visibleRect: visibleRect,
        timestamp: 10
      )
    )
    #expect(
      state
        == .awaitingIdle(
          direction: .up,
          anchorY: 120,
          deadline: 10.25
        )
    )

    #expect(
      TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: 140,
        visibleRect: visibleRect,
        timestamp: 10.1
      )
    )
    #expect(
      state
        == .awaitingIdle(
          direction: .up,
          anchorY: 140,
          deadline: 10.25
        )
    )
    #expect(TerminalSidebarAutoscrollReducer.tick(state: &state, timestamp: 10.249) == nil)
    #expect(
      TerminalSidebarAutoscrollReducer.tick(state: &state, timestamp: 10.25) == -1
    )
    #expect(
      state
        == .scrolling(
          direction: .up,
          anchorY: 140,
          signedDelta: -1
        )
    )
  }

  @Test
  func reducerUsesADirectionAwareReverseGuardAndTowardEdgeAcceleration() {
    let visibleRect = CGRect(x: 0, y: 100, width: 220, height: 300)
    var state = TerminalSidebarAutoscrollState.scrolling(
      direction: .up,
      anchorY: 120,
      signedDelta: -1
    )

    #expect(
      TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: 140,
        visibleRect: visibleRect,
        timestamp: 1
      )
    )
    #expect(state == .scrolling(direction: .up, anchorY: 120, signedDelta: -1))
    #expect(
      !TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: 140.1,
        visibleRect: visibleRect,
        timestamp: 2
      )
    )
    #expect(state == .initial)

    state = .scrolling(direction: .down, anchorY: 380, signedDelta: 1)
    #expect(
      TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: 360,
        visibleRect: visibleRect,
        timestamp: 3
      )
    )
    #expect(state == .scrolling(direction: .down, anchorY: 380, signedDelta: 1))
    #expect(
      !TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: 359.9,
        visibleRect: visibleRect,
        timestamp: 4
      )
    )
    #expect(state == .initial)

    #expect(
      TerminalSidebarAutoscrollBehavior.signedDelta(
        direction: .up,
        displacement: -4
      ) == -8
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.signedDelta(
        direction: .up,
        displacement: 4
      ) == -1
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.signedDelta(
        direction: .down,
        displacement: 4
      ) == 8
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.signedDelta(
        direction: .down,
        displacement: -4
      ) == 1
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.speed(towardEdgeDisplacement: 40) == 8
    )
  }

  @Test
  func reducerResetsOnDirectionSwitchAndStaysActiveWhenGeometryClamps() {
    let visibleRect = CGRect(x: 0, y: 100, width: 220, height: 300)
    var state = TerminalSidebarAutoscrollState.scrolling(
      direction: .up,
      anchorY: 120,
      signedDelta: -8
    )

    #expect(
      !TerminalSidebarAutoscrollReducer.update(
        state: &state,
        pointerY: 380,
        visibleRect: visibleRect,
        timestamp: 1
      )
    )
    #expect(state == .initial)

    state = .scrolling(direction: .down, anchorY: 380, signedDelta: 8)
    let beforeTick = state
    #expect(TerminalSidebarAutoscrollReducer.tick(state: &state, timestamp: 2) == 8)
    #expect(state == beforeTick)
    TerminalSidebarAutoscrollReducer.shiftAnchor(in: &state, by: 12)
    #expect(state == .scrolling(direction: .down, anchorY: 392, signedDelta: 8))
    #expect(
      TerminalSidebarScrollGeometry.constrainedY(
        500,
        documentRect: CGRect(x: 0, y: 0, width: 220, height: 500),
        viewportHeight: 300
      ) == 200
    )
  }

  @Test
  func edgesAndBoundsStayExact() {
    let visible = CGRect(x: 0, y: 100, width: 220, height: 300)
    let exactMinimum = CGRect(x: 0, y: 100, width: 220, height: 240)
    let justAboveMinimum = CGRect(x: 0, y: 100, width: 220, height: 240.1)
    let compact = CGRect(x: 0, y: 100, width: 220, height: 200)

    #expect(TerminalSidebarAutoscrollBehavior.edgeSize == 60)
    #expect(TerminalSidebarAutoscrollBehavior.activationDelay == 0.25)
    #expect(TerminalSidebarAutoscrollBehavior.directionTolerance == 20)
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(
        pointerY: exactMinimum.minY,
        visibleRect: exactMinimum
      ) == nil
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(
        pointerY: justAboveMinimum.minY + 60,
        visibleRect: justAboveMinimum
      ) == .up
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(
        pointerY: justAboveMinimum.maxY - 60,
        visibleRect: justAboveMinimum
      ) == .down
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(
        pointerY: 60,
        viewportHeight: justAboveMinimum.height
      ) == .up
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(
        pointerY: justAboveMinimum.height - 60,
        viewportHeight: justAboveMinimum.height
      ) == .down
    )
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 160, visibleRect: visible) == .up)
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: 340, visibleRect: visible) == .down
    )
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: 160.1, visibleRect: visible) == nil)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 99, visibleRect: visible) == nil)
    #expect(TerminalSidebarAutoscrollBehavior.direction(pointerY: 120, visibleRect: compact) == nil)
  }

  @Test
  func pinnedNewTabRoutesToBottomAutoscrollAndTrailingRootDrop() throws {
    let source = TerminalTabID()
    let target = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .unassigned([source, target]), isPinned: false)
      ],
      revision: 2
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let visibleRect = CGRect(x: 0, y: 100, width: 220, height: 300)
    let pointerY = TerminalSidebarPinnedDropRouting.autoscrollPointerY(in: visibleRect)
    let resolution = TerminalSidebarDropResolution(
      payload: payload,
      path: .rootBoundary(lane: .regular, index: 1),
      outline: outline
    )

    #expect(pointerY == visibleRect.maxY)
    #expect(
      TerminalSidebarAutoscrollBehavior.direction(pointerY: pointerY, visibleRect: visibleRect)
        == .down)
    #expect(resolution.path == .rootBoundary(lane: .regular, index: 1))
    #expect(resolution.plan?.destination == .root(isPinned: false, index: 1))
    #expect(resolution.plan?.placeholder == .beforeFooter)
  }
}
