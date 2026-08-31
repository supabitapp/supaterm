import ArgumentParser
import Foundation
import SupatermCLIShared

struct SPAgentHookCandidateDestination: Equatable {
  let socketPath: String
  let candidate: SupatermAgentHookCandidate
  let sharedCodexHost: Bool
}

enum SPAgentHookRouteReason: Equatable {
  case compactOwner
  case emitterProcess
  case startupFork
  case title
  case workspace

  func permitsOwnedSessionReplacement(
    candidate: SupatermAgentHookCandidate,
    sharedCodexHost: Bool
  ) -> Bool {
    switch self {
    case .emitterProcess, .startupFork:
      true
    case .title:
      !sharedCodexHost || candidate.ownedSessionMatchesProcess
    case .compactOwner, .workspace:
      false
    }
  }
}

struct SPAgentHookRoute: Equatable {
  let destination: SPAgentHookCandidateDestination
  let reason: SPAgentHookRouteReason

  func permitsOwnedSession(_ sessionID: String) -> Bool {
    let ownedSessionID = normalizedAgentHookSessionID(destination.candidate.ownedSessionID)
    return ownedSessionID == nil || ownedSessionID == sessionID
      || reason.permitsOwnedSessionReplacement(
        candidate: destination.candidate,
        sharedCodexHost: destination.sharedCodexHost
      )
  }
}

struct SPAgentHookCandidateRound {
  let destinations: [SPAgentHookCandidateDestination]
  let isComplete: Bool
}

struct SPAgentHookRouter {
  private static let candidateConnectRetryInterval: TimeInterval = 0.02
  private static let candidateConnectRetryTimeout: TimeInterval = 0.1
  private static let candidateResponseTimeout: TimeInterval = 0.1
  private static let candidateSelectionTimeout: TimeInterval = 5
  private static let pollInterval: TimeInterval = 0.05
  static let routingTimeout: TimeInterval = 9

  let connection: SPConnectionOptions
  let environment: [String: String]

  init(
    connection: SPConnectionOptions,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) {
    self.connection = connection
    self.environment = environment
  }

  func receive(_ request: SupatermAgentHookRequest) throws {
    guard request.agent == .codex, request.event.hookEventName == .sessionStart else {
      try send(request, path: connection.explicitSocketPath, instance: connection.instance)
      return
    }
    guard let sessionStart = request.codexRootSessionStart else { return }

    let startedAt = Date()
    let selectionDeadline = startedAt.addingTimeInterval(Self.candidateSelectionTimeout)
    let routingDeadline = startedAt.addingTimeInterval(Self.routingTimeout)
    let candidateQuery = SupatermAgentHookCandidateQuery(
      sessionID: sessionStart.sessionID,
      cwd: sessionStart.cwd,
      emitterProcessID: request.process?.emitterProcessID
    )
    while true {
      let socketPaths = candidateSocketPaths(deadline: routingDeadline)
      let round =
        socketPaths.isEmpty
        ? SPAgentHookCandidateRound(destinations: [], isComplete: false)
        : candidateRound(
          socketPaths: socketPaths,
          query: candidateQuery,
          deadline: routingDeadline
        )
      let now = Date()
      let selectionDeadlineReached = now >= selectionDeadline
      if let route = selectedAgentHookRoute(
        request: request,
        destinations: round.destinations,
        roundComplete: round.isComplete,
        deadlineReached: selectionDeadlineReached
      ) {
        guard let routedRequest = routedAgentHookRequest(request, route: route) else { return }
        try send(
          routedRequest,
          path: route.destination.socketPath,
          instance: nil,
          deadline: routingDeadline
        )
        return
      }
      guard now < routingDeadline else { return }
      Thread.sleep(
        forTimeInterval: min(Self.pollInterval, max(0, routingDeadline.timeIntervalSinceNow))
      )
    }
  }

  private func candidateSocketPaths(deadline: Date) -> [String] {
    let explicitSocketPath = connection.explicitSocketPath
    let explicitInstance = connection.instance
    guard explicitSocketPath == nil || explicitInstance == nil else { return [] }
    if let explicitSocketPath,
      SupatermSocketPath.normalized(explicitSocketPath) == nil
    {
      return []
    }
    if let explicitInstance,
      SupatermSocketPath.normalized(explicitInstance) == nil
    {
      return []
    }

    var discoveryEnvironment = environment
    discoveryEnvironment.removeValue(forKey: SupatermCLIEnvironment.socketPathKey)
    if let explicitSocketPath {
      return SupatermSocketPath.normalized(explicitSocketPath).map { [$0] } ?? []
    }
    if let explicitInstance {
      return resolvedInstanceSocketPath(
        explicitInstance,
        environment: discoveryEnvironment,
        deadline: deadline
      ).map { [$0] } ?? []
    }
    return SupatermSocketPath.discoverManagedSocketPaths(
      environment: discoveryEnvironment
    )
  }

