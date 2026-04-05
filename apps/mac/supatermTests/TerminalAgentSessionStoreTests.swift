import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalAgentSessionStoreTests {
  @Test
  func recordsSessionSurfaceID() {
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(15),
      transcriptPollInterval: .seconds(1),
      sleep: { _ in }
    )
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())

    store.recordSession(
      agent: .claude,
      sessionID: "session-1",
      context: context,
      transcriptPath: nil
    )

    #expect(store.sessionSurfaceID(agent: .claude, sessionID: "session-1") == surfaceID)
  }

  @Test
  func runningTimeoutNotifiesDelegate() async {
    let clock = TestClock()
    let delegate = SessionStoreDelegateSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    store.delegate = delegate

    store.armRunningTimeout(agent: .codex, sessionID: "session-1", context: nil)

    await flushEffects()
    await clock.advance(by: .seconds(5))
    await flushEffects()

    #expect(delegate.expirations.count == 1)
    #expect(delegate.expirations.first?.0 == .codex)
    #expect(delegate.expirations.first?.1 == "session-1")
  }

  @Test
  func clearingSessionsCancelsPendingTimeout() async {
    let clock = TestClock()
    let delegate = SessionStoreDelegateSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    store.delegate = delegate
    let surfaceID = UUID()

    store.recordSession(
      agent: .codex,
      sessionID: "session-1",
      context: .init(surfaceID: surfaceID, tabID: UUID()),
      transcriptPath: nil
    )
    store.armRunningTimeout(agent: .codex, sessionID: "session-1", context: nil)
    store.clearSessions(for: surfaceID)

    await flushEffects()
    await clock.advance(by: .seconds(5))
    await flushEffects()

    #expect(delegate.expirations.isEmpty)
  }

  private func flushEffects() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}

@MainActor
private final class SessionStoreDelegateSpy: TerminalAgentSessionStoreDelegate {
  var expirations: [(SupatermAgentKind, String)] = []

  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didReceiveCodexTranscriptUpdate update: CodexTranscriptUpdate,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {}

  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didExpireRunningTimeoutFor agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    expirations.append((agent, sessionID))
  }
}
