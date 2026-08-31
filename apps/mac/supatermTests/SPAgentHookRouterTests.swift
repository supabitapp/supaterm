import Darwin
import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI
@testable import SupatermSocketFeature

struct SPAgentHookRouterTests {
  @Test
  func sessionStartQueriesEveryDiscoveredEndpointBeforeRouting() async throws {
    let rootURL = try makeSocketClientTemporaryDirectory()
    let baseEnvironment = [
      SupatermCLIEnvironment.testHomeKey: rootURL.appendingPathComponent("home").path,
      SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
    ]
    let firstEndpoint = try #require(
      SupatermProcessSocketEndpoint.make(
        environment: baseEnvironment.merging(
          [SupatermCLIEnvironment.instanceNameKey: "first"],
          uniquingKeysWith: { _, value in value }
        ),
        endpointID: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
        processID: getpid(),
        startedAt: Date(timeIntervalSince1970: 1),
        rootDirectory: rootURL
      )
    )
    let secondEndpoint = try #require(
      SupatermProcessSocketEndpoint.make(
        environment: baseEnvironment.merging(
          [SupatermCLIEnvironment.instanceNameKey: "second"],
          uniquingKeysWith: { _, value in value }
        ),
        endpointID: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
        processID: getpid(),
        startedAt: Date(timeIntervalSince1970: 2),
        rootDirectory: rootURL
      )
    )
    let firstLog = SPSocketRequestLog()
    let secondLog = SPSocketRequestLog()
    let firstRuntime = SocketControlRuntime(endpointProvider: { firstEndpoint })
    let secondRuntime = SocketControlRuntime(endpointProvider: { secondEndpoint })
    let firstCandidate = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      socketPath: firstEndpoint.path
    ).candidate
    let firstResponder = try await startSocketResponder(
      runtime: firstRuntime,
      endpoint: firstEndpoint,
      replying: routerReply(
        candidates: [firstCandidate],
        log: firstLog
      )
    )
    let secondResponder: Task<Void, Never>
    do {
      secondResponder = try await startSocketResponder(
        runtime: secondRuntime,
        endpoint: secondEndpoint,
        replying: routerReply(candidates: [], log: secondLog)
      )
    } catch {
      firstResponder.cancel()
      await firstRuntime.stop()
      try? FileManager.default.removeItem(at: rootURL)
      throw error
    }

    do {
      var routingEnvironment = baseEnvironment
      routingEnvironment[SupatermCLIEnvironment.socketPathKey] = "/tmp/inherited.sock"
      try SPAgentHookRouter(
        connection: SPConnectionOptions(),
        environment: routingEnvironment
      ).receive(routerRequest(source: .startup, processID: 303))

      #expect(
        firstLog.requests.map(\.method)
          == [
            SupatermSocketMethod.systemIdentity,
            SupatermSocketMethod.terminalAgentHookCandidates,
            SupatermSocketMethod.terminalAgentHook,
          ]
      )
      #expect(
        secondLog.requests.map(\.method)
          == [
            SupatermSocketMethod.systemIdentity,
            SupatermSocketMethod.terminalAgentHookCandidates,
          ]
      )
    } catch {
      firstResponder.cancel()
      secondResponder.cancel()
      await firstRuntime.stop()
      await secondRuntime.stop()
      try? FileManager.default.removeItem(at: rootURL)
      throw error
    }

    firstResponder.cancel()
    secondResponder.cancel()
    await firstRuntime.stop()
    await secondRuntime.stop()
    try? FileManager.default.removeItem(at: rootURL)
  }

  @Test
  func routeCarriesTitleReasonAndDeliversCandidateIdentity() throws {
    let request = routerRequest(context: RouterFixtures.staleContext)
    let destination = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      sessionIDMatchesTitle: true
    )

    let route = try #require(
      selectedAgentHookRoute(
        request: request,
        destinations: [destination],
        roundComplete: true,
        deadlineReached: true
      )
    )
    let routed = try #require(routedAgentHookRequest(request, route: route))

    #expect(route.destination == destination)
    #expect(route.reason == .title)
    #expect(routed.context == RouterFixtures.titleContext)
    #expect(
      routed.process
        == .detected(
          SupatermAgentProcessIdentity(
            processID: 101,
            startTimeMicroseconds: 101_000
          )
        )
    )
  }

  @Test
  func deadlineFallbackPrefersTitleThenUniqueEligibleWorkspace() throws {
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

    #expect(
      selectedAgentHookRoute(
        request: request,
        destinations: [title, workspace],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookRoute(
        request: request,
        destinations: [title, workspace],
        roundComplete: false,
        deadlineReached: true
      ) == nil
    )
    let titleRoute = try #require(
      selectedAgentHookRoute(
        request: request,
        destinations: [workspace, title],
        roundComplete: true,
        deadlineReached: true
      )
    )
    let workspaceRoute = try #require(
      selectedAgentHookRoute(
        request: request,
        destinations: [workspace],
        roundComplete: true,
        deadlineReached: true
      )
    )

    #expect(titleRoute.destination == title)
    #expect(titleRoute.reason == .title)
    #expect(workspaceRoute.destination == workspace)
    #expect(workspaceRoute.reason == .workspace)
  }

  @Test
  func workspaceFallbackRequiresOneUnownedOrCurrentOwner() throws {
    let ownerless = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 101,
      workingDirectoryMatches: true
    )
    let currentOwner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 202,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.sessionID
    )
    let otherOwner = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 303,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.otherSessionID
    )

    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .clear),
        destinations: [otherOwner, ownerless],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    let currentOwnerRoute = try #require(
      selectedAgentHookRoute(
        request: routerRequest(source: .clear),
        destinations: [currentOwner],
        roundComplete: true,
        deadlineReached: true
      )
    )
    #expect(currentOwnerRoute.reason == .workspace)
    #expect(routedAgentHookRequest(routerRequest(source: .clear), route: currentOwnerRoute) != nil)
  }

  @Test
  func compactOwnerRoutesOnFirstCompleteRoundWhileResumeWaitsForDeadline() throws {
    let owner = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.sessionID
    )

    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .compact),
        destinations: [owner],
        roundComplete: false,
        deadlineReached: false
      ) == nil
    )
    let route = try #require(
      selectedAgentHookRoute(
        request: routerRequest(source: .compact),
        destinations: [owner],
        roundComplete: true,
        deadlineReached: false
      )
    )
    #expect(route.destination == owner)
    #expect(route.reason == .compactOwner)
    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .resume),
        destinations: [owner],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
  }

  @Test
  func directEmitterRoutesOnIncompleteRoundAndRejectsDuplicates() throws {
    let process = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303
    )
    let duplicate = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 303,
      socketPath: "/tmp/supaterm-other.sock"
    )

    let route = try #require(
      selectedAgentHookRoute(
        request: routerRequest(processID: 303),
        destinations: [process],
        roundComplete: false,
        deadlineReached: false
      )
    )
    #expect(route.reason == .emitterProcess)
    #expect(route.destination == process)
    #expect(
      selectedAgentHookRoute(
        request: routerRequest(processID: 303),
        destinations: [process, duplicate],
        roundComplete: false,
        deadlineReached: false
      ) == nil
    )
  }

  @Test
  func startupForkUsesGlobalParentOwnerAcrossAppInstances() throws {
    let fork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      forkParentSessionID: RouterFixtures.parentSessionID,
      workingDirectoryMatches: true,
      sharedCodexHost: true,
      socketPath: "/tmp/supaterm-fork.sock"
    )
    let parent = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.parentSessionID,
      sharedCodexHost: true,
      socketPath: "/tmp/supaterm-parent.sock"
    )

    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .startup),
        destinations: [parent, fork],
        roundComplete: false,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .startup),
        destinations: [parent, fork],
        roundComplete: true,
        deadlineReached: false
      ) == nil
    )
    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .resume),
        destinations: [parent, fork],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    let route = try #require(
      selectedAgentHookRoute(
        request: routerRequest(source: .startup),
        destinations: [parent, fork],
        roundComplete: true,
        deadlineReached: true
      )
    )

    #expect(route.destination == fork)
    #expect(route.reason == .startupFork)
  }

  @Test
  func startupForkRejectsMissingWrongOrSameProcessParent() {
    let fork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      forkParentSessionID: RouterFixtures.parentSessionID,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let wrongParent = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.otherSessionID,
      sharedCodexHost: true
    )
    let sameProcessParent = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 202,
      ownedSessionID: RouterFixtures.parentSessionID,
      sharedCodexHost: true
    )

    for destinations in [[fork], [wrongParent, fork], [sameProcessParent, fork]] {
      #expect(
        selectedAgentHookRoute(
          request: routerRequest(source: .startup),
          destinations: destinations,
          roundComplete: true,
          deadlineReached: true
        ) == nil
      )
    }
  }

  @Test
  func startupForkRejectsWorkspaceCollisionAndIncomingOwner() {
    let fork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      forkParentSessionID: RouterFixtures.parentSessionID,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let parent = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.parentSessionID,
      sharedCodexHost: true
    )
    let workspace = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 404,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let incomingOwner = routerDestination(
      context: RouterFixtures.staleContext,
      processID: 505,
      ownedSessionID: RouterFixtures.sessionID,
      sharedCodexHost: true
    )

    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .startup),
        destinations: [parent, fork, workspace],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .startup),
        destinations: [parent, fork, incomingOwner],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
  }

  @Test
  func sharedNestedTitleCannotReplaceOwnedSessionWithoutGlobalForkLineage() throws {
    let title = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      ownedSessionMatchesProcess: false,
      sessionIDMatchesTitle: true,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.parentSessionID,
      sharedCodexHost: true
    )
    let titleRoute = SPAgentHookRoute(destination: title, reason: .title)

    #expect(
      selectedAgentHookRoute(
        request: routerRequest(source: .startup),
        destinations: [title],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
    #expect(routedAgentHookRequest(routerRequest(source: .startup), route: titleRoute) == nil)

    let fork = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      forkParentSessionID: RouterFixtures.parentSessionID,
      sessionIDMatchesTitle: true,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.parentSessionID,
      sharedCodexHost: true
    )
    let parent = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.parentSessionID,
      sharedCodexHost: true,
      socketPath: "/tmp/supaterm-parent.sock"
    )
    let forkRoute = try #require(
      selectedAgentHookRoute(
        request: routerRequest(source: .startup),
        destinations: [parent, fork],
        roundComplete: true,
        deadlineReached: true
      )
    )

    #expect(forkRoute.reason == .startupFork)
    #expect(routedAgentHookRequest(routerRequest(source: .startup), route: forkRoute) != nil)
  }

  @Test
  func sharedTitleMayReplaceOwnedSessionFromTheSameProcess() throws {
    let title = routerDestination(
      context: RouterFixtures.workspaceContext,
      processID: 202,
      ownedSessionMatchesProcess: true,
      sessionIDMatchesTitle: true,
      workingDirectoryMatches: true,
      ownedSessionID: RouterFixtures.parentSessionID,
      sharedCodexHost: true
    )
    let route = try #require(
      selectedAgentHookRoute(
        request: routerRequest(source: .clear),
        destinations: [title],
        roundComplete: true,
        deadlineReached: true
      )
    )

    #expect(route.reason == .title)
    #expect(routedAgentHookRequest(routerRequest(source: .clear), route: route) != nil)
  }

  @Test
  func directTitleAndEmitterReasonsMayReplaceOwnedSession() {
    let title = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 202,
      sessionIDMatchesTitle: true,
      ownedSessionID: RouterFixtures.otherSessionID
    )
    let emitter = routerDestination(
      context: RouterFixtures.ownerContext,
      processID: 303,
      ownedSessionID: RouterFixtures.otherSessionID
    )

    #expect(
      routedAgentHookRequest(
        routerRequest(),
        route: SPAgentHookRoute(destination: title, reason: .title)
      ) != nil
    )
    #expect(
      routedAgentHookRequest(
        routerRequest(processID: 303),
        route: SPAgentHookRoute(destination: emitter, reason: .emitterProcess)
      ) != nil
    )
    #expect(
      routedAgentHookRequest(
        routerRequest(),
        route: SPAgentHookRoute(destination: title, reason: .workspace)
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
      context: RouterFixtures.workspaceContext,
      processID: 202,
      workingDirectoryMatches: true,
      sharedCodexHost: true
    )
    let directRoute = SPAgentHookRoute(destination: direct, reason: .title)
    let sharedRoute = SPAgentHookRoute(destination: shared, reason: .workspace)
    let matching = try #require(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: RouterFixtures.sessionID),
        route: directRoute
      )
    )
    let sharedMismatch = try #require(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: RouterFixtures.otherSessionID),
        route: sharedRoute
      )
    )

    #expect(matching.inheritedSessionID == RouterFixtures.sessionID)
    #expect(
      routedAgentHookRequest(
        routerRequest(inheritedSessionID: RouterFixtures.otherSessionID),
        route: directRoute
      ) == nil
    )
    #expect(sharedMismatch.inheritedSessionID == nil)
  }

  @Test
  func invalidProcessIdentityCannotRoute() {
    let invalid = routerDestination(
      context: RouterFixtures.titleContext,
      processID: 0,
      startTimeMicroseconds: 0,
      sessionIDMatchesTitle: true
    )

    #expect(
      selectedAgentHookRoute(
        request: routerRequest(),
        destinations: [invalid],
        roundComplete: true,
        deadlineReached: true
      ) == nil
    )
  }

  @Test
  func managedSocketOwnerRequiresPositiveNumericSuffix() {
    #expect(managedSocketOwnerProcessID("/tmp/instance-default-hash-pid-42") == 42)
    #expect(managedSocketOwnerProcessID("/tmp/instance-pid-42-tail") == nil)
    #expect(managedSocketOwnerProcessID("/tmp/instance-pid-name") == nil)
    #expect(managedSocketOwnerProcessID("/tmp/instance-pid-0") == nil)
    #expect(managedSocketOwnerProcessID("/tmp/instance") == nil)
  }
}

