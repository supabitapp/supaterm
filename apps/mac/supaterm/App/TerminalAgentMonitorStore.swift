import Foundation
import SupatermCLIShared

@MainActor
final class TerminalAgentMonitorStore {
  typealias Updates = @Sendable (String) -> AsyncStream<AgentTranscriptUpdate>

  nonisolated private struct Key: Hashable, Sendable {
    let agent: SupatermAgentKind
    let sessionID: String
    let subagentID: String?

    func hash(into hasher: inout Hasher) {
      hasher.combine(agent.rawValue)
      hasher.combine(sessionID)
      hasher.combine(subagentID)
    }

    init(_ scope: TerminalAgentEvent.Scope) {
      agent = scope.agent
      sessionID = scope.sessionID
      subagentID = scope.subagentID
    }

    init(agent: SupatermAgentKind, sessionID: String) {
      self.agent = agent
      self.sessionID = sessionID
      subagentID = nil
    }
  }

  private struct Entry: Equatable {
    let generation: UUID
    let path: String
    let surfaceID: UUID?
    let turnID: String?

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.generation == rhs.generation
        && lhs.path == rhs.path
        && lhs.surfaceID == rhs.surfaceID
        && lhs.turnID == rhs.turnID
    }
  }

  nonisolated private struct RunningTimeout: Sendable {
    let surfaceID: UUID?
    let task: Task<Void, Never>
  }

  var onMonitorSnapshot:
    @MainActor (
      AgentMonitorSnapshot,
      TerminalAgentEvent.Scope,
      SupatermCLIContext?
    ) -> Void = { _, _, _ in }
  var onRunningTimeoutExpired:
    @MainActor (
      SupatermAgentKind,
      String,
      SupatermCLIContext?
    ) -> Void = { _, _, _ in }

  private let agentRunningTimeout: Duration
  private let eventDelay: Duration
  private let sleep: (Duration) async throws -> Void
  private let updates: Updates
  private var entries: [Key: Entry] = [:]
  private var monitorTasks: [Key: Task<Void, Never>] = [:]
  private var runningTimeouts: [Key: RunningTimeout] = [:]

  init(
    agentRunningTimeout: Duration,
    transcriptEventDelay: Duration,
    sleep: @escaping (Duration) async throws -> Void,
    transcriptStream: AgentTranscriptStream = AgentTranscriptStream()
  ) {
    self.agentRunningTimeout = agentRunningTimeout
    self.eventDelay = transcriptEventDelay
    self.sleep = sleep
    self.updates = { transcriptStream.updates(at: $0) }
  }

  init(
    agentRunningTimeout: Duration,
    transcriptEventDelay: Duration,
    sleep: @escaping (Duration) async throws -> Void,
    updates: @escaping Updates
  ) {
    self.agentRunningTimeout = agentRunningTimeout
    self.eventDelay = transcriptEventDelay
    self.sleep = sleep
    self.updates = updates
  }

  deinit {
    for task in monitorTasks.values {
      task.cancel()
    }
    for timeout in runningTimeouts.values {
      timeout.task.cancel()
    }
  }

  @discardableResult
  func track(
    scope: TerminalAgentEvent.Scope,
    transcriptPath: String,
    context: SupatermCLIContext?
  ) -> Bool {
    guard let monitor = makeMonitor(agent: scope.agent) else { return false }
    let key = Key(scope)
    let turnID = scope.subagentID == nil ? nil : scope.turnID
    if entries[key]?.path == transcriptPath,
      entries[key]?.surfaceID == context?.surfaceID,
      entries[key]?.turnID == turnID,
      monitorTasks[key] != nil
    {
      return true
    }
    cancelTracking(scope: scope)
    let entry = Entry(
      generation: UUID(),
      path: transcriptPath,
      surfaceID: context?.surfaceID,
      turnID: turnID
    )
    entries[key] = entry
    let updates = updates(transcriptPath)
    let eventDelay = eventDelay
    let sleep = sleep
    monitorTasks[key] = Task { [weak self] in
      defer {
        if let self, self.entries[key] == entry {
          self.monitorTasks.removeValue(forKey: key)
          self.entries.removeValue(forKey: key)
        }
      }
      for await update in updates {
        guard !Task.isCancelled else { return }
        if eventDelay != .zero {
          try? await sleep(eventDelay)
        }
        guard !Task.isCancelled, let self, self.entries[key] == entry else { return }
        if scope.subagentID == nil {
          self.extendRunningTimeoutIfArmed(
            agent: scope.agent,
            sessionID: scope.sessionID,
            context: context
          )
        }
        if let snapshot = monitor.consume(update) {
          self.onMonitorSnapshot(snapshot, scope, context)
        }
      }
    }
    return true
  }

  func cancelTracking(scope: TerminalAgentEvent.Scope) {
    let key = Key(scope)
    monitorTasks.removeValue(forKey: key)?.cancel()
    entries.removeValue(forKey: key)
  }

  func clearSession(agent: SupatermAgentKind, sessionID: String) {
    let keys = entries.keys.filter {
      $0.agent == agent && $0.sessionID == sessionID
    }
    for key in keys {
      monitorTasks.removeValue(forKey: key)?.cancel()
      entries.removeValue(forKey: key)
    }
    cancelRunningTimeout(agent: agent, sessionID: sessionID)
  }

  func clearSessions(for surfaceID: UUID) {
    let entryKeys = entries.compactMap { key, entry in
      entry.surfaceID == surfaceID ? key : nil
    }
    for key in entryKeys {
      monitorTasks.removeValue(forKey: key)?.cancel()
      entries.removeValue(forKey: key)
    }
    let timeoutKeys = runningTimeouts.compactMap { key, timeout in
      timeout.surfaceID == surfaceID ? key : nil
    }
    for key in timeoutKeys {
      runningTimeouts.removeValue(forKey: key)?.task.cancel()
    }
  }

  func isTracking(scope: TerminalAgentEvent.Scope) -> Bool {
    monitorTasks[Key(scope)] != nil
  }

  func armRunningTimeout(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    let key = Key(agent: agent, sessionID: sessionID)
    runningTimeouts.removeValue(forKey: key)?.task.cancel()
    let timeout = agentRunningTimeout
    let sleep = sleep
    let task = Task { [weak self] in
      try? await sleep(timeout)
      guard !Task.isCancelled, let self else { return }
      self.runningTimeouts.removeValue(forKey: key)
      self.onRunningTimeoutExpired(agent, sessionID, context)
    }
    runningTimeouts[key] = RunningTimeout(surfaceID: context?.surfaceID, task: task)
  }

  func cancelRunningTimeout(agent: SupatermAgentKind, sessionID: String) {
    let key = Key(agent: agent, sessionID: sessionID)
    runningTimeouts.removeValue(forKey: key)?.task.cancel()
  }

  private func extendRunningTimeoutIfArmed(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    guard runningTimeouts[Key(agent: agent, sessionID: sessionID)] != nil else { return }
    armRunningTimeout(agent: agent, sessionID: sessionID, context: context)
  }

  private func makeMonitor(agent: SupatermAgentKind) -> AgentPanelMonitor? {
    switch agent {
    case .claude: ClaudePanelMonitor()
    case .codex: CodexPanelMonitor()
    case .pi: nil
    }
  }
}
