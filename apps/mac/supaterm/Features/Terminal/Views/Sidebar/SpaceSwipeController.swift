import AppKit

struct SpaceScrollSample: Equatable {
  enum Phase: Equatable {
    case began
    case changed
    case ended
    case momentum
    case momentumEnded
    case wheel
    case ignored

    init(scroll: NSEvent.Phase, momentum: NSEvent.Phase) {
      if momentum.contains(.ended) || momentum.contains(.cancelled) {
        self = .momentumEnded
      } else if !momentum.isEmpty {
        self = .momentum
      } else if scroll.contains(.began) {
        self = .began
      } else if scroll.contains(.changed) {
        self = .changed
      } else if scroll.contains(.ended) || scroll.contains(.cancelled) {
        self = .ended
      } else if scroll.isEmpty {
        self = .wheel
      } else {
        self = .ignored
      }
    }
  }

  let phase: Phase
  let deltaX: CGFloat
  let deltaY: CGFloat
  let isPrecise: Bool
  let time: TimeInterval

  init(
    phase: Phase,
    deltaX: CGFloat,
    deltaY: CGFloat = 0,
    isPrecise: Bool = true,
    time: TimeInterval
  ) {
    self.phase = phase
    self.deltaX = deltaX
    self.deltaY = deltaY
    self.isPrecise = isPrecise
    self.time = time
  }

  init(event: NSEvent) {
    self.init(
      phase: Phase(scroll: event.phase, momentum: event.momentumPhase),
      deltaX: event.scrollingDeltaX,
      deltaY: event.scrollingDeltaY,
      isPrecise: event.hasPreciseScrollingDeltas,
      time: event.timestamp
    )
  }
}

@MainActor
@Observable
final class SpaceSwipeController {
  struct PagingPosition: Equatable {
    let fractionalIndex: Double

    var floorIndex: Int { Int(fractionalIndex.rounded(.down)) }
    var ceilIndex: Int { Int(fractionalIndex.rounded(.up)) }
    var progress: Double { fractionalIndex - Double(floorIndex) }
  }

  private enum Phase {
    case idle
    case pending
    case tracking(Tracking)
    case momentum
  }

  private struct TrackedDelta {
    let time: TimeInterval
    let delta: CGFloat
  }

  private struct Tracking {
    let startIndex: Int
    var displacement: CGFloat = 0
    var deltas: [TrackedDelta] = []
    var isPastDetent = false

    var velocity: CGFloat {
      guard let first = deltas.first, let last = deltas.last, last.time > first.time else {
        return 0
      }
      return deltas.dropFirst().reduce(0) { $0 + $1.delta } / CGFloat(last.time - first.time)
    }

    mutating func accumulate(_ delta: CGFloat, at time: TimeInterval) {
      displacement += delta
      deltas.append(TrackedDelta(time: time, delta: delta))
      deltas.removeAll { time - $0.time > SpaceSwipeController.velocityWindow }
    }
  }

  static let settleDuration: TimeInterval = 0.25

  private static let velocityWindow: TimeInterval = 0.1
  private static let commitProgress: Double = 0.5
  private static let commitVelocity: CGFloat = 250
  private static let resistanceDivisor: Double = 3
  private static let resistanceLimit: Double = 40
  private static let wheelThreshold: CGFloat = 2
  private static let wheelInterval: TimeInterval = 0.2

  @ObservationIgnored var pageCount: () -> Int = { 1 }
  @ObservationIgnored var displayedIndex: () -> Int = { 0 }
  @ObservationIgnored var pageWidth: CGFloat = 0
  @ObservationIgnored var isRowDragActive = false
  @ObservationIgnored var isSwipeTrackingEnabled: () -> Bool = {
    NSEvent.isSwipeTrackingFromScrollEventsEnabled
  }
  @ObservationIgnored var positionChanged: ((PagingPosition) -> Void)?
  @ObservationIgnored var selected: ((Int) -> Void)?
  @ObservationIgnored var swipeSelected: ((Int) -> Void)?
  @ObservationIgnored var slide: ((Int, Int) -> Void)?

  private var phase = Phase.idle
  @ObservationIgnored private var wheelDistance: CGFloat = 0
  @ObservationIgnored private var wheelSteppedAt: TimeInterval = 0

  var isTracking: Bool {
    guard case .tracking = phase else { return false }
    return true
  }

  @discardableResult
  func handle(_ event: NSEvent) -> Bool {
    handle(SpaceScrollSample(event: event))
  }

