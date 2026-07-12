import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalAgentMonitorStoreTests {
  @Test
  func rejectsAgentWithoutTranscriptMonitor() {
    let store = TerminalAgentMonitorStore(
      agentRunningTimeout: .seconds(5),
      transcriptEventDelay: .zero,
      sleep: { _ in },
      updates: { _ in AsyncStream { $0.finish() } }
    )

    #expect(
      !store.track(
        agent: .pi,
        sessionID: "session-1",
        transcriptPath: "/tmp/transcript.jsonl",
        context: nil
      )
    )
  }

  @Test
  func publishesEachDistinctSnapshotOnce() async {
    let (updates, continuation) = AsyncStream<AgentTranscriptUpdate>.makeStream()
    let events = MonitorStoreEventsSpy()
    let store = TerminalAgentMonitorStore(
      agentRunningTimeout: .seconds(5),
      transcriptEventDelay: .zero,
      sleep: { _ in },
      updates: { _ in updates }
    )
    events.bind(to: store)
    let started = codexEvent(type: "task_started", turnID: "turn-1")
    continuation.yield(started)

    #expect(
      store.track(
        agent: .codex,
        sessionID: "session-1",
        transcriptPath: "/tmp/transcript.jsonl",
        context: nil
      )
    )
    await flushEffects()
    continuation.yield(started)
    await flushEffects()

    #expect(events.snapshots.map(\.status) == [.started("turn-1")])

    continuation.yield(codexAssistantMessage("Inspecting state"))
    await flushEffects()

    #expect(events.snapshots.map(\.detail) == [nil, "Inspecting state"])
  }

  @Test
  func finishingStreamStopsTracking() async {
    let (updates, continuation) = AsyncStream<AgentTranscriptUpdate>.makeStream()
    let store = TerminalAgentMonitorStore(
      agentRunningTimeout: .seconds(5),
      transcriptEventDelay: .zero,
      sleep: { _ in },
      updates: { _ in updates }
    )

    #expect(
      store.track(
        agent: .codex,
        sessionID: "session-1",
        transcriptPath: "/tmp/transcript.jsonl",
        context: nil
      )
    )
    continuation.finish()
    await flushEffects()

    #expect(!store.isTracking(agent: .codex, sessionID: "session-1"))
  }

  @Test
  func clearSessionsCancelsTimeoutWithoutTranscriptTracking() async {
    let clock = TestClock()
    let events = MonitorStoreEventsSpy()
    let store = TerminalAgentMonitorStore(
      agentRunningTimeout: .seconds(5),
      transcriptEventDelay: .zero,
      sleep: { duration in try await clock.sleep(for: duration) },
      updates: { _ in AsyncStream { $0.finish() } }
    )
    events.bind(to: store)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())

    store.armRunningTimeout(agent: .claude, sessionID: "session-1", context: context)
    await flushEffects()
    store.clearSessions(for: context.surfaceID)
    await clock.advance(by: .seconds(5))
    await flushEffects()

    #expect(events.expirations.isEmpty)
  }

  @Test
  func transcriptGrowthExtendsArmedTimeout() async {
    let clock = TestClock()
    let (updates, continuation) = AsyncStream<AgentTranscriptUpdate>.makeStream()
    let events = MonitorStoreEventsSpy()
    let store = TerminalAgentMonitorStore(
      agentRunningTimeout: .seconds(3),
      transcriptEventDelay: .zero,
      sleep: { duration in try await clock.sleep(for: duration) },
      updates: { _ in updates }
    )
    events.bind(to: store)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    #expect(
      store.track(
        agent: .codex,
        sessionID: "session-1",
        transcriptPath: "/tmp/transcript.jsonl",
        context: context
      )
    )
    store.armRunningTimeout(agent: .codex, sessionID: "session-1", context: context)
    await flushEffects()

    await clock.advance(by: .seconds(2))
    continuation.yield(codexEvent(type: "task_started", turnID: "turn-1"))
    await flushEffects()
    await clock.advance(by: .seconds(2))
    await flushEffects()

    #expect(events.expirations.isEmpty)

    await clock.advance(by: .seconds(1))
    await flushEffects()

    #expect(events.expirations.map(\.sessionID) == ["session-1"])
    #expect(events.expirations.map(\.agent) == [.codex])
  }

  private func codexEvent(type: String, turnID: String) -> AgentTranscriptUpdate {
    let payload: JSONObject = [
      "turn_id": .string(turnID),
      "type": .string(type),
    ]
    return AgentTranscriptUpdate(
      objects: [
        [
          "payload": .object(payload),
          "type": .string("event_msg"),
        ]
      ]
    )
  }

  private func codexAssistantMessage(_ message: String) -> AgentTranscriptUpdate {
    let payload: JSONObject = [
      "content": .array([.object(["text": .string(message)])]),
      "role": .string("assistant"),
      "type": .string("message"),
    ]
    return AgentTranscriptUpdate(
      objects: [
        [
          "payload": .object(payload),
          "type": .string("response_item"),
        ]
      ]
    )
  }
}

@MainActor
private final class MonitorStoreEventsSpy {
  struct Expiration {
    let agent: SupatermAgentKind
    let sessionID: String
  }

  var expirations: [Expiration] = []
  var snapshots: [AgentMonitorSnapshot] = []

  func bind(to store: TerminalAgentMonitorStore) {
    store.onMonitorSnapshot = { [weak self] snapshot, _, _, _ in
      self?.snapshots.append(snapshot)
    }
    store.onRunningTimeoutExpired = { [weak self] agent, sessionID, _ in
      self?.expirations.append(Expiration(agent: agent, sessionID: sessionID))
    }
  }
}
