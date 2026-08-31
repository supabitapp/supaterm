import AppKit
import ComposableArchitecture
import CoreGraphics
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarResizeTests {
  @Test
  func defaultWidthTracksWindowWidth() {
    #expect(TerminalSidebarWidthPolicy.defaultWidth(for: 1_080) == 216)
    #expect(TerminalSidebarWidthPolicy.defaultWidth(for: 1_440) == 288)
    #expect(TerminalSidebarWidthPolicy.defaultWidth(for: 1_760) == 352)
  }

  @Test
  func resolvedWidthUsesSavedPointsWithinBounds() {
    #expect(TerminalSidebarWidthPolicy.resolvedWidth(preferredWidth: 320, totalWidth: 1_440) == 320)
    #expect(TerminalSidebarWidthPolicy.resolvedWidth(preferredWidth: 600, totalWidth: 1_440) == 432)
    #expect(TerminalSidebarWidthPolicy.resolvedWidth(preferredWidth: 320, totalWidth: 250) == 75)
  }

  @Test
  func dragWidthStaysWithinFractionBounds() {
    let lowerBound = TerminalSidebarResizeState(startingWidth: 144, delta: -48)
    let upperBound = TerminalSidebarResizeState(startingWidth: 432, delta: 48)

    #expect(
      TerminalSidebarWidthPolicy.displayedWidth(
        preferredWidth: 144,
        resizeState: lowerBound,
        totalWidth: 1_440
      ) == 144
    )
    #expect(
      TerminalSidebarWidthPolicy.displayedWidth(
        preferredWidth: 432,
        resizeState: upperBound,
        totalWidth: 1_440
      ) == 432
    )
    #expect(
      TerminalSidebarWidthPolicy.displayedWidth(
        preferredWidth: 144,
        resizeState: TerminalSidebarResizeState(startingWidth: 144, delta: -10_000),
        totalWidth: 1_440
      ) == 144
    )
  }

  @Test
  func releaseCollapsesAtMinimum() {
    let atMinimum = TerminalSidebarResizeState(startingWidth: 300, delta: -156)
    let belowMinimum = TerminalSidebarResizeState(startingWidth: 300, delta: -157)

    #expect(TerminalSidebarWidthPolicy.shouldCollapse(resizeState: atMinimum, totalWidth: 1_440))
    #expect(TerminalSidebarWidthPolicy.shouldCollapse(resizeState: belowMinimum, totalWidth: 1_440))
    #expect(TerminalSidebarWidthPolicy.settledWidth(for: atMinimum, totalWidth: 1_440) == 144)
  }

  @Test
  func releaseKeepsBoundedWidth() {
    let upper = TerminalSidebarResizeState(startingWidth: 432, delta: 100)

    #expect(
      TerminalSidebarWidthPolicy.displayedWidth(
        preferredWidth: 432,
        resizeState: upper,
        totalWidth: 1_440
      ) == 432
    )
    #expect(TerminalSidebarWidthPolicy.settledWidth(for: upper, totalWidth: 1_440) == 432)
  }

  @Test
  func gestureEndCommitsFinalTranslation() {
    #expect(
      SidebarResizeGestureRouting.inputs(for: .ended, delta: 72) == [
        .changed(delta: 72), .ended,
      ]
    )
    #expect(
      SidebarResizeGestureRouting.inputs(for: .cancelled, delta: 72) == [
        .changed(delta: 72), .ended,
      ]
    )
    #expect(SidebarResizeGestureRouting.inputs(for: .failed, delta: 72) == [.failed])
  }

  @Test
  func resizeHandleAcceptsFirstMouse() {
    #expect(SidebarResizeInteractionNSView().acceptsFirstMouse(for: nil))
  }

  @Test
  func accessibilityActionsResizeFromCurrentWidth() {
    let handle = SidebarResizeInteractionNSView()
    var inputs: [TerminalSidebarResizeInput] = []
    handle.sidebarWidth = 320
    handle.onInput = { inputs.append($0) }

    #expect(handle.accessibilityValue() as? NSNumber == NSNumber(value: 320))
    #expect(handle.accessibilityPerformIncrement())
    #expect(
      inputs == [.began, .changed(delta: TerminalSidebarWidthPolicy.accessibilityStep), .ended]
    )

    inputs = []
    #expect(handle.accessibilityPerformDecrement())
    #expect(
      inputs == [.began, .changed(delta: -TerminalSidebarWidthPolicy.accessibilityStep), .ended]
    )

    inputs = []
    handle.setAccessibilityValue(NSNumber(value: 280))
    #expect(inputs == [.began, .changed(delta: -40), .ended])
  }

  @Test
  func failedResizeKeepsSavedWidth() async {
    var initialState = TerminalWindowFeature.State()
    initialState.sidebarWidth = 320
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.sidebarResizeInput(.began, totalWidth: 1_440)) {
      $0.sidebarResizeState = TerminalSidebarResizeState(startingWidth: 320, delta: 0)
    }
    await store.send(.sidebarResizeInput(.changed(delta: -160), totalWidth: 1_440)) {
      $0.sidebarResizeState?.delta = -160
    }
    await store.send(.sidebarResizeInput(.failed, totalWidth: 1_440)) {
      $0.sidebarResizeState = nil
    }
  }

  @Test
  func resizeEndCommitsWidthFromDefault() async {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let sessionChangeCount = LockIsolated(0)
    terminal.onSessionChange = {
      sessionChangeCount.withValue { $0 += 1 }
    }
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.host = { terminal }
    }

    await store.send(.sidebarResizeInput(.began, totalWidth: 1_440)) {
      $0.sidebarResizeState = TerminalSidebarResizeState(startingWidth: 288, delta: 0)
    }
    await store.send(.sidebarResizeInput(.changed(delta: 72), totalWidth: 1_440)) {
      $0.sidebarResizeState?.delta = 72
    }
    await store.send(.sidebarResizeInput(.ended, totalWidth: 1_440)) {
      $0.sidebarResizeState = nil
      $0.sidebarWidth = 360
    }
    await store.finish()
    #expect(sessionChangeCount.value == 1)
  }

  @Test
  func resizeEndCollapsesAtMinimumReleaseAndRequestsSessionSave() async {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let sessionChangeCount = LockIsolated(0)
    terminal.onSessionChange = {
      sessionChangeCount.withValue { $0 += 1 }
    }
    var initialState = TerminalWindowFeature.State()
    initialState.sidebarWidth = 320
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.host = { terminal }
    }

    await store.send(.sidebarResizeInput(.began, totalWidth: 1_440)) {
      $0.sidebarResizeState = TerminalSidebarResizeState(startingWidth: 320, delta: 0)
    }
    await store.send(.sidebarResizeInput(.changed(delta: -176), totalWidth: 1_440)) {
      $0.sidebarResizeState?.delta = -176
    }
    await store.send(.sidebarResizeInput(.ended, totalWidth: 1_440)) {
      $0.isSidebarCollapsed = true
      $0.sidebarResizeState = nil
    }
    await store.finish()
    #expect(sessionChangeCount.value == 1)
  }
}
