import AppKit
import Foundation
import Testing

@testable import supaterm

private struct SpaceSlide: Equatable {
  let from: Int
  let to: Int
}

@MainActor
private final class SpaceSwipeHost {
  let controller = SpaceSwipeController()
  var positions: [SpaceSwipeController.PagingPosition] = []
  var selectedIndices: [Int] = []
  var slides: [SpaceSlide] = []
  var displayedIndex: Int

  init(pageCount: Int = 3, displayedIndex: Int = 1, pageWidth: CGFloat = 200) {
    self.displayedIndex = displayedIndex
    controller.pageCount = { pageCount }
    controller.pageWidth = pageWidth
    controller.isSwipeTrackingEnabled = { true }
    controller.displayedIndex = { [unowned self] in self.displayedIndex }
    controller.positionChanged = { [unowned self] position in positions.append(position) }
    controller.selected = { [unowned self] index in
      selectedIndices.append(index)
      let origin = displayedIndex
      self.displayedIndex = index
      controller.slide?(origin, index)
    }
    controller.slide = { [unowned self] origin, destination in
      slides.append(SpaceSlide(from: origin, to: destination))
    }
  }

  var fractionalIndices: [Double] {
    positions.map(\.fractionalIndex)
  }
}

@MainActor
struct SpaceSwipeControllerTests {
  private func isClose(_ value: Double, _ expected: Double) -> Bool {
    abs(value - expected) < 0.000_001
  }

  @Test
  func tracksHorizontalDragsAsFractionalPositions() {
    let host = SpaceSwipeHost()
    let controller = host.controller

    #expect(controller.handle(SpaceScrollSample(phase: .began, deltaX: -20, time: 100)))
    #expect(controller.handle(SpaceScrollSample(phase: .changed, deltaX: -90, time: 100.05)))

    #expect(controller.isTracking)
    #expect(isClose(host.fractionalIndices[0], 1.1))
    #expect(isClose(host.fractionalIndices[1], 1.55))

    let position = host.positions[1]
    #expect(position.floorIndex == 1)
    #expect(position.ceilIndex == 2)
    #expect(isClose(position.progress, 0.55))
    #expect(host.selectedIndices.isEmpty)
    #expect(host.displayedIndex == 1)
  }

  @Test
  func startsTrackingOnTheFirstHorizontalChangeAfterAnEmptyBegin() {
    let host = SpaceSwipeHost()
    let controller = host.controller

    #expect(!controller.handle(SpaceScrollSample(phase: .began, deltaX: 0, time: 600)))
    #expect(host.positions.isEmpty)

    #expect(controller.handle(SpaceScrollSample(phase: .changed, deltaX: -30, time: 600.02)))
    #expect(isClose(host.fractionalIndices[0], 1.15))
  }

  @Test
  func leavesVerticalGesturesToTheList() {
    let host = SpaceSwipeHost()
    let controller = host.controller

    #expect(!controller.handle(SpaceScrollSample(phase: .began, deltaX: 2, deltaY: 30, time: 700)))
    #expect(!controller.handle(SpaceScrollSample(phase: .changed, deltaX: -50, time: 700.02)))
    #expect(!controller.isTracking)
    #expect(host.positions.isEmpty)
  }

