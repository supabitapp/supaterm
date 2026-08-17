import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

extension TerminalAgentStateStoreTests {
  @Test
  func piSessionStartEstablishesAuthorityBeforeBecomingActionable() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let identity = try #require(testProcessIdentity(42))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    let accepted = store.apply(
      event(
        agent: .pi,
        sessionID: "session-1",
        context: context,
        processID: identity.processID,
        action: .sessionStarted
      )
    )
    #expect(accepted)

    #expect(store.presentation(for: surfaceID, agent: .pi)?.isActionable == false)
    #expect(store.phaseAuthorityProcessIdentities(for: surfaceID) == [identity])
  }

  @Test
  func nativeChildEventDoesNotEstablishAuthority() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let identity = try #require(testProcessIdentity(42))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    store.apply(
      event(
        agent: .pi,
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    let accepted = store.apply(
      event(
        agent: .pi,
        sessionID: "session-1",
        subagentID: "child-1",
        context: context,
        processID: identity.processID,
        action: .subagentStarted(role: "reviewer")
      )
    )
    #expect(accepted)

    #expect(store.snapshots(for: surfaceID).first?.processes == [identity])
    #expect(store.phaseAuthorityProcessIdentities(for: surfaceID).isEmpty)
  }

  @Test
  func snapshotRestoreDoesNotRestoreAuthority() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let identity = try #require(testProcessIdentity(42))
    var source = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    source.apply(
      event(
        agent: .pi,
        sessionID: "session-1",
        context: context,
        processID: identity.processID,
        action: .sessionStarted
      )
    )
    var restored = TerminalAgentStateStore(processIdentity: testProcessIdentity)
    restored.restore(source.snapshots(for: surfaceID))

    #expect(restored.snapshots(for: surfaceID).first?.processes == [identity])
    #expect(restored.phaseAuthorityProcessIdentities(for: surfaceID).isEmpty)
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
        agent: .pi,
        sessionID: "session-1",
        context: context,
        processID: original.processID,
        action: .sessionStarted
      )
    )
    #expect(store.phaseAuthorityProcessIdentities(for: surfaceID) == [original])

    currentIdentity = reused
    store.apply(
      event(
        agent: .pi,
        sessionID: "session-1",
        context: context,
        processID: reused.processID,
        action: .sessionResumed
      )
    )

    #expect(store.phaseAuthorityProcessIdentities(for: surfaceID) == [reused])
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
        agent: .pi,
        sessionID: "session-1",
        context: context,
        processID: rootIdentity.processID,
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        agent: .pi,
        sessionID: "session-1",
        subagentID: "child-1",
        context: context,
        processID: childIdentity.processID,
        action: .subagentStarted(role: "reviewer")
      )
    )

    store.pruneDeadProcesses(isProcessCurrent: { $0 == childIdentity })

    #expect(store.hasSession(agent: .pi, sessionID: "session-1"))
    #expect(store.phaseAuthorityProcessIdentities(for: surfaceID).isEmpty)
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
          agent: .pi,
          sessionID: sessionID,
          context: context,
          processID: identity.processID,
          action: .sessionStarted
        )
      )
    }

    store.apply(
      event(
        agent: .pi,
        sessionID: "ended",
        context: firstContext,
        action: .sessionEnded
      )
    )
    #expect(store.phaseAuthorityProcessIdentities(for: firstSurfaceID) == [secondIdentity])

    store.clearSession(agent: .pi, sessionID: "cleared")
    #expect(store.phaseAuthorityProcessIdentities(for: firstSurfaceID).isEmpty)

    store.clearSessions(for: secondSurfaceID)
    #expect(store.phaseAuthorityProcessIdentities(for: secondSurfaceID).isEmpty)
  }

  @Test
  func onlyPiOwnsPhaseAuthority() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let piIdentity = try #require(testProcessIdentity(42))
    let codexIdentity = try #require(testProcessIdentity(43))
    let claudeIdentity = try #require(testProcessIdentity(44))
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    for (agent, identity) in [
      (SupatermAgentKind.pi, piIdentity),
      (.codex, codexIdentity),
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
      store.phaseAuthorityProcessIdentities(for: surfaceID, agent: .pi)
        == [piIdentity]
    )
    #expect(
      store.phaseAuthorityProcessIdentities(for: surfaceID, agent: .codex)
        .isEmpty
    )
    #expect(
      store.phaseAuthorityProcessIdentities(for: surfaceID, agent: .claude)
        .isEmpty
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
          agent: .pi,
          sessionID: sessionID,
          context: context,
          processID: identity.processID,
          action: .sessionStarted
        )
      )
    }

    #expect(
      store.phaseAuthorityProcessIdentities(
        for: surfaceID,
        agent: .pi,
        sessionID: "first"
      ) == [firstIdentity]
    )
    #expect(
      store.phaseAuthorityProcessIdentities(
        for: surfaceID,
        agent: .pi,
        sessionID: "second"
      ) == [secondIdentity]
    )
  }
}
