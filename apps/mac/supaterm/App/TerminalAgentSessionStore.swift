import Foundation
import SupatermCLIShared

@MainActor
protocol TerminalAgentSessionStoreDelegate: AnyObject {
  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didReceiveCodexTranscriptSnapshot snapshot: CodexTranscriptSnapshot,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  )

  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didExpireRunningTimeoutFor agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  )
}

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

  weak var delegate: TerminalAgentSessionStoreDelegate?

  private let agentRunningTimeout: Duration
  private let sleep: (Duration) async throws -> Void
  private let transcriptPollInterval: Duration
  private var foregroundSessionsBySurface: [SurfaceKey: String] = [:]
  private var sessions: [SessionKey: Session] = [:]
  private var transcriptMonitorTasks: [SessionKey: Task<Void, Never>] = [:]
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
    for task in transcriptMonitorTasks.values {
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
      ?? .init(
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
    sessions[.init(agent: agent, sessionID: sessionID)] != nil
  }

  func shouldRouteSession(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> Bool {
    sessions[.init(agent: agent, sessionID: sessionID)]?.routing == .foreground
  }

  func sessionSurfaceID(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> UUID? {
    sessions[.init(agent: agent, sessionID: sessionID)]?.surfaceID
  }

  func clearSession(
    agent: SupatermAgentKind,
    sessionID: String
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
    cancelRunningTimeout(agent: agent, sessionID: sessionID)
    removeForegroundSessionIfNeeded(for: key)
    sessions.removeValue(forKey: key)
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
    transcriptMonitorTasks[key]?.cancel()
    cancelRunningTimeout(agent: key.agent, sessionID: sessionID)
    if let snapshot = transcriptSnapshot(for: key),
      snapshot.status?.isFinal == false
    {
      handleTranscriptSnapshot(
        snapshot,
        key: key,
        sessionID: sessionID,
        context: context
      )
    }
    transcriptMonitorTasks[key] = Task { [weak self] in
      while !Task.isCancelled {
        try? await sleep(interval)
        guard !Task.isCancelled else { return }
        guard let (updatedCursor, batch) = CodexTranscriptMonitor.advance(cursor, at: transcriptPath)
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
        guard let snapshot = self.transcriptSnapshot(for: key) else {
          continue
        }
        guard let status = snapshot.status else {
          continue
        }
        let isFinal = status.isFinal
        self.handleTranscriptSnapshot(
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

  func cancelTranscriptMonitor(
    agent: SupatermAgentKind,
    sessionID: String
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    transcriptMonitorTasks[key]?.cancel()
    transcriptMonitorTasks.removeValue(forKey: key)
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

  private func handleTranscriptSnapshot(
    _ snapshot: CodexTranscriptSnapshot,
    key: SessionKey,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    if snapshot.status?.isFinal == true {
      transcriptMonitorTasks.removeValue(forKey: key)
      cancelRunningTimeout(agent: key.agent, sessionID: sessionID)
    }
    delegate?.terminalAgentSessionStore(
      self,
      didReceiveCodexTranscriptSnapshot: snapshot,
      agent: key.agent,
      sessionID: sessionID,
      context: context
    )
  }

  private func handleRunningTimeoutExpiry(
    key: SessionKey,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    runningTimeoutTasks.removeValue(forKey: key)
    delegate?.terminalAgentSessionStore(
      self,
      didExpireRunningTimeoutFor: agent,
      sessionID: sessionID,
      context: context
    )
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

  private func transcriptSnapshot(
    for key: SessionKey
  ) -> CodexTranscriptSnapshot? {
    guard let session = sessions[key] else { return nil }
    return .init(conversation: session.codexConversation)
  }

  private func resetTranscriptConversation(
    for key: SessionKey
  ) {
    guard var session = sessions[key] else { return }
    session.codexConversation = CodexConversationState()
    sessions[key] = session
  }
}
