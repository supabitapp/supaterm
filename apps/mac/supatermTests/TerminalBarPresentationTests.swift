import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct TerminalBarPresentationTests {
  @Test
  func defaultLayoutRendersAgentStatus() {
    let presentation = TerminalBarPresenter.presentation(
      settings: .default,
      context: context(
        workingDirectoryPath: "/Users/khoi/code/supaterm",
        commandExitCode: 1,
        agentActivity: .init(kind: .pi, phase: .needsInput, detail: "Approve command")
      ),
      gitState: gitState(stagedCount: 1, unstagedCount: 2),
      now: Date()
    )

    #expect(presentation.left.map(\.id) == ["agent"])
    #expect(presentation.left.map(\.symbol) == ["hammer"])
    #expect(presentation.left.map(\.text) == ["needs input: Approve command"])
    #expect(presentation.left.map(\.tooltip) == ["Pi needs input: Approve command"])
    #expect(presentation.center.isEmpty)
    #expect(presentation.right.isEmpty)
  }

  @Test
  func defaultLayoutHidesWhenAgentIsAbsent() {
    let presentation = TerminalBarPresenter.presentation(
      settings: .default,
      context: context(workingDirectoryPath: nil),
      gitState: nil,
      now: Date()
    )

    #expect(presentation.isEmpty)
  }

  @Test
  func configuredWorkModulesRender() {
    let presentation = TerminalBarPresenter.presentation(
      settings: SupatermBottomBarSettings(
        enabled: true,
        left: [.directory, .gitBranch, .gitStatus],
        center: [],
        right: [.exitStatus]
      ),
      context: context(
        workingDirectoryPath: "/Users/khoi/code/supaterm",
        commandExitCode: 1
      ),
      gitState: gitState(stagedCount: 1, unstagedCount: 2),
      now: Date()
    )

    #expect(presentation.left.map(\.id) == ["directory", "git_branch", "git_status"])
    #expect(presentation.left.map(\.text) == ["supaterm", "main", "+1 ~2"])
    #expect(presentation.right.map(\.id) == ["exit_status"])
  }

  @Test
  func successfulExitStatusHides() {
    let presentation = TerminalBarPresenter.presentation(
      settings: SupatermBottomBarSettings(
        enabled: true,
        left: [],
        center: [],
        right: [.exitStatus]
      ),
      context: context(commandExitCode: 0),
      gitState: nil,
      now: Date()
    )

    #expect(presentation.right.isEmpty)
  }

  @Test
  func failedExitStatusRenders() {
    let presentation = TerminalBarPresenter.presentation(
      settings: SupatermBottomBarSettings(
        enabled: true,
        left: [],
        center: [],
        right: [.exitStatus]
      ),
      context: context(commandExitCode: 127),
      gitState: nil,
      now: Date()
    )

    #expect(presentation.right.map(\.text) == ["exit 127"])
  }

  @Test
  func configuredTimeAndCommandDurationRender() {
    let presentation = TerminalBarPresenter.presentation(
      settings: SupatermBottomBarSettings(
        enabled: true,
        left: [.commandDuration],
        center: [.time],
        right: []
      ),
      context: context(commandDuration: 1_550),
      gitState: nil,
      now: Date(timeIntervalSince1970: 1_800)
    )

    #expect(presentation.left.map(\.text) == ["1.6s"])
    #expect(presentation.center.map(\.id) == ["time"])
  }

  @Test
  func commandDurationIsAbsentFromDefault() {
    let presentation = TerminalBarPresenter.presentation(
      settings: .default,
      context: context(commandDuration: 1_550),
      gitState: gitState(),
      now: Date()
    )

    #expect(!presentation.left.map(\.id).contains("command_duration"))
    #expect(!presentation.right.map(\.id).contains("command_duration"))
  }

  private func context(
    workingDirectoryPath: String? = "/Users/khoi/code/supaterm",
    commandExitCode: Int? = nil,
    commandDuration: UInt64? = nil,
    agentActivity: TerminalHostState.AgentActivity? = nil
  ) -> TerminalBarContext {
    TerminalBarContext(
      selectedSpaceID: UUID().uuidString,
      selectedTabID: UUID().uuidString,
      focusedPaneID: UUID().uuidString,
      paneTitle: "zsh",
      workingDirectoryPath: workingDirectoryPath,
      agentActivity: agentActivity.map(TerminalBarAgentContext.init),
      commandExitCode: commandExitCode,
      commandDuration: commandDuration
    )
  }

  private func gitState(
    stagedCount: Int = 0,
    unstagedCount: Int = 0,
    untrackedCount: Int = 0,
    conflictCount: Int = 0,
    aheadCount: Int = 0,
    behindCount: Int = 0
  ) -> TerminalBarGitState {
    TerminalBarGitState(
      branch: "main",
      stagedCount: stagedCount,
      unstagedCount: unstagedCount,
      untrackedCount: untrackedCount,
      conflictCount: conflictCount,
      aheadCount: aheadCount,
      behindCount: behindCount
    )
  }
}