  private func resolvedInstanceSocketPath(
    _ instance: String,
    environment: [String: String],
    deadline: Date
  ) -> String? {
    var endpoints: [SupatermSocketEndpoint] = []
    for socketPath in SupatermSocketPath.discoverManagedSocketPaths(environment: environment) {
      guard Date() < deadline,
        let client = try? SPSocketClient(
          path: socketPath,
          connectRetryInterval: Self.candidateConnectRetryInterval,
          connectRetryTimeout: Self.candidateConnectRetryTimeout,
          responseTimeout: Self.candidateResponseTimeout,
          deadline: deadline
        )
      else {
        return nil
      }
      switch client.probeIdentity() {
      case .reachable(let endpoint):
        endpoints.append(endpoint)
      case .stale:
        removeDeadManagedSocketPath(socketPath)
        continue
      case .ignored:
        return nil
      }
    }
    return try? SupatermSocketTargetResolver.resolve(
      explicitPath: nil,
      environmentPath: nil,
      instance: instance,
      discoveredEndpoints: endpoints
    ).path
  }

  private func candidateRound(
    socketPaths: [String],
    query: SupatermAgentHookCandidateQuery,
    deadline: Date
  ) -> SPAgentHookCandidateRound {
    var destinations: [SPAgentHookCandidateDestination] = []
    var isComplete = true
    for socketPath in socketPaths {
      guard Date() < deadline else {
        isComplete = false
        break
      }
      do {
        let client = try SPSocketClient(
          path: socketPath,
          connectRetryInterval: Self.candidateConnectRetryInterval,
          connectRetryTimeout: Self.candidateConnectRetryTimeout,
          responseTimeout: Self.candidateResponseTimeout,
          deadline: deadline
        )
        let response = try client.send(.agentHookCandidates(query))
        guard response.ok else {
          isComplete = false
          continue
        }
        let result = try response.decodeResult(SupatermAgentHookCandidatesResponse.self)
        destinations += result.candidates.map {
          SPAgentHookCandidateDestination(
            socketPath: socketPath,
            candidate: $0,
            sharedCodexHost: result.sharedCodexHost
          )
        }
      } catch {
        isComplete = false
        if SPSocketClient.isConnectionFailure(error) {
          removeDeadManagedSocketPath(socketPath)
        }
      }
    }
    return SPAgentHookCandidateRound(
      destinations: destinations,
      isComplete: isComplete
    )
  }

  private func removeDeadManagedSocketPath(_ path: String) {
    var discoveryEnvironment = environment
    discoveryEnvironment.removeValue(forKey: SupatermCLIEnvironment.socketPathKey)
    _ = SPSocketSelection.removeManagedSocketPath(
      path,
      environment: discoveryEnvironment
    )
  }

  private func send(
    _ request: SupatermAgentHookRequest,
    path: String?,
    instance: String?,
    deadline: Date? = nil
  ) throws {
    let client: SPSocketClient
    if let deadline {
      guard let path else {
        throw ValidationError("Unable to resolve a Supaterm socket path.")
      }
      client = try SPSocketClient(path: path, deadline: deadline)
    } else {
      client = try socketClient(path: path, instance: instance)
    }
    let response = try client.send(.agentHook(request))
    guard response.ok else {
      throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
    }
  }
}

func selectedAgentHookRoute(
  request: SupatermAgentHookRequest,
  destinations: [SPAgentHookCandidateDestination],
  roundComplete: Bool,
  deadlineReached: Bool
) -> SPAgentHookRoute? {
  guard let sessionStart = request.codexRootSessionStart else { return nil }
  let destinations = destinations.filter {
    $0.candidate.processIdentity.processID > 0
      && $0.candidate.processIdentity.startTimeMicroseconds > 0
  }

  if let emitterProcessID = request.process?.emitterProcessID, emitterProcessID > 0 {
    let processMatches = destinations.filter {
      !$0.sharedCodexHost && $0.candidate.processIdentity.processID == emitterProcessID
    }
    guard processMatches.count < 2 else { return nil }
    if let processMatch = processMatches.first {
      return SPAgentHookRoute(destination: processMatch, reason: .emitterProcess)
    }
  }

  guard roundComplete else { return nil }
  if sessionStart.source == .compact {
    let owners = destinations.filter {
      normalizedAgentHookSessionID($0.candidate.ownedSessionID) == sessionStart.sessionID
    }
    guard owners.count < 2 else { return nil }
    if let owner = owners.first {
      return SPAgentHookRoute(destination: owner, reason: .compactOwner)
    }
  }
  guard deadlineReached else { return nil }
  let titleMatches = destinations.filter(\.candidate.sessionIDMatchesTitle)
  guard titleMatches.count < 2 else { return nil }
  if let titleMatch = titleMatches.first {
    let route = SPAgentHookRoute(destination: titleMatch, reason: .title)
    if route.permitsOwnedSession(sessionStart.sessionID) {
      return route
    }
  }

  if sessionStart.source == .startup,
    let fork = uniqueAgentHookStartupForkCandidate(
      destinations: destinations,
      incomingSessionID: sessionStart.sessionID
    )
  {
    return SPAgentHookRoute(destination: fork, reason: .startupFork)
  }

  guard
    !destinations.contains(where: {
      $0.candidate.workingDirectoryMatches && $0.candidate.forkParentSessionID != nil
    })
  else {
    return nil
  }
  return uniqueAgentHookWorkspaceCandidate(
    destinations: destinations,
    sessionID: sessionStart.sessionID
  ).map { SPAgentHookRoute(destination: $0, reason: .workspace) }
}

