import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPAgentHookRouterTests {
  @Test
  func candidateContextAndProcessIdentityAreDelivered() throws {
    let request = routerRequest(context: RouterFixtures.staleContext)
    let destination = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )

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
  func deadlineFallbackPrefersTitleThenUniqueEligibleWorkspace() {
    let request = routerRequest()
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )
    let ownerlessWorkspace = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true
    )
    let ownedWorkspace = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.sessionID
    )
    let otherOwnedWorkspace = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 404,
      workingDirectoryMatches: true,
      ownedSessionID: "other-session"
    )

    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [title, ownerlessWorkspace, ownedWorkspace],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [title, ownerlessWorkspace, ownedWorkspace],
        roundComplete: false,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [ownedWorkspace, ownerlessWorkspace, title],
        roundComplete: true,
        deadlineReached: true
      ) == title
    )
    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [ownerlessWorkspace],
        roundComplete: true,
        deadlineReached: true
      ) == ownerlessWorkspace
    )
    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [ownedWorkspace],
        roundComplete: true,
        deadlineReached: true
      ) == ownedWorkspace
    )
    #expect(
      selectedAgentHookCandidate(
        request: request,
        destinations: [otherOwnedWorkspace],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
  }

  @Test
  func workspaceCollisionRejectsOwnerlessCandidateBesideOtherOwner() {
    let ownerless = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      workingDirectoryMatches: true
    )
    let otherOwner = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true,
      ownedSessionID: "other-session"
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .clear),
        destinations: [otherOwner, ownerless],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
  }

  @Test
  func compactOwnerRoutesOnFirstCompleteRoundWhileResumeWaitsForDeadline() {
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
        request: routerRequest(source: .compact),
        destinations: [title, owner],
        roundComplete: false,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .compact),
        destinations: [title, owner],
        roundComplete: true,
        deadlineReached: false
      ) == owner
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .resume),
        destinations: [title, owner],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .resume),
        destinations: [title, owner],
        roundComplete: true,
        deadlineReached: true
      ) == title
    )
  }

  @Test
  func startupForkLineageWaitsForCompleteDeadlineAndLosesToTitle() {
    let fork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      forksOwnedSession: true,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let parent = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      workingDirectoryMatches: true,
      ownedSessionID: "parent-session",
      sharedCodexHost: true
    )
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true,
      sharedCodexHost: true
    )
    let directFork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 404,
      forksOwnedSession: true,
      workingDirectoryMatches: true,
      sharedCodexHost: false
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [parent, fork],
        roundComplete: false,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [parent, fork],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .resume),
        destinations: [parent, fork],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [parent, directFork],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [parent, fork],
        roundComplete: true,
        deadlineReached: true
      ) == fork
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [parent, fork, title],
        roundComplete: true,
        deadlineReached: true
      ) == title
    )
  }

  @Test
  func startupForkLineageRequiresOneEligibleWorkspaceAndOneIncomingOwner() {
    let fork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      forksOwnedSession: true,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let otherFork = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      forksOwnedSession: true,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let ordinaryWorkspace = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let currentOwnerElsewhere = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 404,
      ownedSessionID: RouterFixtures.sessionID,
      sharedCodexHost: true
    )
    let retry = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 505,
      forksOwnedSession: true,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.sessionID,
      sharedCodexHost: true
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [fork, otherFork],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [fork, ordinaryWorkspace],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [fork, currentOwnerElsewhere],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [retry],
        roundComplete: true,
        deadlineReached: true
      ) == retry
    )
  }

  @Test
  func ordinaryStartupStillUsesTitleThenUniqueWorkspaceAtDeadline() {
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true,
      sharedCodexHost: true
    )
    let workspace = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [workspace, title],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [workspace, title],
        roundComplete: true,
        deadlineReached: true
      ) == title
    )
    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .startup),
        destinations: [workspace],
        roundComplete: true,
        deadlineReached: true
      ) == workspace
    )
  }

  @Test
  func directEmitterProcessRoutesOnIncompleteRoundBeforeTitleOrCompactOwner() {
    let process = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303
    )
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )
    let owner = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      ownedSessionID: RouterFixtures.sessionID
    )

    #expect(
      selectedAgentHookCandidate(
        request: routerRequest(source: .compact, processID: 303),
        destinations: [owner, title, process],
        roundComplete: false,
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
  func inheritedSessionPolicyDependsOnHostMode() throws {
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
    let matching = try #require(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: RouterFixtures.sessionID),
        to: direct
      )
    )
    let sharedMismatch = try #require(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: "outer-session"),
        to: shared
      )
    )

    #expect(routedAgentHookRequest(routerRequest(), to: direct)?.inheritedSessionID == nil)
    #expect(matching.inheritedSessionID == RouterFixtures.sessionID)
    #expect(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: "outer-session"),
        to: direct
      ) == nil
    )
    #expect(sharedMismatch.inheritedSessionID == nil)
  }

  @Test
  func workspaceFallbackDeliversOnlyToUnownedOrCurrentOwner() {
    let unowned = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 101,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let currentOwner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 202,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.sessionID,
      sharedCodexHost: true
    )
    let otherOwner = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 303,
      workingDirectoryMatches: true,
      ownedSessionID: "owned-session",
      sharedCodexHost: true
    )

    #expect(routedAgentHookRequest(routerRequest(), to: unowned) != nil)
    #expect(routedAgentHookRequest(routerRequest(), to: currentOwner) != nil)
    #expect(routedAgentHookRequest(routerRequest(), to: otherOwner) == nil)
  }

  @Test
  func sharedStartupForkLineageRoutesButCannotReplaceAnotherOwner() {
    let fork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 101,
      forksOwnedSession: true,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let otherOwner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 202,
      forksOwnedSession: true,
      workingDirectoryMatches: true,
      ownedSessionID: "owned-session",
      sharedCodexHost: true
    )

    #expect(routedAgentHookRequest(routerRequest(source: .startup), to: fork) != nil)
    #expect(routedAgentHookRequest(routerRequest(source: .startup), to: otherOwner) == nil)
  }

  @Test
  func ownedSessionReplacementRequiresTitleOrDirectEmitterProcess() {
    let workspace = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 101,
      workingDirectoryMatches: true,
      ownedSessionID: "owned-session"
    )
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 202,
      sessionIDMatchesTitle: true,
      ownedSessionID: "owned-session",
      sharedCodexHost: true
    )
    let direct = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: "owned-session"
    )

    #expect(routedAgentHookRequest(routerRequest(), to: workspace) == nil)
    #expect(routedAgentHookRequest(routerRequest(), to: title) != nil)
    #expect(routedAgentHookRequest(routerRequest(processID: 303), to: direct) != nil)
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
  source: SupatermCodexRootSessionStart.Source = .resume,
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
      source: source.rawValue,
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
  forksOwnedSession: Bool = false,
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
      forksOwnedSession: forksOwnedSession,
      sessionIDMatchesTitle: sessionIDMatchesTitle,
      workingDirectoryMatches: workingDirectoryMatches,
      ownedSessionID: ownedSessionID
    ),
    sharedCodexHost: sharedCodexHost
  )
}
