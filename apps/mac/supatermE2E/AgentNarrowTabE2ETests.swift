import Foundation
import SupatermCLIShared
import Testing

struct NarrowAgentTabFixture {
  let kind: SupatermAgentKind
  let pane: SupatermPaneTargetRequest
  let prompt: String
  let promptMarker: String
  let runningRuleIDs: Set<String>
  let server: FakeModelServer
}

@Suite(
  .enabled(
    if: codexE2EEnabled && claudeE2EEnabled && piE2EEnabled,
    "Run through make mac-test-e2e E2E_AGENT=all."
  )
)
struct AgentNarrowTabE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func narrowTabsKeepEveryCodingAgentRunning() async throws {
    let app = try await SupatermE2EApp.launch(
      environment: ["CODEX_E2E_API_KEY": "test"],
      pathDirectories: try piE2EPathDirectories()
    )
    var fixtures: [NarrowAgentTabFixture] = []
    var spaceID: UUID?
    defer {
      if let spaceID {
        try? closeTestSpace(app, spaceID: spaceID)
      }
      app.terminate()
      for fixture in fixtures {
        fixture.server.stop()
      }
    }

    let space = try await makeTestSpace(app)
    spaceID = space.spaceID
    let tabs = [
      space.tab,
      try makeTab(app, in: space),
      try makeTab(app, in: space),
    ]
    for tab in tabs {
      let pane = SupatermPaneTargetRequest(paneID: tab.paneID)
      try await app.waitForShellPrompt(pane)
      for _ in 0..<3 {
        let split = try makeSplit(app, in: space, target: pane)
        try await app.waitForShellPrompt(SupatermPaneTargetRequest(paneID: split.paneID))
      }
    }

    fixtures.append(
      try await makeCodexNarrowTabFixture(
        app: app,
        space: space,
        tab: tabs[0]
      )
    )
    fixtures.append(
      try await makeClaudeNarrowTabFixture(
        app: app,
        space: space,
        tab: tabs[1]
      )
    )
    fixtures.append(
      try await makePiNarrowTabFixture(
        app: app,
        space: space,
        tab: tabs[2]
      )
    )

    for fixture in fixtures {
      try await app.submit(
        fixture.prompt,
        waitingFor: fixture.promptMarker,
        into: fixture.pane
      )
      if fixture.kind == .codex {
        try await app.waitUntil("Codex clips the reconnecting status", timeout: 10) {
          try app.capture(fixture.pane)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .contains { line in
              let text = line.trimmingCharacters(in: .whitespaces)
              return text.contains("Reconnecting...")
                && text.contains("s •")
                && text.hasSuffix("…")
            }
        }
      }
      _ = try await waitForAgentSnapshot(
        app,
        paneID: fixture.pane.paneID,
        kind: fixture.kind,
        phase: .running,
        ruleIDs: fixture.runningRuleIDs,
        timeout: 20
      )
    }

    for fixture in fixtures {
      try await assertAgentPhaseHolds(
        app,
        paneID: fixture.pane.paneID,
        kind: fixture.kind,
        phase: .running,
        for: 0.5
      )
    }
  }
}
