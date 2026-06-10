import Foundation
import SupatermCLIShared

@MainActor
final class TerminalAgentSessionStore {
  private struct SessionKey: Hashable {
    let agent: SupatermAgentKind
    let sessionID: String
  }

  private struct SurfaceKey: Hashable {
    let agent: SupatermAgentKind
    let surfaceID: UUID
  }

  private enum SessionRouting {
    case background
    case foreground
  }

  private struct Session {
    var routing: SessionRouting
    var surfaceID: UUID?
    var transcriptPath: String?
    var codexConversation = CodexConversationState()
  }

  var onSidebarSnapshot: @MainActor (CodexSidebarSnapshot, SupatermAgentKind, String, SupatermCLIContext?) -> Void =
    { _, _, _, _ in }
  var onPanelSnapshot: @MainActor (AgentPanelSnapshot, SupatermAgentKind, String, SupatermCLIContext?) -> Void =
    { _, _, _, _ in }
  var onRunningTimeoutExpired: @MainActor (SupatermAgentKind, String, SupatermCLIContext?) -> Void = { _, _, _ in }

  private let agentRunningTimeout: Duration
  private let claudeTasksHomeDirectoryURL: URL
  private let sleep: (Duration) async throws -> Void
  private let transcriptPollInterval: Duration
  private var foregroundSessionsBySurface: [SurfaceKey: String] = [:]
  private var sessions: [SessionKey: Session] = [:]
  private var agentPanelMonitorTasks: [SessionKey: Task<Void, Never>] = [:]
  private var runningTimeoutTasks: [SessionKey: Task<Void, Never>] = [:]

