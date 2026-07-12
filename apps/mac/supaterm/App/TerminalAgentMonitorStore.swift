import Foundation
import SupatermCLIShared

@MainActor
final class TerminalAgentMonitorStore {
  typealias Updates = @Sendable (String) -> AsyncStream<AgentTranscriptUpdate>

  private struct Key: Hashable {
    let agent: SupatermAgentKind
    let sessionID: String

    func hash(into hasher: inout Hasher) {
      hasher.combine(agent.rawValue)
      hasher.combine(sessionID)
    }
  }

  private struct Entry: Equatable {
    let generation: UUID
    let path: String
    let surfaceID: UUID?

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.generation == rhs.generation
        && lhs.path == rhs.path
        && lhs.surfaceID == rhs.surfaceID
    }
  }

  var onMonitorSnapshot:
    @MainActor (
      AgentMonitorSnapshot,
      SupatermAgentKind,
      String,
      SupatermCLIContext?
    ) -> Void = { _, _, _, _ in }
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
  private var timeoutSurfaceIDs: [Key: UUID] = [:]

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
    agent: SupatermAgentKind,
    sessionID: String,
    transcriptPath: String,
    context: SupatermCLIContext?
  ) -> Bool {
    guard let monitor = makeMonitor(agent: agent) else { return false }
    let key = Key(agent: agent, sessionID: sessionID)
    if entries[key]?.path == transcriptPath,
      entries[key]?.surfaceID == context?.surfaceID,
      monitorTasks[key] != nil
    {
      return true
    }
    cancelTracking(agent: agent, sessionID: sessionID)
    let entry = Entry(
      generation: UUID(),
      path: transcriptPath,
      surfaceID: context?.surfaceID
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
        self.extendRunningTimeoutIfArmed(
          agent: agent,
          sessionID: sessionID,
          context: context
        )
        if let snapshot = monitor.consume(update) {
          self.onMonitorSnapshot(snapshot, agent, sessionID, context)
        }
      }
    }
    return true
  }

  func cancelTracking(agent: SupatermAgentKind, sessionID: String) {
    let key = Key(agent: agent, sessionID: sessionID)
    monitorTasks.removeValue(forKey: key)?.cancel()
    entries.removeValue(forKey: key)
  }

  func clearSession(agent: SupatermAgentKind, sessionID: String) {
    cancelTracking(agent: agent, sessionID: sessionID)
    cancelRunningTimeout(agent: agent, sessionID: sessionID)
  }

  func clearSessions(for surfaceID: UUID) {
    let keys = Set(
      entries.compactMap { key, entry in
        entry.surfaceID == surfaceID ? key : nil
      }
        + timeoutSurfaceIDs.compactMap { key, timeoutSurfaceID in
          timeoutSurfaceID == surfaceID ? key : nil
        }
    )
    for key in keys {
      clearSession(agent: key.agent, sessionID: key.sessionID)
    }
  }

  func isTracking(agent: SupatermAgentKind, sessionID: String) -> Bool {
    monitorTasks[Key(agent: agent, sessionID: sessionID)] != nil
  }

  func armRunningTimeout(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    let key = Key(agent: agent, sessionID: sessionID)
    runningTimeoutTasks.removeValue(forKey: key)?.cancel()
    if let surfaceID = context?.surfaceID {
      timeoutSurfaceIDs[key] = surfaceID
    }
    let timeout = agentRunningTimeout
    let sleep = sleep
    runningTimeoutTasks[key] = Task { [weak self] in
      try? await sleep(timeout)
      guard !Task.isCancelled, let self else { return }
      self.runningTimeoutTasks.removeValue(forKey: key)
      self.timeoutSurfaceIDs.removeValue(forKey: key)
      self.onRunningTimeoutExpired(agent, sessionID, context)
    }
  }

  func cancelRunningTimeout(agent: SupatermAgentKind, sessionID: String) {
    let key = Key(agent: agent, sessionID: sessionID)
    runningTimeoutTasks.removeValue(forKey: key)?.cancel()
    timeoutSurfaceIDs.removeValue(forKey: key)
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
