import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

extension TerminalAgentStateStoreTests {
  @Test
  func nativeSessionStartEstablishesAuthorityBeforeBecomingActionable() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let identity = try #require(testProcessIdentity(42))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    let accepted = store.apply(
      event(
        sessionID: "session-1",
        context: context,
        processID: identity.processID,
        action: .sessionStarted
      )
    )
    #expect(accepted)

    #expect(store.presentation(for: surfaceID, agent: .codex)?.isActionable == false)
    #expect(store.nativeHookAuthorityProcessIdentities(for: surfaceID) == [identity])
  }

  @Test
  func nativeChildEventDoesNotEstablishAuthority() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let identity = try #require(testProcessIdentity(42))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    let accepted = store.apply(
      event(
        sessionID: "session-1",
        subagentID: "child-1",
        context: context,
        processID: identity.processID,
        action: .subagentStarted(role: "reviewer")
      )
    )
    #expect(accepted)

    #expect(store.snapshots(for: surfaceID).first?.processes == [identity])
    #expect(store.nativeHookAuthorityProcessIdentities(for: surfaceID).isEmpty)
  }

  @Test
  func snapshotRestoreDoesNotRestoreAuthority() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let identity = try #require(testProcessIdentity(42))
    var source = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    source.apply(
      event(
        sessionID: "session-1",
        context: context,
        processID: identity.processID,
        action: .sessionStarted
      )
    )
    var restored = TerminalAgentStateStore(processIdentity: testProcessIdentity)
    restored.restore(source.snapshots(for: surfaceID))

    #expect(restored.snapshots(for: surfaceID).first?.processes == [identity])
    #expect(restored.nativeHookAuthorityProcessIdentities(for: surfaceID).isEmpty)
  }

  @Test
  func laterNativeRootEventReplacesReusedProcessAuthority() {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let original = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let reused = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    var currentIdentity = original
    var store = TerminalAgentStateStore { processID in
      processID == currentIdentity.processID ? currentIdentity : nil
    }

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        processID: original.processID,
        action: .sessionStarted
      )
    )
    #expect(store.nativeHookAuthorityProcessIdentities(for: surfaceID) == [original])

    currentIdentity = reused
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        processID: reused.processID,
        action: .sessionResumed
      )
    )

    #expect(store.nativeHookAuthorityProcessIdentities(for: surfaceID) == [reused])
  }

  @Test
  func processCleanupClearsAuthorityWithoutClearingLiveSession() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let rootIdentity = try #require(testProcessIdentity(42))
    let childIdentity = try #require(testProcessIdentity(43))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        processID: rootIdentity.processID,
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        subagentID: "child-1",
        context: context,
        processID: childIdentity.processID,
        action: .subagentStarted(role: "reviewer")
      )
    )

    store.pruneDeadProcesses(isProcessCurrent: { $0 == childIdentity })

    #expect(store.hasSession(agent: .codex, sessionID: "session-1"))
    #expect(store.nativeHookAuthorityProcessIdentities(for: surfaceID).isEmpty)
  }

  @Test
  func sessionEndAndExplicitClearsRemoveAuthority() throws {
    let firstSurfaceID = UUID()
    let secondSurfaceID = UUID()
    let firstContext = SupatermCLIContext(surfaceID: firstSurfaceID, tabID: UUID())
    let secondContext = SupatermCLIContext(surfaceID: secondSurfaceID, tabID: UUID())
    let firstIdentity = try #require(testProcessIdentity(42))
    let secondIdentity = try #require(testProcessIdentity(43))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    for (sessionID, context, identity) in [
      ("ended", firstContext, firstIdentity),
      ("cleared", firstContext, secondIdentity),
      ("surface-cleared", secondContext, firstIdentity),
    ] {
      store.apply(
        event(
          sessionID: sessionID,
          context: context,
          processID: identity.processID,
          action: .sessionStarted
        )
      )
    }

    store.apply(
      event(
        sessionID: "ended",
        context: firstContext,
        action: .sessionEnded
      )
    )
    #expect(store.nativeHookAuthorityProcessIdentities(for: firstSurfaceID) == [secondIdentity])

    store.clearSession(agent: .codex, sessionID: "cleared")
    #expect(store.nativeHookAuthorityProcessIdentities(for: firstSurfaceID).isEmpty)

    store.clearSessions(for: secondSurfaceID)
    #expect(store.nativeHookAuthorityProcessIdentities(for: secondSurfaceID).isEmpty)
  }

  @Test
  func authorityQueryCanFilterAgent() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let codexIdentity = try #require(testProcessIdentity(42))
    let claudeIdentity = try #require(testProcessIdentity(43))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    for (agent, identity) in [
      (SupatermAgentKind.codex, codexIdentity),
      (.claude, claudeIdentity),
    ] {
      store.apply(
        event(
          agent: agent,
          sessionID: agent.rawValue,
          context: context,
          processID: identity.processID,
          action: .sessionStarted
        )
      )
    }

    #expect(
      store.nativeHookAuthorityProcessIdentities(for: surfaceID, agent: .codex)
        == [codexIdentity]
    )
    #expect(
      store.nativeHookAuthorityProcessIdentities(for: surfaceID, agent: .claude)
        == [claudeIdentity]
    )
  }

  @Test
  func authorityQueryCanFilterOneSession() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let firstIdentity = try #require(testProcessIdentity(42))
    let secondIdentity = try #require(testProcessIdentity(43))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    for (sessionID, identity) in [
      ("first", firstIdentity),
      ("second", secondIdentity),
    ] {
      store.apply(
        event(
          sessionID: sessionID,
          context: context,
          processID: identity.processID,
          action: .sessionStarted
        )
      )
    }

    #expect(
      store.nativeHookAuthorityProcessIdentities(
        for: surfaceID,
        agent: .codex,
        sessionID: "first"
      ) == [firstIdentity]
    )
    #expect(
      store.nativeHookAuthorityProcessIdentities(
        for: surfaceID,
        agent: .codex,
        sessionID: "second"
      ) == [secondIdentity]
    )
  }
}
