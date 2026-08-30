import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct Agent: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "agent",
      abstract: "Manage Supaterm coding-agent integrations.",
      discussion: SPHelp.agentDiscussion,
      subcommands: [
        InstallAgentHooks.self,
        ReloadAgentDetectionRules.self,
        RemoveAgentHooks.self,
        ReceiveAgentHook.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ReloadAgentDetectionRules: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "reload-rules",
      abstract: "Reload local agent detection manifests."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { _ in .agentDetectionReload() },
        as: SupatermAgentDetectionReloadResult.self,
        plain: renderAgentDetectionReload,
        human: renderAgentDetectionReload
      )
    }
  }

  struct InstallAgentHooks: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "install-hooks",
      abstract: "Install Supaterm's hook bridge for every supported coding agent.",
      discussion: SPHelp.installAgentHooksDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try manageAgentHooks(
        .installDetected,
        connection: connection,
      )
    }
  }

  struct ReceiveAgentHook: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "receive-agent-hook",
      abstract: "Forward one agent hook event to Supaterm.",
      discussion: SPHelp.receiveAgentHookDiscussion,
      shouldDisplay: false
    )

    @Option(name: .long, help: "Agent that emitted the hook payload.")
    var agent: SupatermAgentKind

    @Option(name: .long, help: "Process ID that emitted the hook payload.")
    var pid: Int32?

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let rawInput = FileHandle.standardInput.readDataToEndOfFile()
      let event = try agentHookEvent(from: rawInput)
      let context = SupatermCLIContext.current
      let hookRequest = SupatermAgentHookRequest(
        agent: agent,
        context: context,
        event: event,
        inheritedSessionID: inheritedCodexSessionID,
        processID: pid
      )
      if agent == .codex, context == nil, event.hookEventName == .sessionStart {
        try receiveContextlessCodexSessionStart(
          request: hookRequest,
          connection: connection
        )
        return
      }
      let request = try SupatermSocketRequest.agentHook(hookRequest)
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(request)
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
    }

    private var inheritedCodexSessionID: String? {
      guard agent == .codex,
        let sessionID = ProcessInfo.processInfo.environment[SupatermCodexEnvironment.threadIDKey],
        !sessionID.isEmpty
      else {
        return nil
      }
      return sessionID
    }
  }

  struct RemoveAgentHooks: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "remove-hooks",
      abstract: "Remove Supaterm's hook bridge from every supported coding agent.",
      discussion: SPHelp.removeAgentHooksDiscussion
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      try manageAgentHooks(
        .removeAll,
        connection: connection,
      )
    }
  }
}

extension SP {
  struct AgentSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "agent-settings",
      abstract: "Print canonical Supaterm agent hook settings.",
      discussion: SPHelp.agentSettingsDiscussion,
      subcommands: [ClaudeHookSettings.self, CodexHookSettings.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ClaudeHookSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "claude",
      abstract: "Print the canonical Claude hook settings JSON."
    )

    mutating func run() throws {
      print(try SupatermClaudeHookSettings.jsonString())
    }
  }

  struct CodexHookSettings: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "codex",
      abstract: "Print the canonical Codex hook settings JSON."
    )

    mutating func run() throws {
      print(try SupatermCodexHookSettings.jsonString())
    }
  }
}

private func agentHookEvent(from data: Data) throws -> SupatermAgentHookEvent {
  guard !data.isEmpty else {
    throw ValidationError("Agent hook input must be valid hook JSON.")
  }

  do {
    return try JSONDecoder().decode(SupatermAgentHookEvent.self, from: data)
  } catch {
    throw ValidationError("Agent hook input must be valid hook JSON.")
  }
}

private struct AgentHookDestination {
  let candidateClient: SPSocketClient
  let deliveryClient: SPSocketClient

  init(path: String) throws {
    candidateClient = try SPSocketClient(
      path: path,
      connectRetryTimeout: AgentHookCandidateTiming.connectRetryTimeout,
      responseTimeout: AgentHookCandidateTiming.responseTimeout
    )
    deliveryClient = try SPSocketClient(path: path)
  }
}

private struct AgentHookCandidateMatch {
  let destination: AgentHookDestination
  let candidate: SupatermAgentHookCandidate
}

enum AgentHookCandidateDecision: Equatable {
  case deliver(Int)
  case reject
  case retry
}

