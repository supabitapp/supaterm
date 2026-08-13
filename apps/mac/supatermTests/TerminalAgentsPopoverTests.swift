import CoreGraphics
import Testing

@testable import supaterm

struct TerminalAgentsPopoverTests {
  @Test
  func preferredHeightUsesVisibleRows() {
    #expect(TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 0) == 46)
    #expect(TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 4) == 190)
    #expect(TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 8) == 334)
  }

  @Test
  func preferredHeightCapsAtEightRows() {
    #expect(TerminalAgentsPopoverMetrics.visibleItemCount(9) == 8)
    #expect(
      TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 9)
        == TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 8)
    )
  }
}