  @discardableResult
  func handle(_ sample: SpaceScrollSample) -> Bool {
    switch sample.phase {
    case .began: begin(sample)
    case .changed: change(sample)
    case .ended: end(sample)
    case .momentum, .momentumEnded: absorbMomentum(sample)
    case .wheel: step(sample)
    case .ignored: false
    }
  }

  private var pageIndices: Range<Int> {
    0..<pageCount()
  }

  private var acceptsGesture: Bool {
    switch phase {
    case .idle, .momentum: true
    case .pending, .tracking: false
    }
  }

  private var canPage: Bool {
    !isRowDragActive && pageCount() > 1 && pageWidth > 0
  }

  private func begin(_ sample: SpaceScrollSample) -> Bool {
    guard acceptsGesture, canPage, sample.isPrecise, isSwipeTrackingEnabled() else { return false }
    phase = .pending
    return promote(sample)
  }

  private func change(_ sample: SpaceScrollSample) -> Bool {
    switch phase {
    case .pending:
      return promote(sample)
    case .tracking(let tracking):
      advance(tracking, with: sample)
      return true
    case .idle, .momentum:
      return false
    }
  }

  private func promote(_ sample: SpaceScrollSample) -> Bool {
    guard abs(sample.deltaX) > abs(sample.deltaY) else {
      if sample.deltaY != 0 { phase = .idle }
      return false
    }
    advance(Tracking(startIndex: displayedIndex()), with: sample)
    return true
  }

  private func advance(_ tracking: Tracking, with sample: SpaceScrollSample) {
    var tracking = tracking
    tracking.accumulate(sample.deltaX, at: sample.time)
    let pastDetent = isPastDetent(tracking.displacement)
    if pastDetent != tracking.isPastDetent {
      tracking.isPastDetent = pastDetent
      NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .drawCompleted)
    }
    phase = .tracking(tracking)
    positionChanged?(position(for: tracking))
  }

  private func end(_ sample: SpaceScrollSample) -> Bool {
    switch phase {
    case .pending:
      phase = .idle
      return false
    case .tracking(let tracking):
      var tracking = tracking
      tracking.accumulate(sample.deltaX, at: sample.time)
      phase = .momentum
      guard let target = commitTarget(tracking) else {
        let home = displayedIndex()
        slide?(home, home)
        return true
      }
      (swipeSelected ?? selected)?(target)
      return true
    case .idle, .momentum:
      return false
    }
  }

  private func absorbMomentum(_ sample: SpaceScrollSample) -> Bool {
    guard case .momentum = phase else { return false }
    if sample.phase == .momentumEnded { phase = .idle }
    return true
  }

  private func step(_ sample: SpaceScrollSample) -> Bool {
    guard acceptsGesture, canPage, abs(sample.deltaX) > abs(sample.deltaY) else {
      wheelDistance = 0
      return false
    }
    wheelDistance += sample.deltaX
    guard abs(wheelDistance) >= Self.wheelThreshold else { return true }
    let target = displayedIndex() + (wheelDistance < 0 ? 1 : -1)
    wheelDistance = 0
    guard sample.time - wheelSteppedAt >= Self.wheelInterval else { return true }
    wheelSteppedAt = sample.time
    guard pageIndices.contains(target) else { return true }
    selected?(target)
    return true
  }

  private func commitTarget(_ tracking: Tracking) -> Int? {
    guard tracking.displacement != 0 else { return nil }
    let step = tracking.displacement < 0 ? 1 : -1
    let target = tracking.startIndex + step
    guard pageIndices.contains(target) else { return nil }
    if isPastDetent(tracking.displacement) { return target }
    return -CGFloat(step) * tracking.velocity > Self.commitVelocity ? target : nil
  }

  private func isPastDetent(_ displacement: CGFloat) -> Bool {
    Double(abs(displacement) / pageWidth) > Self.commitProgress
  }

  private func position(for tracking: Tracking) -> PagingPosition {
    let raw = Double(tracking.startIndex) - Double(tracking.displacement / pageWidth)
    let lower = Double(max(pageIndices.lowerBound, tracking.startIndex - 1))
    let upper = Double(min(pageIndices.upperBound - 1, tracking.startIndex + 1))
    if raw < lower {
      return PagingPosition(fractionalIndex: lower - resistance(lower - raw))
    }
    if raw > upper {
      return PagingPosition(fractionalIndex: upper + resistance(raw - upper))
    }
    return PagingPosition(fractionalIndex: raw)
  }

  private func resistance(_ overflow: Double) -> Double {
    let points = min(overflow * Double(pageWidth) / Self.resistanceDivisor, Self.resistanceLimit)
    return points / Double(pageWidth)
  }
}
