import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalAgentPresenceStoreTests {
  @Test
  func registeredPresenceDoesNotExposeStatusActivity() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()

    let didRegister = store.register(
      agent: .claude,
      surfaceID: surfaceID,
      sessionID: "session",
      processID: 100
    )
    #expect(didRegister)

    let badges = store.badgeInstances(across: [surfaceID])
    #expect(badges.map(\.activity.kind) == [.claude])
    #expect(badges.map(\.activity.phase) == [.idle])
    #expect(store.statusInstances(for: surfaceID, surfaceIndex: 0).isEmpty)
  }

  @Test
  func activityExposesStatusForTheSurfaceAndAgent() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()

    let didSetActivity = store.setActivity(
      .claude(.running, detail: "Bash"),
      surfaceID: surfaceID,
      sessionID: "session",
      processID: 100
    )
    #expect(didSetActivity)

    let status = store.statusInstances(for: surfaceID, surfaceIndex: 0)
    #expect(status.map(\.activity) == [.claude(.running, detail: "Bash")])
  }

  @Test
  func removingLastSessionDropsPresence() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()

    let didSetActivity = store.setActivity(
      .codex(.running),
      surfaceID: surfaceID,
      sessionID: "session",
      processID: nil
    )
    let didRemove = store.remove(
      agent: .codex,
      surfaceID: surfaceID,
      sessionID: "session",
      processID: nil
    )
    #expect(didSetActivity)
    #expect(didRemove)

    #expect(store.badgeInstances(across: [surfaceID]).isEmpty)
  }

  @Test
  func panelSessionHidesRegisteredSessionUntilActionable() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()

    let didRegister = store.register(
      agent: .pi,
      surfaceID: surfaceID,
      sessionID: "session-1",
      processID: nil
    )
    #expect(didRegister)

    #expect(store.panelSession(for: surfaceID) == nil)
  }

  @Test
  func panelSessionExposesSingleActionableSessionForSurface() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()

    let didMarkActionable = store.markActionable(
      agent: .pi,
      surfaceID: surfaceID,
      sessionID: "session-1",
      processID: nil
    )
    #expect(didMarkActionable)

    #expect(
      store.panelSession(for: surfaceID)
        == PaneAgentPanelSession(agent: .pi, sessionID: "session-1")
    )
  }

  @Test
  func panelSessionHidesAmbiguousSessions() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()

    let didMarkFirst = store.markActionable(
      agent: .codex,
      surfaceID: surfaceID,
      sessionID: "session-1",
      processID: nil
    )
    let didMarkSecond = store.markActionable(
      agent: .codex,
      surfaceID: surfaceID,
      sessionID: "session-2",
      processID: nil
    )
    #expect(didMarkFirst)
    #expect(didMarkSecond)

    #expect(store.panelSession(for: surfaceID) == nil)
  }

  @Test
  func pruningDeadProcessDropsPresence() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()

    let didSetActivity = store.setActivity(
      .codex(.running),
      surfaceID: surfaceID,
      sessionID: "session",
      processID: 100
    )
    #expect(didSetActivity)

    let prunedSurfaceIDs = store.pruneDeadProcesses { _ in false }
    #expect(prunedSurfaceIDs == Set([surfaceID]))
    #expect(store.badgeInstances(across: [surfaceID]).isEmpty)
  }

  @Test
  func badgeInstancesSortAttentionBeforeRunning() {
    var store = TerminalAgentPresenceStore()
    let firstSurfaceID = UUID()
    let secondSurfaceID = UUID()

    let didSetClaude = store.setActivity(
      .claude(.running),
      surfaceID: firstSurfaceID,
      sessionID: "claude",
      processID: nil
    )
    let didSetCodex = store.setActivity(
      .codex(.needsInput),
      surfaceID: secondSurfaceID,
      sessionID: "codex",
      processID: nil
    )
    #expect(didSetClaude)
    #expect(didSetCodex)

    #expect(
      store.badgeInstances(across: [firstSurfaceID, secondSurfaceID]).map(\.activity)
        == [.codex(.needsInput), .claude(.running)]
    )
  }

  @Test
  func snapshotRestoreKeepsLiveProcessRecordsOnly() {
    var store = TerminalAgentPresenceStore()
    let surfaceID = UUID()
    let didSetActivity = store.setActivity(
      .codex(.running),
      surfaceID: surfaceID,
      sessionID: "session",
      processID: 100
    )
    #expect(didSetActivity)

    let snapshot = store.snapshot(for: surfaceID)
    var restored = TerminalAgentPresenceStore()
    #expect(restored.restore(snapshot, surfaceID: surfaceID) { $0 == 100 })
    #expect(restored.statusInstances(for: surfaceID, surfaceIndex: 0).map(\.activity) == [.codex(.running)])

    var dropped = TerminalAgentPresenceStore()
    #expect(!dropped.restore(snapshot, surfaceID: surfaceID) { _ in false })
    #expect(dropped.badgeInstances(across: [surfaceID]).isEmpty)
  }
}
