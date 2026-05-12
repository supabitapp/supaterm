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
}