  @Test
  func commitsToTheNeighborWhenTheFingerLiftsPastHalfway() {
    let host = SpaceSwipeHost()
    let controller = host.controller

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -20, time: 100))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: -90, time: 100.05))
    #expect(host.displayedIndex == 1)

    #expect(controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 100.4)))

    #expect(host.selectedIndices == [2])
    #expect(host.displayedIndex == 2)
    #expect(host.slides == [SpaceSlide(from: 1, to: 2)])
    #expect(!controller.isTracking)
  }

  @Test
  func commitsOnAFlickBelowHalfway() {
    let host = SpaceSwipeHost()
    let controller = host.controller

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -10, time: 200))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: -40, time: 200.02))
    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 200.05))

    #expect(host.selectedIndices == [2])
    #expect(host.displayedIndex == 2)
    #expect(host.slides == [SpaceSlide(from: 1, to: 2)])
  }

  @Test
  func snapsBackWithoutCommittingWhenTheDragStallsBelowHalfway() {
    let host = SpaceSwipeHost()
    let controller = host.controller

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -10, time: 300))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: -20, time: 300.2))
    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 300.5))

    #expect(host.selectedIndices.isEmpty)
    #expect(host.displayedIndex == 1)
    #expect(host.slides == [SpaceSlide(from: 1, to: 1)])
  }

  @Test
  func resistsDraggingPastTheFirstPage() {
    let host = SpaceSwipeHost(displayedIndex: 0)
    let controller = host.controller

    controller.handle(SpaceScrollSample(phase: .began, deltaX: 60, time: 400))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: 540, time: 400.05))

    #expect(isClose(host.fractionalIndices[0], -0.1))
    #expect(isClose(host.fractionalIndices[1], -0.2))

    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 400.4))
    #expect(host.selectedIndices.isEmpty)
    #expect(host.slides == [SpaceSlide(from: 0, to: 0)])
  }

  @Test
  func clampsToOnePageFromTheGestureStart() {
    let host = SpaceSwipeHost(pageCount: 5)

    host.controller.handle(SpaceScrollSample(phase: .began, deltaX: -600, time: 500))

    #expect(isClose(host.fractionalIndices[0], 2.2))
  }

  @Test
  func stepsOnePagePerWheelThresholdWithinTheRateLimit() {
    let host = SpaceSwipeHost(pageCount: 4)
    let controller = host.controller

    #expect(controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -1, isPrecise: false, time: 500)))
    #expect(host.selectedIndices.isEmpty)

    controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -1, isPrecise: false, time: 500.05))
    #expect(host.selectedIndices == [2])

    controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -3, isPrecise: false, time: 500.1))
    #expect(host.selectedIndices == [2])

    controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -3, isPrecise: false, time: 500.4))
    #expect(host.selectedIndices == [2, 3])
    #expect(host.positions.isEmpty)
  }

  @Test
  func swallowsMomentumUntilItEnds() {
    let host = SpaceSwipeHost()
    let controller = host.controller

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -140, time: 800))
    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 800.1))

    #expect(controller.handle(SpaceScrollSample(phase: .momentum, deltaX: -30, time: 800.12)))
    #expect(controller.handle(SpaceScrollSample(phase: .momentumEnded, deltaX: 0, time: 800.3)))
    #expect(!controller.handle(SpaceScrollSample(phase: .momentum, deltaX: -30, time: 900)))

    #expect(host.selectedIndices == [2])
    #expect(controller.handle(SpaceScrollSample(phase: .began, deltaX: -20, time: 901)))
  }

  @Test
  func refusesToTrackWhileARowDragIsActive() {
    let host = SpaceSwipeHost()
    host.controller.isRowDragActive = true

    #expect(!host.controller.handle(SpaceScrollSample(phase: .began, deltaX: -50, time: 100)))
    #expect(!host.controller.isTracking)
    #expect(host.positions.isEmpty)
  }

  @Test
  func refusesToTrackWithoutSystemSwipeTracking() {
    let host = SpaceSwipeHost()
    host.controller.isSwipeTrackingEnabled = { false }

    #expect(!host.controller.handle(SpaceScrollSample(phase: .began, deltaX: -50, time: 100)))
    #expect(host.positions.isEmpty)
  }

  @Test
  func refusesToTrackCoarseScrollPhases() {
    let host = SpaceSwipeHost()

    #expect(
      !host.controller.handle(
        SpaceScrollSample(phase: .began, deltaX: -50, isPrecise: false, time: 100)
      )
    )
    #expect(host.positions.isEmpty)
  }

  @Test
  func readsScrollPhasesFromEvents() {
    #expect(SpaceScrollSample.Phase(scroll: .began, momentum: []) == .began)
    #expect(SpaceScrollSample.Phase(scroll: .changed, momentum: []) == .changed)
    #expect(SpaceScrollSample.Phase(scroll: .cancelled, momentum: []) == .ended)
    #expect(SpaceScrollSample.Phase(scroll: [], momentum: .changed) == .momentum)
    #expect(SpaceScrollSample.Phase(scroll: [], momentum: .ended) == .momentumEnded)
    #expect(SpaceScrollSample.Phase(scroll: [], momentum: []) == .wheel)
    #expect(SpaceScrollSample.Phase(scroll: .mayBegin, momentum: []) == .ignored)
  }
}
