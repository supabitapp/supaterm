import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPAgentHookRouterTests {
  @Test
  func routingWindowFitsDetectionAndHookTimeouts() {
    #expect(SPAgentHookRouter.routingTimeout > 3)
    #expect(SPAgentHookRouter.routingTimeout < 10)
  }

  @Test
  func staleContextIsDroppedAndCandidateContextIsDelivered() throws {
    let request = routerRequest(context: RouterFixtures.staleContext)
    let destination = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )

    #expect(agentHookCandidateQueryRequest(request).context == nil)
    let selected = try #require(
      selectedAgentHookCandidate(
        request: request,
        destinations: [destination],
        roundComplete: true,
        deadlineReached: true
      )
    )
    let routed = try #require(routedAgentHookRequest(request, to: selected))

    #expect(routed.context == RouterFixtures.titleContext)
    #expect(routed.processID == 101)
    #expect(routed.processStartTimeMicroseconds == 101_000)
  }

  @Test
  func titleMatchTakesPriorityOverWorkspaceMatch() throws {
    let request = routerRequest()
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )
    let workspace = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true
    )

    let selected = selectedAgentHookCandidate(
      request: request,
      destinations: [workspace, title],
      roundComplete: true,
      deadlineReached: true
    )

    #expect(selected == title)
  }

  @Test
  func workspaceMatchRequiresACompleteDeadlineRound() {
    let request = routerRequest()
    let workspace = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true
    )

    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [workspace],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [workspace],
        roundComplete: false,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [workspace],
        roundComplete: true,
        deadlineReached: true
      ) == workspace
    )
  }

  @Test
  func duplicateWorkspaceMatchesAreRejected() {
    let request = routerRequest()
    let first = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      workingDirectoryMatches: true
    )
    let second = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true
    )

    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [first, second],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
  }

  @Test
  func ownerlessWorkspaceMatchTakesPriorityOverOwnedWorkspaceMatches() {
    let ownerless = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true
    )
    let owned = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      workingDirectoryMatches: true,
      ownedSessionID: "outer-session"
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: "startup", inheritedSessionID: "outer-session"),
        destinations: [owned, ownerless],
        roundComplete: true,
        deadlineReached: true
      ) == ownerless
    )
  }

  @Test
  func compactPrefersOwnerWhileResumeUsesTitle() {
    let owner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.sessionID
    )
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: "compact"),
        destinations: [title, owner],
        roundComplete: true,
        deadlineReached: false
      ) == owner
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: "resume"),
        destinations: [title, owner],
        roundComplete: true,
        deadlineReached: true
      ) == title
    )
  }

  @Test
  func compactOwnerCanRouteOnTheFirstCompleteRound() {
    let owner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.sessionID
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: "compact"),
        destinations: [owner],
        roundComplete: true,
        deadlineReached: false
      ) == owner
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: "compact"),
        destinations: [owner],
        roundComplete: false,
        deadlineReached: true
      ) == nil
    )
  }

  @Test
  func titleMatchRequiresACompleteDeadlineRound() {
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(),
        destinations: [title],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(),
        destinations: [title],
        roundComplete: false,
        deadlineReached: true
      ) == nil
    )
  }

  @Test
  func directEmitterProcessCanRouteOnAnIncompleteRoundAndTakesPriorityOverTitle() {
    let process = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303
    )
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(processID: 303),
        destinations: [title, process],
        roundComplete: false,
        deadlineReached: false
      ) == process
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(processID: 303),
        destinations: [title, process],
        roundComplete: true,
        deadlineReached: false
      ) == process
    )
  }

  @Test
  func duplicateDirectEmitterProcessesAreRejectedOnAnIncompleteRound() {
    let first = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303
    )
    let second = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 303
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(processID: 303),
        destinations: [first, second],
        roundComplete: false,
        deadlineReached: false
      ) == nil
    )
  }

  @Test
  func directEmitterProcessTakesPriorityOverCompactOwner() {
    let process = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101
    )
    let owner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.sessionID
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: "compact", processID: 101),
        destinations: [owner, process],
        roundComplete: true,
        deadlineReached: true
      ) == process
    )
  }

  @Test
  func sharedHostClearsCrossPaneStaleSessionWhileDirectNestedSessionRejects() throws {
    let request = routerRequest(source: "startup", inheritedSessionID: "outer-session")
    let shared = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true,
      sharedCodexHost: true
    )
    let direct = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )

    let routedShared = try #require(routedAgentHookRequest(request, to: shared))

    #expect(routedShared.inheritedSessionID == nil)
    #expect(routedAgentHookRequest(request, to: direct) == nil)
  }

  @Test
  func sharedOwnedPaneUsesExactTitleAndClearsInheritedState() throws {
    let request = routerRequest(source: "startup", inheritedSessionID: "outer-session")
    let shared = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true,
      ownedSessionID: "outer-session",
      sharedCodexHost: true
    )

    let routed = try #require(routedAgentHookRequest(request, to: shared))

    #expect(routed.inheritedSessionID == nil)
  }

  @Test
  func directOwnedPaneRejectsMismatchedInheritanceDespiteProcessEvidence() {
    let request = routerRequest(
      source: "startup",
      inheritedSessionID: "outer-session",
      processID: 101
    )
    let direct = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 101,
      ownedSessionID: "outer-session"
    )

    #expect(routedAgentHookRequest(request, to: direct) == nil)
  }

  @Test
  func directOwnedPaneRejectsMismatchedInheritanceDespiteTitleEvidence() {
    let request = routerRequest(
      source: "startup",
      inheritedSessionID: "outer-session",
      processID: 101
    )
    let direct = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 202,
      sessionIDMatchesTitle: true,
      ownedSessionID: "outer-session"
    )

    #expect(routedAgentHookRequest(request, to: direct) == nil)
  }

  @Test
  func sharedOwnedPaneRejectsWorkspaceWithoutExactTitle() {
    let shared = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 101,
      workingDirectoryMatches: true,
      ownedSessionID: "outer-session",
      sharedCodexHost: true
    )

    #expect(routedAgentHookRequest(routerRequest(source: "clear"), to: shared) == nil)
  }

  @Test
  func sharedOwnedPaneCanUseExactTitleWithoutInheritedState() {
    let shared = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 101,
      sessionIDMatchesTitle: true,
      ownedSessionID: "outer-session",
      sharedCodexHost: true
    )

    #expect(routedAgentHookRequest(routerRequest(source: "resume"), to: shared) != nil)
  }

  @Test(arguments: ["startup", "clear", "compact", "resume"])
  func ownedSessionReplacementRejectsWorkspaceAndStaleInheritance(source: String) {
    let destination = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      workingDirectoryMatches: true,
      ownedSessionID: "outer-session"
    )

    #expect(
      routedAgentHookRequest(
        routerRequest(source: source, inheritedSessionID: "outer-session"),
        to: destination
      ) == nil
    )
  }

  @Test
  func startupCannotReplaceOwnedSessionFromWorkspaceAlone() {
    let destination = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true,
      ownedSessionID: "owned-session"
    )

    #expect(
      routedAgentHookRequest(
        routerRequest(source: "startup"),
        to: destination
      ) == nil
    )
  }

  @Test
  func matchingInheritanceCannotReplaceAnOwnedSession() {
    let workspace = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true,
      ownedSessionID: "owned-session"
    )
    #expect(
      routedAgentHookRequest(
        routerRequest(source: "startup", inheritedSessionID: RouterFixtures.sessionID),
        to: workspace
      ) == nil
    )
  }

  @Test
  func ownedSessionCanBeReplacedWithExactTitle() {
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true,
      ownedSessionID: "owned-session"
    )
    #expect(routedAgentHookRequest(routerRequest(source: "resume"), to: title) != nil)
  }

  @Test
  func currentOwnerCanReceiveTheSameSession() {
    let owner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.sessionID,
      sharedCodexHost: true
    )

    #expect(routedAgentHookRequest(routerRequest(source: "compact"), to: owner) != nil)
  }

  @Test
  func ownedSessionCanBeReplacedByTheDirectEmitterProcess() throws {
    let direct = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      workingDirectoryMatches: true,
      ownedSessionID: "owned-session"
    )

    let routed = try #require(
      routedAgentHookRequest(
        routerRequest(source: "clear", processID: 303),
        to: direct
      )
    )

    #expect(routed.inheritedSessionID == nil)
  }

  @Test
  func routingPreservesNilAndMatchingInheritedSessions() throws {
    let direct = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )
    let shared = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true,
      sharedCodexHost: true
    )
    let withoutInherited = try #require(
      routedAgentHookRequest(routerRequest(), to: direct)
    )
    let matchingInherited = try #require(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: RouterFixtures.sessionID),
        to: direct
      )
    )

    #expect(withoutInherited.inheritedSessionID == nil)
    #expect(matchingInherited.inheritedSessionID == RouterFixtures.sessionID)
    #expect(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: RouterFixtures.sessionID),
        to: shared
      )?.inheritedSessionID == nil
    )
  }

}

