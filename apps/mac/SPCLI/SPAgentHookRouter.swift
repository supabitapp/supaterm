import ArgumentParser
import Foundation
import SupatermCLIShared

struct SPAgentHookCandidateDestination: Equatable {
  let socketPath: String
  let candidate: SupatermAgentHookCandidate
  let sharedCodexHost: Bool
}

struct SPAgentHookCandidateRound {
  let destinations: [SPAgentHookCandidateDestination]
  let isComplete: Bool
  let staleSocketPaths: [String]
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
    guard request.event.isDurableCodexRootSessionStart else { return }

    let startedAt = Date()
    let selectionDeadline = startedAt.addingTimeInterval(Self.candidateSelectionTimeout)
    let routingDeadline = startedAt.addingTimeInterval(Self.routingTimeout)
    var socketPaths = candidateSocketPaths(deadline: routingDeadline)
    guard !socketPaths.isEmpty else { return }

    let candidateRequest = agentHookCandidateQueryRequest(request)
    while true {
      let round = candidateRound(
        socketPaths: socketPaths,
        request: candidateRequest,
        deadline: routingDeadline
      )
      socketPaths.removeAll { round.staleSocketPaths.contains($0) }
      let now = Date()
      let selectionDeadlineReached = now >= selectionDeadline
      if let destination = selectedAgentHookCandidate(
        request: request,
        destinations: round.destinations,
        roundComplete: round.isComplete,
        deadlineReached: selectionDeadlineReached
      ) {
        guard let routedRequest = routedAgentHookRequest(request, to: destination) else { return }
        try send(
          routedRequest,
          path: destination.socketPath,
          instance: nil,
          deadline: routingDeadline
        )
        return
      }
      guard now < routingDeadline, !socketPaths.isEmpty else { return }
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
        _ = SPSocketSelection.removeManagedSocketPath(
          socketPath,
          environment: environment
        )
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
    request: SupatermAgentHookRequest,
    deadline: Date
  ) -> SPAgentHookCandidateRound {
    var destinations: [SPAgentHookCandidateDestination] = []
    var isComplete = true
    var staleSocketPaths: [String] = []
    var discoveryEnvironment = environment
    discoveryEnvironment.removeValue(forKey: SupatermCLIEnvironment.socketPathKey)
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
        let response = try client.send(.agentHookCandidates(request))
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
        if SPSocketClient.isConnectionFailure(error),
          SupatermSocketPath.isManagedSocketPath(
            socketPath,
            environment: discoveryEnvironment
          )
        {
          _ = SPSocketSelection.removeManagedSocketPath(
            socketPath,
            environment: discoveryEnvironment
          )
          staleSocketPaths.append(socketPath)
        } else {
          isComplete = false
        }
      }
    }
    return SPAgentHookCandidateRound(
      destinations: destinations,
      isComplete: isComplete,
      staleSocketPaths: staleSocketPaths
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

func agentHookCandidateQueryRequest(
  _ request: SupatermAgentHookRequest
) -> SupatermAgentHookRequest {
  SupatermAgentHookRequest(
    agent: request.agent,
    event: request.event,
    inheritedSessionID: normalizedAgentHookSessionID(request.inheritedSessionID),
    processID: request.processID
  )
}

func selectedAgentHookCandidate(
  request: SupatermAgentHookRequest,
  destinations: [SPAgentHookCandidateDestination],
  roundComplete: Bool,
  deadlineReached: Bool
) -> SPAgentHookCandidateDestination? {
  guard
    request.agent == .codex,
    request.event.isDurableCodexRootSessionStart
  else {
    return nil
  }
  let destinations = destinations.filter {
    $0.candidate.processID > 0 && $0.candidate.processStartTimeMicroseconds > 0
  }

  if let processID = request.processID, processID > 0 {
    let processMatches = destinations.filter {
      !$0.sharedCodexHost && $0.candidate.processID == processID
    }
    guard processMatches.count < 2 else { return nil }
    if let processMatch = processMatches.first { return processMatch }
  }

  guard roundComplete else { return nil }
  if request.event.source == "compact" {
    let owners = destinations.filter {
      normalizedAgentHookSessionID($0.candidate.ownedSessionID) == request.event.sessionID
    }
    guard owners.count < 2 else { return nil }
    if let owner = owners.first { return owner }
  }

  guard deadlineReached else { return nil }
  let titleMatches = destinations.filter(\.candidate.sessionIDMatchesTitle)
  guard titleMatches.count < 2 else { return nil }
  if let titleMatch = titleMatches.first { return titleMatch }

  let ownerlessWorkspaceMatches = destinations.filter {
    $0.candidate.workingDirectoryMatches
      && normalizedAgentHookSessionID($0.candidate.ownedSessionID) == nil
  }
  guard ownerlessWorkspaceMatches.count < 2 else { return nil }
  if let ownerlessWorkspaceMatch = ownerlessWorkspaceMatches.first {
    return ownerlessWorkspaceMatch
  }

  let workspaceMatches = destinations.filter(\.candidate.workingDirectoryMatches)
  guard workspaceMatches.count == 1 else { return nil }
  return workspaceMatches[0]
}

func routedAgentHookRequest(
  _ request: SupatermAgentHookRequest,
  to destination: SPAgentHookCandidateDestination
) -> SupatermAgentHookRequest? {
  guard
    request.agent == .codex,
    request.event.isDurableCodexRootSessionStart,
    let sessionID = request.event.sessionID,
    destination.candidate.processID > 0,
    destination.candidate.processStartTimeMicroseconds > 0
  else {
    return nil
  }
  let inheritedSessionID = normalizedAgentHookSessionID(request.inheritedSessionID)
  let ownedSessionID = normalizedAgentHookSessionID(destination.candidate.ownedSessionID)
  let ownsIncomingSession = ownedSessionID == sessionID
  let replacesOwnedSession = ownedSessionID != nil && ownedSessionID != sessionID
  if !destination.sharedCodexHost,
    let inheritedSessionID,
    inheritedSessionID != sessionID
  {
    return nil
  }
  let directProcessMatch =
    !destination.sharedCodexHost
    && request.processID.map { $0 > 0 && $0 == destination.candidate.processID } == true
  let hasReplacementEvidence = directProcessMatch || destination.candidate.sessionIDMatchesTitle

  guard !replacesOwnedSession || hasReplacementEvidence else {
    return nil
  }
  if destination.sharedCodexHost {
    let hasIndependentBindingEvidence =
      ownsIncomingSession || destination.candidate.sessionIDMatchesTitle
      || (ownedSessionID == nil && destination.candidate.workingDirectoryMatches)
    guard hasIndependentBindingEvidence else { return nil }
  }

  return SupatermAgentHookRequest(
    agent: request.agent,
    context: destination.candidate.context,
    event: request.event,
    inheritedSessionID: !destination.sharedCodexHost && inheritedSessionID == sessionID
      ? inheritedSessionID : nil,
    processID: destination.candidate.processID,
    processStartTimeMicroseconds: destination.candidate.processStartTimeMicroseconds
  )
}

private func normalizedAgentHookSessionID(_ value: String?) -> String? {
  guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
    return nil
  }
  return value
}
