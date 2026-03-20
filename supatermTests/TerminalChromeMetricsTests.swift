import CoreGraphics
import Testing

@testable import supaterm

struct TerminalChromeMetricsTests {
  @Test
  func nestedCornerRadiusSubtractsInset() {
    #expect(TerminalChromeMetrics.nestedCornerRadius(inside: 16) == 10)
    #expect(TerminalChromeMetrics.nestedCornerRadius(inside: 22, inset: 6) == 16)
  }

  @Test
  func nestedCornerRadiusNeverGoesNegative() {
    #expect(TerminalChromeMetrics.nestedCornerRadius(inside: 4, inset: 6) == 0)
  }
}
