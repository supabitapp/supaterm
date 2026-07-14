import Foundation
import SupatermCLIShared

@MainActor
final class TerminalAgentMonitorStore {
  typealias Updates = @Sendable (String) -> AsyncStream<AgentTranscriptUpdate>

  private struct Key: Hashable {
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
    let context: SupatermCLIContext?
    let generation: UUID
    let path: String
    let turnID: String?

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.context == rhs.context
        && lhs.generation == rhs.generation
        && lhs.path == rhs.path
        && lhs.turnID == rhs.turnID
    }
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
  private var runningTimeoutTasks: [Key: Task<Void, Never>] = [:]
  private var timeoutContexts: [Key: SupatermCLIContext] = [:]

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
    for task in runningTimeoutTasks.values {
      task.cancel()
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
      entries[key]?.context == context,
      entries[key]?.turnID == turnID,
      monitorTasks[key] != nil
    {
      return true
    }
    cancelTracking(scope: scope)
    let entry = Entry(
      context: context,
      generation: UUID(),
      path: transcriptPath,
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

  func clearSessions(
    for surfaceID: UUID,
    in windowID: UUID
  ) {
    let entryKeys = entries.compactMap { key, entry in
      entry.context?.windowID == windowID && entry.context?.surfaceID == surfaceID ? key : nil
    }
    for key in entryKeys {
      monitorTasks.removeValue(forKey: key)?.cancel()
      entries.removeValue(forKey: key)
    }
    let timeoutKeys = timeoutContexts.compactMap { key, context in
      context.windowID == windowID && context.surfaceID == surfaceID ? key : nil
    }
    for key in timeoutKeys {
      runningTimeoutTasks.removeValue(forKey: key)?.cancel()
      timeoutContexts.removeValue(forKey: key)
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
    runningTimeoutTasks.removeValue(forKey: key)?.cancel()
    timeoutContexts[key] = context
    let timeout = agentRunningTimeout
    let sleep = sleep
    runningTimeoutTasks[key] = Task { [weak self] in
      try? await sleep(timeout)
      guard !Task.isCancelled, let self else { return }
      self.runningTimeoutTasks.removeValue(forKey: key)
      self.timeoutContexts.removeValue(forKey: key)
      self.onRunningTimeoutExpired(agent, sessionID, context)
    }
  }

  func cancelRunningTimeout(agent: SupatermAgentKind, sessionID: String) {
    let key = Key(agent: agent, sessionID: sessionID)
    runningTimeoutTasks.removeValue(forKey: key)?.cancel()
    timeoutContexts.removeValue(forKey: key)
  }

  private func extendRunningTimeoutIfArmed(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    guard runningTimeoutTasks[Key(agent: agent, sessionID: sessionID)] != nil else { return }
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
