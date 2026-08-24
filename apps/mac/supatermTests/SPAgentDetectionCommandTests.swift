import Foundation
import SupatermCLIShared
import Testing

struct SPAgentDetectionCommandTests {
  @Test
  func explainResolvesThePaneAndPrintsRuleEvidence() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let fixture = AgentDetectionCLIFixture()
    let tree = fixture.tree
    let explanation = fixture.explanation

    try await withSocketRuntime(
      replying: { request, _ in
        switch request.method {
        case SupatermSocketMethod.appTree:
          return try .ok(id: request.id, encodableResult: tree)
        case SupatermSocketMethod.terminalAgentExplain:
          #expect(
            try request.decodeParams(SupatermAgentDetectionExplainRequest.self).target.paneID
              == fixture.paneID
          )
          return try .ok(id: request.id, encodableResult: explanation)
        default:
          return .error(id: request.id, code: "invalid_request", message: "Unexpected request")
        }
      },
      run: { endpoint in
        let result = try cli.run(["agent", "explain", "--socket", endpoint.path])

        #expect(result.exitCode == 0)
        #expect(result.stderr.isEmpty)
        #expect(result.stdout.contains("status\tresolved\n"))
        #expect(result.stdout.contains("process\t12\t34\n"))
        #expect(result.stdout.contains("matched-rule\tworking\n"))
        #expect(result.stdout.contains("rule\tmatch\t10\trunning\tosc_title\tworking\n"))
        #expect(result.stdout.contains("contains\tmatch\tbusy"))
      }
    )
  }

  @Test
  func reloadRulesPrintsEveryActiveManifestSource() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let reload = SupatermAgentDetectionReloadResult(
      generation: 42,
      overrideDirectory: "/tmp/agent-detection",
      manifests: [
        SupatermAgentDetectionManifestInfo(
          agentID: "codex",
          displayName: "Codex",
          version: "local.1",
          origin: .local,
          path: "/tmp/agent-detection/codex.toml"
        )
      ]
    )

    try await withSocketRuntime(
      replying: { request, _ in
        #expect(request.method == SupatermSocketMethod.appAgentDetectionReload)
        return try .ok(id: request.id, encodableResult: reload)
      },
      run: { endpoint in
        let result = try cli.run([
          "agent", "reload-rules", "--socket", endpoint.path,
        ])

        #expect(result.exitCode == 0)
        #expect(result.stderr.isEmpty)
        #expect(result.stdout.contains("generation\t42\n"))
        #expect(
          result.stdout.contains(
            "manifest\tcodex\tlocal.1\tlocal\t/tmp/agent-detection/codex.toml"
          )
        )
      }
    )
  }
}

private struct AgentDetectionCLIFixture {
  let paneID = UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
  let tabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!
  let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!

  var tree: SupatermTreeSnapshot {
    SupatermTreeSnapshot(
      windows: [
        SupatermTreeSnapshot.Window(
          index: 1,
          isKey: true,
          displayedSpaceID: spaceID,
          spaces: [
            SupatermTreeSnapshot.Space(
              index: 1,
              id: spaceID,
              name: "A",
              color: .neutral,
              isWarm: true,
              rootItems: [
                .tab(
                  SupatermTreeSnapshot.RootTab(
                    isPinned: false,
                    tab: SupatermTreeSnapshot.Tab(
                      id: tabID,
                      title: "agent",
                      isSelected: true,
                      panes: [
                        SupatermTreeSnapshot.Pane(index: 1, id: paneID, isFocused: true)
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

  var explanation: SupatermAgentDetectionExplainResult {
    SupatermAgentDetectionExplainResult(
      target: SupatermPaneTarget(
        windowIndex: 1,
        spaceIndex: 1,
        spaceID: spaceID,
        tabIndex: 1,
        tabID: tabID,
        paneIndex: 1,
        paneID: paneID
      ),
      status: .resolved,
      generation: 42,
      agentID: "codex",
      displayName: "Codex",
      phase: .running,
      process: SupatermAppDebugSnapshot.AgentProcess(
        processID: 12,
        startTimeMicroseconds: 34
      ),
      manifest: nil,
      matchedRuleID: "working",
      publishedRuleID: "working",
      rules: [
        SupatermAgentDetectionRuleEvidence(
          ruleID: "working",
          state: .running,
          priority: 10,
          region: "osc_title",
          matched: true,
          condition: SupatermAgentDetectionConditionEvidence(
            kind: "all",
            value: nil,
            matched: true,
            children: [
              SupatermAgentDetectionConditionEvidence(
                kind: "contains",
                value: "busy",
                matched: true,
                children: []
              )
            ]
          )
        )
      ]
    )
  }
}
