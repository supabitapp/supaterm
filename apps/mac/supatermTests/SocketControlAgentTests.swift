import Clocks
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import Testing

@testable import SupatermSocketFeature
@testable import supaterm

@MainActor
struct SocketControlAgentTests {
  @Test
  func guardedSubmissionForwardsExpectationAndReturnsTypedFailure() async throws {
    let recorder = SocketReplyRecorder()
    let expected = SupatermAgentGuard(
      kind: .codex, process: SupatermAppDebugSnapshot.AgentProcess(processID: 42, startTimeMicroseconds: 100))
    let request = SocketControlClient.Request(
      handle: UUID(),
      payload: try .sendText(
        SupatermSendTextRequest(
          mode: .submit, expectedAgent: expected, target: SupatermPaneTargetRequest(paneID: UUID()),
          text: "hello\nworld"
        )
      )
    )
    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .sendText(let payload) = execution else { throw CancellationError() }
        #expect(payload.expectedAgent == expected)
        #expect(payload.text == "hello\nworld")
        throw SupatermAgentControlError.blocked
      }
    }
    await store.send(.requestReceived(request))
    let records = await recorder.snapshot()
    #expect(records.first?.response.error?.code == "agent_blocked")
  }

  @Test
  func completedWaitRepliesAndCancelsDisconnectMonitor() async throws {
    let clock = TestClock()
    let recorder = SocketReplyRecorder()
    let payload = SupatermAgentWaitRequest(target: SupatermPaneTargetRequest(paneID: UUID()))
    let result = SupatermAgentWaitResult(paneID: payload.target.paneID, outcome: .idle, matched: true, identity: nil)
    let request = SocketControlClient.Request(handle: UUID(), payload: try .waitAgent(payload))
    let store = makeStore {
      $0.continuousClock = clock
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalPane = { execution in
        guard case .waitAgent(let forwarded) = execution else { throw CancellationError() }
        #expect(forwarded == payload)
        return .waitAgent(result)
      }
    }
    let effect = await store.send(.requestReceived(request))
    await effect.finish()
    let records = await recorder.snapshot()
    #expect(try records.first?.response.decodeResult(SupatermAgentWaitResult.self) == result)
  }

  @Test
  func disconnectCancelsInFlightWaitWithoutReplying() async throws {
    let clock = TestClock()
    let pending = LockIsolated(true)
    let started = LockIsolated(false)
    let cancelled = LockIsolated(false)
    let recorder = SocketReplyRecorder()
    let request = SocketControlClient.Request(
      handle: UUID(),
      payload: try .waitAgent(SupatermAgentWaitRequest(target: SupatermPaneTargetRequest(paneID: UUID())))
    )
    let store = makeStore {
      $0.continuousClock = clock
      $0.socketControlClient.isPending = { _ in pending.value }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalPane = { _ in
        started.setValue(true)
        do {
          try await clock.sleep(for: .seconds(60))
          Issue.record("Wait should have been cancelled before its deadline")
        } catch {
          cancelled.setValue(true)
          throw error
        }
        throw CancellationError()
      }
    }
    let effect = await store.send(.requestReceived(request))
    await flushEffects()
    #expect(started.value)
    pending.setValue(false)
    await clock.advance(by: .milliseconds(100))
    await effect.finish()
    #expect(cancelled.value)
    #expect(await recorder.snapshot().isEmpty)
  }
}
