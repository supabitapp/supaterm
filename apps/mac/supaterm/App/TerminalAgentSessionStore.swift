import Foundation
import SupatermCLIShared

@MainActor
final class TerminalAgentSessionStore {
  private struct SessionKey: Hashable {
    let agent: SupatermAgentKind
    let sessionID: String

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.agent == rhs.agent && lhs.sessionID == rhs.sessionID
    }

    func hash(into hasher: inout Hasher) {
      hasher.combine(agent)
      hasher.combine(sessionID)
    }
  }

  private struct SurfaceKey: Hashable {
    let agent: SupatermAgentKind
    let surfaceID: UUID

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.agent == rhs.agent && lhs.surfaceID == rhs.surfaceID
    }

    func hash(into hasher: inout Hasher) {
      hasher.combine(agent)
      hasher.combine(surfaceID)
    }
  }

  private enum SessionRouting {
    case background
    case foreground
  }

  private struct Session {
    var routing: SessionRouting
    var surfaceID: UUID?
    var transcriptPath: String?
  }

  var onMonitorSnapshot: @MainActor (AgentMonitorSnapshot, SupatermAgentKind, String, SupatermCLIContext?) -> Void =
    { _, _, _, _ in }
  var onRunningTimeoutExpired: @MainActor (SupatermAgentKind, String, SupatermCLIContext?) -> Void = { _, _, _ in }

  private let agentRunningTimeout: Duration
  private let sleep: (Duration) async throws -> Void
  private let transcriptPollInterval: Duration
  private var foregroundSessionsBySurface: [SurfaceKey: String] = [:]
  private var sessions: [SessionKey: Session] = [:]
  private var agentPanelMonitorTasks: [SessionKey: Task<Void, Never>] = [:]
  private var runningTimeoutTasks: [SessionKey: Task<Void, Never>] = [:]

  init(
    agentRunningTimeout: Duration,
    transcriptPollInterval: Duration,
    sleep: @escaping (Duration) async throws -> Void
  ) {
    self.agentRunningTimeout = agentRunningTimeout
    self.transcriptPollInterval = transcriptPollInterval
    self.sleep = sleep
  }

  deinit {
    for task in agentPanelMonitorTasks.values {
      task.cancel()
    }
    for task in runningTimeoutTasks.values {
      task.cancel()
    }
  }

  @discardableResult
  func beginSession(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?,
    transcriptPath: String?
  ) -> String? {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    var session =
      sessions[key]
      ?? Session(
        routing: .foreground,
        surfaceID: nil,
        transcriptPath: nil
      )
    var replacedForegroundSessionID: String?
    if let surfaceID = context?.surfaceID {
      session.surfaceID = surfaceID
      let surfaceKey = SurfaceKey(agent: agent, surfaceID: surfaceID)
      if let foregroundSessionID = foregroundSessionsBySurface[surfaceKey],
        foregroundSessionID != sessionID
      {
        removeSession(agent: agent, sessionID: foregroundSessionID)
        replacedForegroundSessionID = foregroundSessionID
      }
      foregroundSessionsBySurface[surfaceKey] = sessionID
      session.routing = .foreground
    }
    if let transcriptPath {
      session.transcriptPath = transcriptPath
    }
    sessions[key] = session
    return replacedForegroundSessionID
  }

  func updateSession(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?,
    transcriptPath: String?
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    guard var session = sessions[key] else { return }
    if let surfaceID = context?.surfaceID {
      session.surfaceID = surfaceID
    }
    if let transcriptPath {
      session.transcriptPath = transcriptPath
    }
    sessions[key] = session
  }

  func hasSession(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> Bool {
    sessions[SessionKey(agent: agent, sessionID: sessionID)] != nil
  }

  func shouldRouteSession(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> Bool {
    sessions[SessionKey(agent: agent, sessionID: sessionID)]?.routing == .foreground
  }

  func sessionSurfaceID(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> UUID? {
    sessions[SessionKey(agent: agent, sessionID: sessionID)]?.surfaceID
  }

  func clearSession(
    agent: SupatermAgentKind,
    sessionID: String
  ) {
    removeSession(agent: agent, sessionID: sessionID)
  }

  func clearSessions(for surfaceID: UUID) {
    let keys = sessions.compactMap { entry in
      entry.value.surfaceID == surfaceID ? entry.key : nil
    }
    for key in keys {
      clearSession(agent: key.agent, sessionID: key.sessionID)
    }
  }

  func restoreSessions(
    from records: [TerminalPaneAgentRecord],
    surfaceID: UUID
  ) {
    for record in records {
      guard record.processIDs.contains(where: TerminalAgentPresenceStore.isProcessAlive) else {
        continue
      }
      let surfaceKey = SurfaceKey(agent: record.agent, surfaceID: surfaceID)
      for sessionID in record.sessionIDs {
        let key = SessionKey(agent: record.agent, sessionID: sessionID)
        let routing: SessionRouting
        if let foregroundSessionID = foregroundSessionsBySurface[surfaceKey],
          foregroundSessionID != sessionID
        {
          routing = .background
        } else {
          foregroundSessionsBySurface[surfaceKey] = sessionID
          routing = .foreground
        }
        var session =
          sessions[key] ?? Session(routing: routing, surfaceID: surfaceID, transcriptPath: nil)
        session.routing = routing
        session.surfaceID = surfaceID
        sessions[key] = session
      }
    }
  }

  func clearRecordedSessionIfSurfaceMatches(
    agent: SupatermAgentKind,
    sessionID: String,
    surfaceID: UUID
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    if sessions[key]?.surfaceID == surfaceID {
      removeForegroundSessionIfNeeded(for: key)
      sessions.removeValue(forKey: key)
    }
  }

  @discardableResult
  func beginAgentPanelTracking(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    guard let monitor = makeMonitor(agent: agent, key: key) else { return false }
    agentPanelMonitorTasks[key]?.cancel()
    if let tick = monitor.start() {
      handleMonitorTick(tick, key: key, sessionID: sessionID, context: context)
    }
    let interval = transcriptPollInterval
    let sleep = self.sleep
    agentPanelMonitorTasks[key] = Task { [weak self] in
      var transcriptSize = self?.transcriptFileSize(key: key)
      while !Task.isCancelled {
        try? await sleep(interval)
        guard !Task.isCancelled else { return }
        guard let self, self.sessions[key] != nil else { return }
        if let size = self.transcriptFileSize(key: key), size != transcriptSize {
          transcriptSize = size
          self.extendRunningTimeoutIfArmed(agent: agent, sessionID: sessionID, context: context)
        }
        guard let tick = monitor.poll() else { continue }
        self.handleMonitorTick(tick, key: key, sessionID: sessionID, context: context)
        if tick.isFinal {
          return
        }
      }
    }
    return true
  }

  private func makeMonitor(
    agent: SupatermAgentKind,
    key: SessionKey
  ) -> AgentPanelMonitor? {
    switch agent {
    case .codex:
      guard let transcriptPath = sessions[key]?.transcriptPath else { return nil }
      return CodexPanelMonitor(transcriptPath: transcriptPath)
    case .claude:
      guard sessions[key] != nil else { return nil }
      return ClaudePanelMonitor(
        transcriptPath: { [weak self] in self?.sessions[key]?.transcriptPath }
      )
    default:
      return nil
    }
  }

  private func handleMonitorTick(
    _ tick: AgentPanelMonitorTick,
    key: SessionKey,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    if tick.isFinal {
      agentPanelMonitorTasks.removeValue(forKey: key)
      cancelRunningTimeout(agent: key.agent, sessionID: sessionID)
    }
    onMonitorSnapshot(tick.snapshot, key.agent, sessionID, context)
  }

  func cancelAgentPanelTracking(
    agent: SupatermAgentKind,
    sessionID: String
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    agentPanelMonitorTasks[key]?.cancel()
    agentPanelMonitorTasks.removeValue(forKey: key)
  }

  func armRunningTimeout(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    let timeout = agentRunningTimeout
    let sleep = self.sleep
    runningTimeoutTasks[key]?.cancel()
    runningTimeoutTasks[key] = Task { [weak self] in
      try? await sleep(timeout)
      guard !Task.isCancelled else { return }
      self?.handleRunningTimeoutExpiry(
        key: key,
        agent: agent,
        sessionID: sessionID,
        context: context
      )
    }
  }

  func cancelRunningTimeout(
    agent: SupatermAgentKind,
    sessionID: String
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    runningTimeoutTasks[key]?.cancel()
    runningTimeoutTasks.removeValue(forKey: key)
  }

  private func extendRunningTimeoutIfArmed(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    guard runningTimeoutTasks[SessionKey(agent: agent, sessionID: sessionID)] != nil else { return }
    armRunningTimeout(agent: agent, sessionID: sessionID, context: context)
  }

  private func transcriptFileSize(key: SessionKey) -> UInt64? {
    guard let path = sessions[key]?.transcriptPath else { return nil }
    let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.fileSizeKey])
    return values?.fileSize.map(UInt64.init)
  }

  private func handleRunningTimeoutExpiry(
    key: SessionKey,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    runningTimeoutTasks.removeValue(forKey: key)
    onRunningTimeoutExpired(agent, sessionID, context)
  }

  private func removeSession(
    agent: SupatermAgentKind,
    sessionID: String
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    cancelAgentPanelTracking(agent: agent, sessionID: sessionID)
    cancelRunningTimeout(agent: agent, sessionID: sessionID)
    removeForegroundSessionIfNeeded(for: key)
    sessions.removeValue(forKey: key)
  }

  private func removeForegroundSessionIfNeeded(
    for key: SessionKey
  ) {
    guard
      let session = sessions[key],
      session.routing == .foreground,
      let surfaceID = session.surfaceID
    else {
      return
    }
    let surfaceKey = SurfaceKey(agent: key.agent, surfaceID: surfaceID)
    if foregroundSessionsBySurface[surfaceKey] == key.sessionID {
      foregroundSessionsBySurface.removeValue(forKey: surfaceKey)
    }
  }

}