private enum RouterFixtures {
  static let sessionID = "session-123"
  static let ownerContext = SupatermCLIContext(
    surfaceID: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA")!,
    tabID: UUID(uuidString: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAB")!
  )
  static let staleContext = SupatermCLIContext(
    surfaceID: UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB")!,
    tabID: UUID(uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBC")!
  )
  static let titleContext = SupatermCLIContext(
    surfaceID: UUID(uuidString: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC")!,
    tabID: UUID(uuidString: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCD")!
  )
  static let workspaceContext = SupatermCLIContext(
    surfaceID: UUID(uuidString: "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD")!,
    tabID: UUID(uuidString: "DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDE")!
  )
}

private func routerRequest(
  source: String = "resume",
  inheritedSessionID: String? = nil,
  processID: Int32? = nil,
  processStartTimeMicroseconds: UInt64? = nil,
  context: SupatermCLIContext? = nil
) -> SupatermAgentHookRequest {
  SupatermAgentHookRequest(
    agent: .codex,
    context: context,
    event: SupatermAgentHookEvent(
      cwd: "/tmp/workspace",
      hookEventName: .sessionStart,
      sessionID: RouterFixtures.sessionID,
      source: source,
      transcriptPath: "/tmp/transcript.jsonl"
    ),
    inheritedSessionID: inheritedSessionID,
    processID: processID,
    processStartTimeMicroseconds: processStartTimeMicroseconds
  )
}

private func routerDestination(
  context: SupatermCLIContext,
  processID: Int32,
  sessionIDMatchesTitle: Bool = false,
  workingDirectoryMatches: Bool = false,
  ownedSessionID: String? = nil,
  sharedCodexHost: Bool = false
) -> SPAgentHookCandidateDestination {
  SPAgentHookCandidateDestination(
    socketPath: "/tmp/supaterm.sock",
    candidate: SupatermAgentHookCandidate(
      context: context,
      processID: processID,
      processStartTimeMicroseconds: UInt64(processID) * 1_000,
      sessionIDMatchesTitle: sessionIDMatchesTitle,
      workingDirectoryMatches: workingDirectoryMatches,
      ownedSessionID: ownedSessionID
    ),
    sharedCodexHost: sharedCodexHost
  )
}
