import ArgumentParser
import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPInternalAgentExplainCommandTests {
  @Test
  func parserAcceptsOnlyTheInternalPathWithOptionalPaneAndOutputOptions() throws {
    let current = try #require(
      try SP.parseAsRoot(["internal", "agent", "explain"])
        as? SP.Internal.Agent.Explain
    )
    let selected = try #require(
      try SP.parseAsRoot([
        "internal", "agent", "explain", "1/2/3", "--json", "--quiet",
      ]) as? SP.Internal.Agent.Explain
    )

    #expect(throws: (any Error).self) {
      try SP.parseAsRoot(["agent", "explain"])
    }
    #expect(current.pane == nil)
    #expect(selected.pane == .path(spaceIndex: 1, tabIndex: 2, paneIndex: 3))
    #expect(selected.options.output.json)
    #expect(selected.options.output.quiet)
  }

  @Test
  func formattersRenderStablePlainAndReadableHumanOutput() {
    let result = agentExplainTestResult()

    #expect(
      agentExplainPlain(result)
        == "1/1/1\tfallback\tno_rule_match_or_settling\tclaude\tneeds_input\t42\t123\tembedded\t7\tclaude.needs-input"
    )
    #expect(
      agentExplainHuman(result) == """
        Pane 1/1/1
        Detection: fallback (no rule match or settling)
        Agent: Claude [claude], needs input
        Process: 42, started 123
        Rules: embedded generation 7, matched claude.needs-input
        """
    )
  }

  @Test
  func formattersOmitUnavailableDetailsWithoutChangingPlainColumns() {
    let result = SupatermAgentExplainResult(
      target: agentExplainTestTarget(),
      mode: .none,
      status: .noForegroundProcess,
      rules: nil,
      agent: nil,
      process: nil,
      ruleID: nil
    )

    #expect(
      agentExplainPlain(result)
        == "1/1/1\tnone\tno_foreground_process\t-\t-\t-\t-\t-\t-\t-"
    )
    #expect(
      agentExplainHuman(result) == """
        Pane 1/1/1
        Detection: none (no foreground process)
        """
    )
  }

  @Test
  func commandResolvesFreshTreeAndRendersEveryOutputMode() async throws {
    var cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()
    let snapshot = agentExplainTreeSnapshot()
    let result = agentExplainTestResult()
    cli.environment[SupatermCLIEnvironment.surfaceIDKey] = result.target.paneID.uuidString
    cli.environment[SupatermCLIEnvironment.tabIDKey] = result.target.tabID.uuidString
    let configuredCLI = cli

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        switch request.method {
        case SupatermSocketMethod.appTree:
          return try .ok(id: request.id, encodableResult: snapshot)
        case SupatermSocketMethod.terminalAgentExplain:
          return try .ok(id: request.id, encodableResult: result)
        default:
          return .error(id: request.id, code: "invalid_request", message: request.method)
        }
      },
      run: { endpoint in
        let socket = ["--socket", endpoint.path]
        let human = try configuredCLI.run(["internal", "agent", "explain"] + socket)
        let plain = try configuredCLI.run(
          [
            "internal", "agent", "explain", agentExplainPaneID.uuidString, "--plain",
          ] + socket)
        let json = try configuredCLI.run(
          ["internal", "agent", "explain", "1/1/1", "--json"] + socket)
        let quiet = try configuredCLI.run(
          ["internal", "agent", "explain", "1/1/1", "--quiet"] + socket)

        #expect(human == SPCLIResult(exitCode: 0, stdout: agentExplainHuman(result) + "\n", stderr: ""))
        #expect(plain == SPCLIResult(exitCode: 0, stdout: agentExplainPlain(result) + "\n", stderr: ""))
        #expect(json.exitCode == 0)
        #expect(json.stderr.isEmpty)
        #expect(
          try JSONDecoder().decode(
            SupatermAgentExplainResult.self,
            from: Data(json.stdout.utf8)
          ) == result
        )
        #expect(quiet == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
      }
    )

    #expect(
      log.requests.map(\.method) == [
        SupatermSocketMethod.appTree,
        SupatermSocketMethod.terminalAgentExplain,
        SupatermSocketMethod.appTree,
        SupatermSocketMethod.terminalAgentExplain,
        SupatermSocketMethod.appTree,
        SupatermSocketMethod.terminalAgentExplain,
        SupatermSocketMethod.appTree,
        SupatermSocketMethod.terminalAgentExplain,
      ]
    )
    for request in log.requests where request.method == SupatermSocketMethod.terminalAgentExplain {
      #expect(
        try request.decodeParams(SupatermPaneTargetRequest.self)
          == SupatermPaneTargetRequest(paneID: agentExplainPaneID)
      )
    }
  }
}

private func agentExplainTreeSnapshot() -> SupatermTreeSnapshot {
  let target = agentExplainTestTarget()
  return SupatermTreeSnapshot(
    windows: [
      SupatermTreeSnapshot.Window(
        index: target.windowIndex,
        isKey: true,
        displayedSpaceID: target.spaceID,
        spaces: [
          SupatermTreeSnapshot.Space(
            index: target.spaceIndex,
            id: target.spaceID,
            name: "Work",
            color: .neutral,
            isWarm: true,
            rootItems: [
              .tab(
                SupatermTreeSnapshot.RootTab(
                  isPinned: false,
                  tab: SupatermTreeSnapshot.Tab(
                    id: target.tabID,
                    title: "Agent",
                    isSelected: true,
                    panes: [
                      SupatermTreeSnapshot.Pane(
                        index: target.paneIndex,
                        id: target.paneID,
                        isFocused: true
                      )
                    ]
                  )
                )
              )
            ]
          )
        ]
      )
    ]
  )
}