func agentHookCandidateDecision(
  candidates: [SupatermAgentHookCandidate],
  processID: Int32?,
  pollingComplete: Bool,
  retryExpired: Bool
) -> AgentHookCandidateDecision {
  let sessionMatches = candidates.indices.filter {
    candidates[$0].sessionIDMatchesTitle
  }
  if !sessionMatches.isEmpty {
    if sessionMatches.count == 1, let index = sessionMatches.first {
      return .deliver(index)
    }
    let processMatches = sessionMatches.filter {
      candidateMatchesProcess(candidates[$0], processID: processID)
    }
    if processMatches.count == 1, let index = processMatches.first {
      return .deliver(index)
    }
    return retryExpired ? .reject : .retry
  }

  if processID != nil {
    let processMatches = candidates.indices.filter {
      candidateMatchesProcess(candidates[$0], processID: processID)
    }
    if processMatches.count == 1, let index = processMatches.first {
      return .deliver(index)
    }
    guard processMatches.isEmpty, retryExpired else {
      return retryExpired ? .reject : .retry
    }
    guard pollingComplete else { return .reject }
    return agentHookWorkspaceDecision(
      candidates: candidates,
      indices: candidates.indices.filter { candidates[$0].processMatch == .unknown },
      pollingComplete: true,
      retryExpired: true
    )
  }

  return agentHookWorkspaceDecision(
    candidates: candidates,
    indices: Array(candidates.indices),
    pollingComplete: pollingComplete,
    retryExpired: retryExpired
  )
}

private func candidateMatchesProcess(
  _ candidate: SupatermAgentHookCandidate,
  processID: Int32?
) -> Bool {
  candidate.processMatch == .matching || candidate.processID == processID
}

private func agentHookWorkspaceDecision(
  candidates: [SupatermAgentHookCandidate],
  indices: [Int],
  pollingComplete: Bool,
  retryExpired: Bool
) -> AgentHookCandidateDecision {
  let exactMatches = indices.filter {
    candidates[$0].workingDirectoryMatch == .exact
  }
  if exactMatches.count == 1, let index = exactMatches.first {
    return .deliver(index)
  }
  guard retryExpired, exactMatches.isEmpty else {
    return retryExpired ? .reject : .retry
  }

  let fallbackMatches = indices.filter {
    candidates[$0].workingDirectoryMatch == .unknown
  }
  guard pollingComplete, fallbackMatches.count == 1, let index = fallbackMatches.first else {
    return .reject
  }
  return .deliver(index)
}

private enum AgentHookCandidateTiming {
  static let connectRetryTimeout: TimeInterval = 0.25
  static let responseTimeout: TimeInterval = 0.25
  static let retryInterval: TimeInterval = 0.1
  static let retryTimeout: TimeInterval = 2
}

private func receiveContextlessCodexSessionStart(
  request: SupatermAgentHookRequest,
  connection: SPConnectionOptions
) throws {
  guard let destinations = try? agentHookDestinations(connection: connection), !destinations.isEmpty else {
    return
  }
  let deadline = Date().addingTimeInterval(AgentHookCandidateTiming.retryTimeout)
  let candidatesRequest = try SupatermSocketRequest.agentHookCandidates(request)

  while true {
    let pollingResults = destinations.map { destination -> [AgentHookCandidateMatch]? in
      guard
        let response = try? destination.candidateClient.send(candidatesRequest),
        response.ok,
        let result = try? response.decodeResult(SupatermAgentHookCandidates.self)
      else {
        return nil
      }
      return result.candidates.map {
        AgentHookCandidateMatch(destination: destination, candidate: $0)
      }
    }
    let matches = pollingResults.compactMap { $0 }.flatMap { $0 }
    let decision = agentHookCandidateDecision(
      candidates: matches.map(\.candidate),
      processID: request.processID,
      pollingComplete: pollingResults.allSatisfy { $0 != nil },
      retryExpired: Date() >= deadline
    )
    switch decision {
    case .deliver(let index):
      let match = matches[index]
      let inheritedSessionID =
        match.candidate.sessionIDMatchesTitle
          && match.candidate.processMatch == .different
        ? nil
        : request.inheritedSessionID
      let response = try match.destination.deliveryClient.send(
        try SupatermSocketRequest.agentHook(
          SupatermAgentHookRequest(
            agent: request.agent,
            context: match.candidate.context,
            event: request.event,
            inheritedSessionID: inheritedSessionID,
            processID: match.candidate.processID
          )
        )
      )
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }
      return
    case .reject:
      return
    case .retry:
      Thread.sleep(
        forTimeInterval: min(AgentHookCandidateTiming.retryInterval, deadline.timeIntervalSinceNow)
      )
    }
  }
}

