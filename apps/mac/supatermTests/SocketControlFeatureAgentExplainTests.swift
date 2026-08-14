import ComposableArchitecture
import Foundation
import SupatermSocketFeature
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureAgentExplainTests {
  @Test
  func agentExplainRequestDecodesDispatchesAndRepliesWithTypedResult() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID()
    let paneID = UUID()
    let result = agentExplainResult(paneID: paneID)
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .agentExplain(
        SupatermPaneTargetRequest(paneID: paneID),
        id: "agent-explain-1"
      )
    )
    let store = makeStore(
      updateDependencies: {
        $0.socketControlClient.reply = { handle, response in
          await recorder.record(handle: handle, response: response)
        }
      },
      executeTerminalPane: { request in
        guard case .agentExplain(let target) = request else {
          Issue.record("Expected an agent explain request.")
          throw TerminalControlError.contextPaneNotFound
        }
        #expect(target == TerminalPaneTarget(paneID: paneID))
        return .agentExplain(result)
      }
    )

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(
      try records.first?.response.decodeResult(SupatermAgentExplainResult.self)
        == result
    )
  }

  @Test
  func agentExplainRejectsTheWrongExecutorResult() async throws {
    let recorder = SocketReplyRecorder()
    let paneID = UUID()
    let request = SocketControlClient.Request(
      handle: UUID(),
      payload: try .agentExplain(SupatermPaneTargetRequest(paneID: paneID))
    )
    let store = makeStore(
      updateDependencies: {
        $0.socketControlClient.reply = { handle, response in
          await recorder.record(handle: handle, response: response)
        }
      },
      executeTerminalPane: { _ in
        .focusPane(
          SupatermFocusPaneResult(
            isFocused: true,
            isSelectedTab: true,
            target: agentExplainTarget(paneID: paneID)
          )
        )
      }
    )

    await store.send(.requestReceived(request))

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(!response.ok)
    #expect(response.error?.code == "internal_error")
  }
}

private func agentExplainResult(paneID: UUID) -> SupatermAgentExplainResult {
  SupatermAgentExplainResult(
    target: agentExplainTarget(paneID: paneID),
    mode: .fallback,
    status: .resolved,
    rules: SupatermAgentExplainResult.Rules(source: .embedded, generation: 7),
    agent: SupatermAgentExplainResult.Agent(
      id: "codex",
      displayName: "Codex",
      phase: .needsInput
    ),
    process: SupatermAgentExplainResult.Process(
      processID: 42,
      startTimeMicroseconds: 123
    ),
    ruleID: "prompt-state"
  )
}

private func agentExplainTarget(paneID: UUID) -> SupatermPaneTarget {
  SupatermPaneTarget(
    windowIndex: 1,
    spaceIndex: 2,
    spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
    tabIndex: 3,
    tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
    paneIndex: 4,
    paneID: paneID
  )
}