func routedAgentHookRequest(
  _ request: SupatermAgentHookRequest,
  route: SPAgentHookRoute
) -> SupatermAgentHookRequest? {
  let destination = route.destination
  guard
    let sessionStart = request.codexRootSessionStart,
    destination.candidate.processIdentity.processID > 0,
    destination.candidate.processIdentity.startTimeMicroseconds > 0
  else {
    return nil
  }
  let inheritedSessionID = normalizedAgentHookSessionID(request.inheritedSessionID)
  if !destination.sharedCodexHost,
    let inheritedSessionID,
    inheritedSessionID != sessionStart.sessionID
  {
    return nil
  }
  guard route.permitsOwnedSession(sessionStart.sessionID) else { return nil }

  return SupatermAgentHookRequest(
    agent: request.agent,
    context: destination.candidate.context,
    event: request.event,
    inheritedSessionID: !destination.sharedCodexHost
      && inheritedSessionID == sessionStart.sessionID
      ? inheritedSessionID : nil,
    process: .detected(destination.candidate.processIdentity)
  )
}

private func agentHookForkHasGlobalLineage(
  _ fork: SPAgentHookCandidateDestination,
  destinations: [SPAgentHookCandidateDestination],
  incomingSessionID: String
) -> Bool {
  guard
    let parentSessionID = normalizedAgentHookSessionID(fork.candidate.forkParentSessionID),
    parentSessionID != incomingSessionID,
    agentHookForkCandidateCanOwnSession(
      fork.candidate,
      incomingSessionID: incomingSessionID
    )
  else {
    return false
  }
  return destinations.contains { parent in
    parent != fork
      && normalizedAgentHookSessionID(parent.candidate.ownedSessionID) == parentSessionID
      && parent.candidate.processIdentity != fork.candidate.processIdentity
  }
}

private func uniqueAgentHookStartupForkCandidate(
  destinations: [SPAgentHookCandidateDestination],
  incomingSessionID: String
) -> SPAgentHookCandidateDestination? {
  let eligibleWorkspaceMatches = destinations.filter {
    $0.candidate.workingDirectoryMatches
      && agentHookForkCandidateCanOwnSession(
        $0.candidate,
        incomingSessionID: incomingSessionID
      )
  }
  guard
    eligibleWorkspaceMatches.count == 1,
    let fork = eligibleWorkspaceMatches.first,
    fork.sharedCodexHost,
    agentHookForkHasGlobalLineage(
      fork,
      destinations: destinations,
      incomingSessionID: incomingSessionID
    ),
    !destinations.contains(where: {
      $0 != fork
        && normalizedAgentHookSessionID($0.candidate.ownedSessionID) == incomingSessionID
    })
  else {
    return nil
  }
  return fork
}

private func agentHookForkCandidateCanOwnSession(
  _ candidate: SupatermAgentHookCandidate,
  incomingSessionID: String
) -> Bool {
  let ownedSessionID = normalizedAgentHookSessionID(candidate.ownedSessionID)
  let parentSessionID = normalizedAgentHookSessionID(candidate.forkParentSessionID)
  return ownedSessionID == nil || ownedSessionID == incomingSessionID
    || ownedSessionID == parentSessionID
}

private func agentHookCandidateCanOwnSession(
  _ candidate: SupatermAgentHookCandidate,
  sessionID: String
) -> Bool {
  let ownedSessionID = normalizedAgentHookSessionID(candidate.ownedSessionID)
  return ownedSessionID == nil || ownedSessionID == sessionID
}

private func uniqueAgentHookWorkspaceCandidate(
  destinations: [SPAgentHookCandidateDestination],
  sessionID: String
) -> SPAgentHookCandidateDestination? {
  let matches = destinations.filter(\.candidate.workingDirectoryMatches)
  guard matches.count == 1 else { return nil }
  let match = matches[0]
  guard agentHookCandidateCanOwnSession(match.candidate, sessionID: sessionID) else { return nil }
  return match
}

private func normalizedAgentHookSessionID(_ value: String?) -> String? {
  guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
    return nil
  }
  return value
}
