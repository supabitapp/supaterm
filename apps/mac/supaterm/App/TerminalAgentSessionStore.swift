import Foundation
import SupatermCLIShared

@MainActor
protocol TerminalAgentSessionStoreDelegate: AnyObject {
  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didReceiveCodexTranscriptUpdate update: CodexTranscriptUpdate,
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

  private struct Session {
    var surfaceID: UUID?
    var transcriptPath: String?
  }

  weak var delegate: TerminalAgentSessionStoreDelegate?

  private let agentRunningTimeout: Duration
  private let sleep: (Duration) async throws -> Void
  private let transcriptPollInterval: Duration
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

  func recordSession(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?,
    transcriptPath: String?
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    var session = sessions[key] ?? .init(surfaceID: nil, transcriptPath: nil)
    if let surfaceID = context?.surfaceID {
      session.surfaceID = surfaceID
    }
    if let transcriptPath {
      session.transcriptPath = transcriptPath
    }
    sessions[key] = session
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
    cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
    cancelRunningTimeout(agent: agent, sessionID: sessionID)
    sessions.removeValue(forKey: .init(agent: agent, sessionID: sessionID))
  }

  func clearRecordedSessionIfSurfaceMatches(
    agent: SupatermAgentKind,
    sessionID: String,
    surfaceID: UUID
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    if sessions[key]?.surfaceID == surfaceID {
      sessions.removeValue(forKey: key)
    }
  }

  func clearSessions(for surfaceID: UUID) {
    for key in sessions.keys where sessions[key]?.surfaceID == surfaceID {
      cancelTranscriptMonitor(agent: key.agent, sessionID: key.sessionID)
      cancelRunningTimeout(agent: key.agent, sessionID: key.sessionID)
    }
    sessions = sessions.filter { $0.value.surfaceID != surfaceID }
  }

  @discardableResult
  func beginCodexTracking(
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let key = SessionKey(agent: .codex, sessionID: sessionID)
    guard
      let transcriptPath = sessions[key]?.transcriptPath,
      let (initialCursor, initialUpdate) = CodexTranscriptMonitor.start(at: transcriptPath)
    else {
      return false
    }
    var cursor = initialCursor
    let interval = transcriptPollInterval
    let sleep = self.sleep
    transcriptMonitorTasks[key]?.cancel()
    cancelRunningTimeout(agent: key.agent, sessionID: sessionID)
    if let initialUpdate {
      handleTranscriptUpdate(
        initialUpdate,
        key: key,
        sessionID: sessionID,
        context: context
      )
    }
    transcriptMonitorTasks[key] = Task { [weak self] in
      while !Task.isCancelled {
        try? await sleep(interval)
        guard !Task.isCancelled else { return }
        guard let (updatedCursor, update) = CodexTranscriptMonitor.advance(cursor, at: transcriptPath)
        else {
          continue
        }
        cursor = updatedCursor
        guard let update else {
          continue
        }
        let isFinal = update.status?.isFinal == true
        self?.handleTranscriptUpdate(
          update,
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

  private func handleTranscriptUpdate(
    _ update: CodexTranscriptUpdate,
    key: SessionKey,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    if update.status?.isFinal == true {
      transcriptMonitorTasks.removeValue(forKey: key)
      cancelRunningTimeout(agent: key.agent, sessionID: sessionID)
    }
    delegate?.terminalAgentSessionStore(
      self,
      didReceiveCodexTranscriptUpdate: update,
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
}
