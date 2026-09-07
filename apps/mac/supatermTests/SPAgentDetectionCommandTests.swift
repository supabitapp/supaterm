import ArgumentParser
import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPAgentDetectionCommandTests {
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

struct SPAgentControlCommandTests {
  @Test(arguments: [
    ["pane", "send", "--expect-agent", "codex", "hello"],
    ["pane", "send", "--submit", "--expect-process", "42:100", "hello"],
    ["agent", "wait", "--expect-agent", "codex", "--expect-process", "42"],
    ["agent", "wait", "--timeout", "nan"],
    ["agent", "wait", "--timeout", "3601"],
    ["agent", "wait", "--until", "done"]
  ])
  func invalidControlOptionsAreRejected(_ arguments: [String]) {
    #expect(throws: (any Error).self) { try SP.parseAsRoot(arguments) }
  }

  @Test
  func guardedInputPreservesMultilineTextAndProcessIdentity() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "pane", "send", "--submit", "--expect-agent", "codex", "--expect-process", "42:100",
        "1/2/3", "first\nsecond"
      ]) as? SP.SendText)
    #expect(command.arguments == ["1/2/3", "first\nsecond"])
    #expect(
      try command.agentGuard.value()
        == SupatermAgentGuard(
          kind: .codex, process: SupatermAppDebugSnapshot.AgentProcess(processID: 42, startTimeMicroseconds: 100)
        ))
  }

  @Test(arguments: [true, false])
  func waitPreservesJSONOnSuccessAndFailure(_ matched: Bool) async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let paneID = UUID()
    let result = SupatermAgentWaitResult(
      paneID: paneID, outcome: matched ? .idle : .replaced, matched: matched,
      identity: SupatermAgentIdentity(
        kind: .codex, process: SupatermAppDebugSnapshot.AgentProcess(processID: 42, startTimeMicroseconds: 100))
    )
    let spaceID = UUID()
    let snapshot = SupatermTreeSnapshot(windows: [
      SupatermTreeSnapshot.Window(
        index: 1, isKey: true, displayedSpaceID: spaceID,
        spaces: [
          SupatermTreeSnapshot.Space(
            index: 1, id: spaceID, name: "Work", color: .neutral, isWarm: true,
            rootItems: [
              .tab(
                SupatermTreeSnapshot.RootTab(
                  isPinned: false,
                  tab: SupatermTreeSnapshot.Tab(
                    id: UUID(), title: "agent", isSelected: true,
                    panes: [SupatermTreeSnapshot.Pane(index: 1, id: paneID, isFocused: true)]
                  )
                )
              )
            ]
          )
        ]
      )
    ])
    try await withSocketRuntime(
      replying: { request, _ in
        if request.method == SupatermSocketMethod.appTree {
          return try .ok(id: request.id, encodableResult: snapshot)
        }
        #expect(request.method == SupatermSocketMethod.terminalWaitAgent)
        let payload = try request.decodeParams(SupatermAgentWaitRequest.self)
        #expect(payload.target.paneID == paneID)
        #expect(payload.until == [.idle, .needsInput])
        #expect(payload.expectedAgent?.process?.startTimeMicroseconds == 100)
        return try .ok(id: request.id, encodableResult: result)
      },
      run: { endpoint in
        let output = try cli.run([
          "agent", "wait", paneID.uuidString, "--socket", endpoint.path, "--json",
          "--expect-agent", "codex", "--expect-process", "42:100"
        ])
        #expect(output.exitCode == (matched ? 0 : 1))
        #expect(try JSONDecoder().decode(SupatermAgentWaitResult.self, from: Data(output.stdout.utf8)) == result)
      }
    )
  }
}
