import Testing

@testable import supaterm

struct AgentConversationTimelineTests {
  @Test
  func jumpResolverUsesDuplicateOccurrence() throws {
    let first = try #require(
      PaneAgentConversationTimelineItem(
        id: "first",
        role: .user,
        text: "repeat this prompt",
        occurrence: 0
      )
    )
    let second = try #require(
      PaneAgentConversationTimelineItem(
        id: "second",
        role: .user,
        text: "repeat this prompt",
        occurrence: 1
      )
    )
    let scrollback = "repeat this prompt\nother output\nrepeat this prompt\nbottom"

    #expect(
      PaneAgentTimelineJumpResolver.scrollRow(
        for: first,
        in: scrollback,
        visibleRowCount: 1,
        totalRowCount: 4
      ) == 3
    )
    #expect(
      PaneAgentTimelineJumpResolver.scrollRow(
        for: second,
        in: scrollback,
        visibleRowCount: 1,
        totalRowCount: 4
      ) == 1
    )
  }

  @Test
  func jumpResolverMatchesWrappedLines() throws {
    let item = try #require(
      PaneAgentConversationTimelineItem(
        id: "wrapped",
        role: .assistant,
        text: "please inspect the renderer bridge state now",
        occurrence: 0
      )
    )
    let scrollback = "previous\nplease inspect the renderer\nbridge state now\nbottom"

    #expect(
      PaneAgentTimelineJumpResolver.scrollRow(
        for: item,
        in: scrollback,
        visibleRowCount: 2,
        totalRowCount: 4
      ) == 1
    )
  }
}