private func routerReply(
  candidates: [SupatermAgentHookCandidate],
  log: SPSocketRequestLog
) -> @Sendable (SupatermSocketRequest, SupatermSocketEndpoint) async throws -> SupatermSocketResponse? {
  { request, endpoint in
    log.record(request)
    switch request.method {
    case SupatermSocketMethod.systemIdentity:
      return try .ok(id: request.id, encodableResult: endpoint)
    case SupatermSocketMethod.terminalAgentHookCandidates:
      return try .ok(
        id: request.id,
        encodableResult: SupatermAgentHookCandidatesResponse(
          candidates: candidates,
          sharedCodexHost: false
        )
      )
    case SupatermSocketMethod.terminalAgentHook:
      return .ok(id: request.id)
    default:
      return nil
    }
  }
}

private enum RouterFixtures {
  static let sessionID = "019c8ad3-4601-70d9-b980-311e16d7a44d"
  static let parentSessionID = "019c8ad3-4601-70d9-b980-311e16d7a44c"
  static let otherSessionID = "019c8ad3-4601-70d9-b980-311e16d7a44b"
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
    process: processID.map(SupatermAgentHookProcess.emitter)
  )
}

private func routerDestination(
  context: SupatermCLIContext,
  processID: Int32,
  startTimeMicroseconds: UInt64? = nil,
  forkParentSessionID: String? = nil,
  ownedSessionMatchesProcess: Bool = false,
  sessionIDMatchesTitle: Bool = false,
  workingDirectoryMatches: Bool = false,
  ownedSessionID: String? = nil,
  sharedCodexHost: Bool = false,
  socketPath: String = "/tmp/supaterm.sock"
) -> SPAgentHookCandidateDestination {
  SPAgentHookCandidateDestination(
    socketPath: socketPath,
    candidate: SupatermAgentHookCandidate(
      context: context,
      processIdentity: SupatermAgentProcessIdentity(
        processID: processID,
        startTimeMicroseconds: startTimeMicroseconds
          ?? UInt64(max(0, processID)) * 1_000
      ),
      forkParentSessionID: forkParentSessionID,
      ownedSessionMatchesProcess: ownedSessionMatchesProcess,
      sessionIDMatchesTitle: sessionIDMatchesTitle,
      workingDirectoryMatches: workingDirectoryMatches,
      ownedSessionID: ownedSessionID
    ),
    sharedCodexHost: sharedCodexHost
  )
}
