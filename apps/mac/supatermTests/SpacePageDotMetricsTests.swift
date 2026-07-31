import Testing

@testable import supaterm

struct SpacePageDotMetricsTests {
  private func isClose(_ value: Double, _ expected: Double) -> Bool {
    abs(value - expected) < 0.000_001
  }

  @Test
  func emphasizesTheDotUnderTheRestingPosition() {
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 1, position: 1), 1))
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 0, position: 1), 0))
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 2, position: 1), 0))
  }

  @Test
  func splitsEmphasisBetweenTheTwoPagesUnderASwipe() {
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 1, position: 1.4), 0.6))
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 2, position: 1.4), 0.4))
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 0, position: 1.4), 0))
  }

  @Test
  func holdsTheRestingSizeWhenTheSwipeResistsPastTheEdge() {
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 1, position: -0.2), 0))
    #expect(isClose(SpacePageDotMetrics.emphasis(at: 0, position: -0.2), 0.8))
    #expect(SpacePageDotMetrics.diameter(emphasis: 0) == SpacePageDotMetrics.restDiameter)
    #expect(SpacePageDotMetrics.diameter(emphasis: 1) == SpacePageDotMetrics.displayedDiameter)
  }

  @Test
  func keepsRestingDotsFaintAndTheDisplayedOneBright() {
    #expect(isClose(SpacePageDotMetrics.opacity(emphasis: 0), SpacePageDotMetrics.restOpacity))
    #expect(isClose(SpacePageDotMetrics.opacity(emphasis: 1), SpacePageDotMetrics.displayedOpacity))
    #expect(isClose(SpacePageDotMetrics.opacity(emphasis: 0.5), 0.6))
  }
}