private func agentHookDestinations(connection: SPConnectionOptions) throws -> [AgentHookDestination] {
  let diagnostics = SPSocketSelection.resolve(
    explicitPath: connection.explicitSocketPath,
    instance: connection.instance
  )
  if let target = diagnostics.resolvedTarget {
    return [
      try AgentHookDestination(path: target.path)
    ]
  }
  if connection.explicitSocketPath == nil,
    connection.instance == nil,
    diagnostics.environmentSocketPath == nil,
    !diagnostics.discoveredEndpoints.isEmpty
  {
    return try diagnostics.discoveredEndpoints.map {
      try AgentHookDestination(path: $0.path)
    }
  }
  throw ValidationError(diagnostics.errorMessage ?? "Unable to resolve a Supaterm socket path.")
}

private func renderAgentDetectionReload(
  _ result: SupatermAgentDetectionReloadResult
) -> String {
  ([
    "generation\t\(result.generation)",
    "override-directory\t\(result.overrideDirectory)",
  ]
    + result.manifests.map { manifest in
      "manifest\t\(manifest.agentID)\t\(manifest.version ?? "unknown")\t\(manifest.origin.rawValue)\t\(manifest.path)"
    }).joined(separator: "\n")
}

private enum AgentHookManagementOperation {
  case installDetected
  case removeAll

  func request(for target: SupatermAgentHookTargetRequest) throws -> SupatermSocketRequest {
    switch self {
    case .installDetected:
      try .hooksInstall(target)
    case .removeAll:
      try .hooksRemove(target)
    }
  }

  func disposition(for health: CodingAgentIntegrationHealth) -> AgentHookDisposition {
    switch self {
    case .installDetected:
      switch health {
      case .healthy:
        return .success
      case .unavailable:
        return .notDetected
      case .unavailableInstalled, .absent, .partial, .drifted:
        return .failure("Expected a healthy hook integration, got \(health.rawValue).")
      }
    case .removeAll:
      switch health {
      case .absent, .unavailable:
        return .success
      case .unavailableInstalled, .partial, .drifted, .healthy:
        return .failure("Expected hooks to be absent, got \(health.rawValue).")
      }
    }
  }
}

private enum AgentHookDisposition: Equatable {
  case success
  case notDetected
  case failure(String)
}

private func manageAgentHooks(
  _ operation: AgentHookManagementOperation,
  agents: [SupatermAgentKind] = SupatermAgentKind.allCases,
  connection: SPConnectionOptions
) throws {
  let client = try socketClient(
    path: connection.explicitSocketPath,
    instance: connection.instance,
    responseTimeout: SupatermAgentHookManagementTiming.clientResponseTimeout
  )
  var failures: [String] = []
  var dispositions: [AgentHookDisposition] = []
  for agent in agents {
    do {
      let target = SupatermAgentHookTargetRequest(agent: agent)
      let response = try client.send(try operation.request(for: target))
      guard response.ok else {
        let message = response.error?.message ?? "Supaterm socket request failed."
        failures.append("\(agent.notificationTitle): \(message)")
        dispositions.append(.failure(message))
        continue
      }
      let result = try response.decodeResult(SupatermAgentHookHealth.self)
      guard result.agent == agent else {
        let message =
          "Supaterm returned status for \(result.agent.notificationTitle), expected \(agent.notificationTitle)."
        failures.append("\(agent.notificationTitle): \(message)")
        dispositions.append(.failure(message))
        continue
      }
      let disposition = operation.disposition(for: result.health)
      switch disposition {
      case .success, .notDetected:
        dispositions.append(disposition)
      case .failure(let message):
        failures.append("\(agent.notificationTitle): \(message)")
        dispositions.append(.failure(message))
      }
    } catch {
      let message = error.localizedDescription
      failures.append("\(agent.notificationTitle): \(message)")
      dispositions.append(.failure(message))
    }
  }
  guard failures.isEmpty else {
    throw ValidationError(failures.joined(separator: "\n"))
  }
  if case .installDetected = operation,
    !dispositions.isEmpty,
    dispositions.allSatisfy({ $0 == .notDetected })
  {
    throw ValidationError("No supported coding agent was detected.")
  }
}

extension SupatermAgentKind: @retroactive ExpressibleByArgument {}
