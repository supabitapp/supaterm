import Testing

@testable import supaterm

struct TerminalBarGitStateTests {
  @Test
  func parsesBranchAndStatusCounts() throws {
    let state = try #require(
      TerminalBarGitStatusParser.parse(
        """
        ## main...origin/main [ahead 2, behind 1]
        M  staged.swift
         M unstaged.swift
        ?? untracked.swift
        UU conflicted.swift
        """
      )
    )

    #expect(state.branch == "main")
    #expect(state.stagedCount == 1)
    #expect(state.unstagedCount == 1)
    #expect(state.untrackedCount == 1)
    #expect(state.conflictCount == 1)
    #expect(state.aheadCount == 2)
    #expect(state.behindCount == 1)
  }

  @Test
  func parsesInitialBranch() throws {
    let state = try #require(
      TerminalBarGitStatusParser.parse(
        """
        ## No commits yet on trunk
        A  first.swift
        """
      )
    )

    #expect(state.branch == "trunk")
    #expect(state.stagedCount == 1)
  }

  @Test
  func ignoresNonRepositoryOutput() {
    #expect(TerminalBarGitStatusParser.parse("fatal: not a git repository") == nil)
  }
}