  init(
    agentRunningTimeout: Duration,
    transcriptPollInterval: Duration,
    claudeTasksHomeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    sleep: @escaping (Duration) async throws -> Void
  ) {
    self.agentRunningTimeout = agentRunningTimeout
    self.claudeTasksHomeDirectoryURL = claudeTasksHomeDirectoryURL
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

  func beginSession(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?,
    transcriptPath: String?
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    var session =
      sessions[key]
      ?? Session(
        routing: .foreground,
        surfaceID: nil,
        transcriptPath: nil
      )
    if let surfaceID = context?.surfaceID {
      session.surfaceID = surfaceID
      let surfaceKey = SurfaceKey(agent: agent, surfaceID: surfaceID)
      if let foregroundSessionID = foregroundSessionsBySurface[surfaceKey],
        foregroundSessionID != sessionID
      {
        session.routing = .background
      } else {
        foregroundSessionsBySurface[surfaceKey] = sessionID
        session.routing = .foreground
      }
    }
    if let transcriptPath {
      session.transcriptPath = transcriptPath
    }
    sessions[key] = session
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
    let key = SessionKey(agent: agent, sessionID: sessionID)
    cancelAgentPanelTracking(agent: agent, sessionID: sessionID)
    cancelRunningTimeout(agent: agent, sessionID: sessionID)
    removeForegroundSessionIfNeeded(for: key)
    sessions.removeValue(forKey: key)
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
  func beginCodexTracking(
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let key = SessionKey(agent: .codex, sessionID: sessionID)
    guard
      let transcriptPath = sessions[key]?.transcriptPath,
      let (initialCursor, initialBatch) = CodexTranscriptMonitor.start(at: transcriptPath)
    else {
      return false
    }
    resetTranscriptConversation(for: key)
    if let initialBatch, !initialBatch.isEmpty {
      applyTranscriptBatch(initialBatch, for: key)
    }
    var cursor = initialCursor
    let interval = transcriptPollInterval
    let sleep = self.sleep
    agentPanelMonitorTasks[key]?.cancel()
    cancelRunningTimeout(agent: key.agent, sessionID: sessionID)
    if let snapshot = sidebarSnapshot(for: key),
      snapshot.status?.isFinal == false
    {
      handleSidebarSnapshot(
        snapshot,
        key: key,
        sessionID: sessionID,
        context: context
      )
    }
    agentPanelMonitorTasks[key] = Task { [weak self] in
      while !Task.isCancelled {
        try? await sleep(interval)
        guard !Task.isCancelled else { return }
        guard
          let (updatedCursor, batch) = CodexTranscriptMonitor.advance(cursor, at: transcriptPath)
        else {
          continue
        }
        let didReset = updatedCursor.offset < cursor.offset
        cursor = updatedCursor
        guard let batch, !batch.isEmpty else {
          continue
        }
        guard let self else { return }
        self.applyTranscriptBatch(batch, for: key, resettingConversation: didReset)
        guard let snapshot = self.sidebarSnapshot(for: key) else {
          continue
        }
        guard let status = snapshot.status else {
          continue
        }
        let isFinal = status.isFinal
        self.handleSidebarSnapshot(
          snapshot,
          key: key,
          sessionID: sessionID,
          context: context
        )
        if isFinal {
          return
        }
      }
    }
    return true
  }

  @discardableResult
  func beginAgentPanelTracking(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    switch agent {
    case .codex:
      return beginCodexTracking(sessionID: sessionID, context: context)
    case .claude:
      return beginClaudePanelTracking(sessionID: sessionID, context: context)
    default:
      return false
    }
  }

  @discardableResult
  func beginClaudePanelTracking(
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let key = SessionKey(agent: .claude, sessionID: sessionID)
    guard let session = sessions[key] else { return false }
    let initialProgress =
      session.transcriptPath.map { ClaudeTranscriptProgressMonitor.start(at: $0) }
      ?? (cursor: ClaudeProgressCursor(transcriptOffset: 0), rows: nil)
    var transcriptRows = initialProgress.rows ?? []
    var currentSnapshot = claudePanelSnapshot(sessionID: sessionID, transcriptRows: transcriptRows)
    agentPanelMonitorTasks[key]?.cancel()
    handleAgentPanelSnapshot(currentSnapshot, key: key, sessionID: sessionID, context: context)
    let interval = transcriptPollInterval
    let sleep = self.sleep
    agentPanelMonitorTasks[key] = Task { [weak self] in
      var cursor = initialProgress.cursor
      while !Task.isCancelled {
        try? await sleep(interval)
        guard !Task.isCancelled else { return }
        guard let self, self.sessions[key] != nil else { return }
        if let transcriptPath = self.sessions[key]?.transcriptPath,
          let result = ClaudeTranscriptProgressMonitor.advance(cursor, at: transcriptPath)
        {
          cursor = result.cursor
          if let rows = result.rows {
            transcriptRows = rows
          }
        }
        let nextSnapshot = self.claudePanelSnapshot(
          sessionID: sessionID,
          transcriptRows: transcriptRows
        )
        guard nextSnapshot != currentSnapshot else {
          continue
        }
        currentSnapshot = nextSnapshot
        self.handleAgentPanelSnapshot(
          nextSnapshot,
          key: key,
          sessionID: sessionID,
          context: context
        )
      }
    }
    return true
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

  private func handleSidebarSnapshot(
    _ snapshot: CodexSidebarSnapshot,
    key: SessionKey,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    if snapshot.status?.isFinal == true {
      agentPanelMonitorTasks.removeValue(forKey: key)
      cancelRunningTimeout(agent: key.agent, sessionID: sessionID)
    }
    onSidebarSnapshot(snapshot, key.agent, sessionID, context)
  }

  private func handleAgentPanelSnapshot(
    _ snapshot: AgentPanelSnapshot,
    key: SessionKey,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    onPanelSnapshot(snapshot, key.agent, sessionID, context)
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

  private func applyTranscriptBatch(
    _ batch: CodexTranscriptBatch,
    for key: SessionKey,
    resettingConversation: Bool = false
  ) {
    guard var session = sessions[key] else { return }
    if resettingConversation {
      session.codexConversation = CodexConversationState()
    }
    session.codexConversation.absorb(batch.records)
    sessions[key] = session
  }

  private func sidebarSnapshot(
    for key: SessionKey
  ) -> CodexSidebarSnapshot? {
    guard let session = sessions[key] else { return nil }
    return session.codexConversation.sidebarSnapshot
  }

  private func resetTranscriptConversation(
    for key: SessionKey
  ) {
    guard var session = sessions[key] else { return }
    session.codexConversation = CodexConversationState()
    sessions[key] = session
  }

  private func claudeTaskProgressRows(
    sessionID: String
  ) -> [PaneAgentProgressRow] {
    ClaudeTaskProgressReader.progressRows(
      sessionID: sessionID,
      homeDirectoryURL: claudeTasksHomeDirectoryURL
    )
  }

  private func claudePanelSnapshot(
    sessionID: String,
    transcriptRows: [PaneAgentProgressRow]
  ) -> AgentPanelSnapshot {
    let taskRows = claudeTaskProgressRows(sessionID: sessionID)
    return AgentPanelSnapshot(progressRows: taskRows.isEmpty ? transcriptRows : taskRows)
  }
}
