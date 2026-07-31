import AppKit
import Foundation
import Testing

@testable import supaterm

@MainActor
private final class SpaceSwipeRecorder {
  var positions: [SpaceSwipeController.PagingPosition] = []
  var settledIndices: [Int] = []
  var cancellations = 0

  init(_ controller: SpaceSwipeController) {
    controller.positionChanged = { [self] position in positions.append(position) }
    controller.settled = { [self] index in settledIndices.append(index) }
    controller.cancelled = { [self] in cancellations += 1 }
  }

  var fractionalIndices: [Double] {
    positions.map(\.fractionalIndex)
  }
}

@MainActor
struct SpaceSwipeControllerTests {
  private func makeController(
    pageCount: Int = 3,
    displayedIndex: Int = 1,
    pageWidth: CGFloat = 200
  ) -> SpaceSwipeController {
    let controller = SpaceSwipeController()
    controller.pageCount = pageCount
    controller.displayedIndex = displayedIndex
    controller.pageWidth = pageWidth
    controller.isSwipeTrackingEnabled = { true }
    return controller
  }

  private func isClose(_ value: Double, _ expected: Double) -> Bool {
    abs(value - expected) < 0.000_001
  }

  @Test
  func tracksHorizontalDragsAsFractionalPositions() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    #expect(controller.handle(SpaceScrollSample(phase: .began, deltaX: -20, time: 100)))
    #expect(controller.handle(SpaceScrollSample(phase: .changed, deltaX: -90, time: 100.05)))

    #expect(controller.isTracking)
    #expect(isClose(recorder.fractionalIndices[0], 1.1))
    #expect(isClose(recorder.fractionalIndices[1], 1.55))

    let position = recorder.positions[1]
    #expect(position.floorIndex == 1)
    #expect(position.ceilIndex == 2)
    #expect(isClose(position.progress, 0.55))
  }

  @Test
  func startsTrackingOnTheFirstHorizontalChangeAfterAnEmptyBegin() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    #expect(!controller.handle(SpaceScrollSample(phase: .began, deltaX: 0, time: 600)))
    #expect(recorder.positions.isEmpty)

    #expect(controller.handle(SpaceScrollSample(phase: .changed, deltaX: -30, time: 600.02)))
    #expect(isClose(recorder.fractionalIndices[0], 1.15))
  }

  @Test
  func leavesVerticalGesturesToTheList() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    #expect(!controller.handle(SpaceScrollSample(phase: .began, deltaX: 2, deltaY: 30, time: 700)))
    #expect(!controller.handle(SpaceScrollSample(phase: .changed, deltaX: -50, time: 700.02)))
    #expect(!controller.isTracking)
    #expect(recorder.positions.isEmpty)
  }

  @Test
  func commitsToTheNeighborPastHalfway() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -20, time: 100))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: -90, time: 100.05))
    #expect(controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 100.4)))

    #expect(recorder.settledIndices == [2])
    #expect(recorder.cancellations == 0)
    #expect(controller.displayedIndex == 2)
    #expect(!controller.isTracking)
  }

  @Test
  func commitsOnAFlickBelowHalfway() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -10, time: 200))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: -40, time: 200.02))
    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 200.05))

    #expect(recorder.settledIndices == [2])
    #expect(controller.displayedIndex == 2)
  }

  @Test
  func snapsBackWhenTheDragStallsBelowHalfway() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -10, time: 300))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: -20, time: 300.2))
    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 300.5))

    #expect(recorder.settledIndices.isEmpty)
    #expect(recorder.cancellations == 1)
    #expect(controller.displayedIndex == 1)
  }

  @Test
  func resistsDraggingPastTheFirstPage() {
    let controller = makeController(displayedIndex: 0)
    let recorder = SpaceSwipeRecorder(controller)

    controller.handle(SpaceScrollSample(phase: .began, deltaX: 60, time: 400))
    controller.handle(SpaceScrollSample(phase: .changed, deltaX: 540, time: 400.05))

    #expect(isClose(recorder.fractionalIndices[0], -0.1))
    #expect(isClose(recorder.fractionalIndices[1], -0.2))

    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 400.4))
    #expect(recorder.settledIndices.isEmpty)
    #expect(recorder.cancellations == 1)
  }

  @Test
  func clampsToOnePageFromTheGestureStart() {
    let controller = makeController(pageCount: 5)
    let recorder = SpaceSwipeRecorder(controller)

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -600, time: 500))

    #expect(isClose(recorder.fractionalIndices[0], 2.2))
  }

  @Test
  func stepsOnePagePerWheelThresholdWithinTheRateLimit() {
    let controller = makeController(pageCount: 4)
    let recorder = SpaceSwipeRecorder(controller)

    #expect(controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -1, isPrecise: false, time: 500)))
    #expect(recorder.settledIndices.isEmpty)

    controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -1, isPrecise: false, time: 500.05))
    #expect(recorder.settledIndices == [2])

    controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -3, isPrecise: false, time: 500.1))
    #expect(recorder.settledIndices == [2])

    controller.handle(SpaceScrollSample(phase: .wheel, deltaX: -3, isPrecise: false, time: 500.4))
    #expect(recorder.settledIndices == [2, 3])
    #expect(recorder.positions.isEmpty)
  }

  @Test
  func swallowsMomentumUntilItEnds() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    controller.handle(SpaceScrollSample(phase: .began, deltaX: -140, time: 800))
    controller.handle(SpaceScrollSample(phase: .ended, deltaX: 0, time: 800.1))

    #expect(controller.handle(SpaceScrollSample(phase: .momentum, deltaX: -30, time: 800.12)))
    #expect(controller.handle(SpaceScrollSample(phase: .momentumEnded, deltaX: 0, time: 800.3)))
    #expect(!controller.handle(SpaceScrollSample(phase: .momentum, deltaX: -30, time: 900)))

    #expect(recorder.settledIndices == [2])
    #expect(controller.handle(SpaceScrollSample(phase: .began, deltaX: -20, time: 901)))
  }

  @Test
  func refusesToTrackWhileARowDragIsActive() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)
    controller.isRowDragActive = true

    #expect(!controller.handle(SpaceScrollSample(phase: .began, deltaX: -50, time: 100)))
    #expect(!controller.isTracking)
    #expect(recorder.positions.isEmpty)
  }

  @Test
  func refusesToTrackWithoutSystemSwipeTracking() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)
    controller.isSwipeTrackingEnabled = { false }

    #expect(!controller.handle(SpaceScrollSample(phase: .began, deltaX: -50, time: 100)))
    #expect(recorder.positions.isEmpty)
  }

  @Test
  func refusesToTrackCoarseScrollPhases() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    #expect(
      !controller.handle(
        SpaceScrollSample(phase: .began, deltaX: -50, isPrecise: false, time: 100)
      )
    )
    #expect(recorder.positions.isEmpty)
  }

  @Test
  func pagesProgrammaticallyWithinTheCatalog() {
    let controller = makeController()
    let recorder = SpaceSwipeRecorder(controller)

    #expect(controller.page(by: 1))
    #expect(recorder.settledIndices == [2])
    #expect(controller.displayedIndex == 2)

    #expect(!controller.page(by: 1))
    #expect(recorder.settledIndices == [2])
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
