import CoreGraphics
import Testing

@testable import supaterm

struct TerminalAgentsPopoverTests {
  @Test
  func preferredHeightUsesVisibleRows() {
    #expect(TerminalAgentsPopoverMetrics.preferredHeight(itemCount: 0) == 82)
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

  @Test
  @MainActor
  func aggregatesLiveAgentsFromEveryPane() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState.test()
    let surfaceIDs = try restoreSplitHost(host, workingDirectoryPath: "/tmp/supaterm")
    let firstSurfaceID = try #require(surfaceIDs.first)
    let secondSurfaceID = try #require(surfaceIDs.last)

    #expect(
      host.applyTestAgentActivity(
        .codex(.running, detail: "Build the popover"),
        for: firstSurfaceID,
        sessionID: "codex-session",
        processID: nil,
        workingDirectoryPath: "/tmp/supaterm"
      )
    )
    #expect(
      host.applyTestAgentActivity(
        .pi(.needsInput, detail: "Review the result"),
        for: secondSurfaceID,
        sessionID: "pi-session",
        processID: nil,
        workingDirectoryPath: "/tmp/ui-research"
      )
    )

    let items = host.agentsPopoverItems()

    #expect(items.count == 2)
    #expect(items.map(\.agentName) == ["Codex", "Pi"])
    #expect(items.map(\.task) == ["Build the popover", "Review the result"])
    #expect(items.map(\.workspace) == ["supaterm", "ui-research"])
    #expect(items.map(\.status) == [.working, .needsInput])
    #expect(Set(items.map(\.id)).count == items.count)
  }
}
