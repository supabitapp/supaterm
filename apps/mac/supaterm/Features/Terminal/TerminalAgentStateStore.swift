import Foundation
import SupatermCLIShared

nonisolated enum AgentActivityPhase: Codable, Comparable, Sendable {
  case idle
  case running
  case needsInput
}

nonisolated enum TerminalAgentTurnLifecycle: Codable, Equatable, Sendable {
  case active(String?)
  case completed(String?)
  case unseen
}

nonisolated struct TerminalAgentChildUsage: Codable, Equatable, Sendable {
  let model: String?
  let contextTokens: Int
  let startedAt: Date
  let lastActiveAt: Date

  func summary(now: Date) -> String {
    [modelName, tokenText, elapsedText(now: now)]
      .compactMap(\.self)
      .joined(separator: " · ")
  }

  var modelName: String? {
    guard let model else { return nil }
    let components =
      model
      .split(separator: "-")
      .map(String.init)
      .filter { $0 != "claude" && !isReleaseDate($0) }
    guard let family = components.first(where: { !isVersion($0) }) else { return nil }
    let version = components.filter(isVersion).joined(separator: ".")
    return version.isEmpty ? family.capitalized : "\(family.capitalized) \(version)"
  }

  private var tokenText: String? {
    guard contextTokens > 0 else { return nil }
    guard contextTokens >= 1000 else { return "\(contextTokens) tok" }
    let thousands = (Double(contextTokens) / 100).rounded() / 10
    let text =
      thousands == thousands.rounded()
      ? String(Int(thousands))
      : String(format: "%.1f", thousands)
    return "\(text)k tok"
  }

  private func elapsedText(now: Date) -> String {
    let seconds = max(0, Int(now.timeIntervalSince(startedAt).rounded()))
    let hours = seconds / 3600
    let minutes = seconds % 3600 / 60
    if hours > 0 {
      return String(format: "%dh%02dm", hours, minutes)
    }
    if minutes > 0 {
      return String(format: "%dm%02ds", minutes, seconds % 60)
    }
    return "\(seconds)s"
  }

  private func isVersion(_ component: String) -> Bool {
    component.allSatisfy(\.isNumber)
  }

  private func isReleaseDate(_ component: String) -> Bool {
    component.count == 8 && isVersion(component)
  }
}

nonisolated struct TerminalAgentActiveChild: Codable, Equatable, Identifiable, Sendable {
  struct Identity: Codable, Equatable, Hashable, Sendable {
    let subagentID: String
    let sessionID: String
    let turnID: String?
  }

  let id: Identity
  let nickname: String?
  let role: String?
  let transcriptPath: String?
  let task: String?
  let phase: AgentActivityPhase
  let detail: String?
  let attentionRequestID: String?
  let usage: TerminalAgentChildUsage?

  init(
    id: Identity,
    nickname: String?,
    role: String?,
    transcriptPath: String? = nil,
    task: String? = nil,
    phase: AgentActivityPhase,
    detail: String?,
    attentionRequestID: String? = nil,
    usage: TerminalAgentChildUsage? = nil
  ) {
    self.id = id
    self.nickname = nickname
    self.role = role
    self.transcriptPath = transcriptPath
    self.task = task
    self.phase = phase
    self.detail = detail
    self.attentionRequestID = attentionRequestID
    self.usage = usage
  }

  var subagentID: String { id.subagentID }
  var sessionID: String { id.sessionID }
  var turnID: String? { id.turnID }
  var displayDetail: String? { detail ?? task }

  var runsInWorkflow: Bool { role == Self.workflowRole }

  var transcriptDirectoryPath: String? {
    transcriptPath.map {
      URL(fileURLWithPath: $0)
        .deletingLastPathComponent()
        .standardizedFileURL
        .path
    }
  }

  private static let workflowRole = "workflow-subagent"
}

nonisolated struct TerminalAgentStatePresentation: Equatable, Sendable {
  let agent: SupatermAgentKind
  let sessionID: String
  let phase: AgentActivityPhase
  let detail: String?
  let hoverMessages: [String]
  let latestMessage: String?
  let isActionable: Bool
  let progressRows: [PaneAgentProgressRow]
  let activeChildren: [TerminalAgentActiveChild]
  let turnLifecycle: TerminalAgentTurnLifecycle
  let workingDirectoryPath: String?

  var hasActivity: Bool {
    turnLifecycle != .unseen || !activeChildren.isEmpty
  }
}

nonisolated struct TerminalAgentStateSnapshot: Equatable, Sendable {
  let agent: SupatermAgentKind
  let sessionID: String
  let surfaceID: UUID
  let processes: Set<TerminalAgentProcessIdentity>
  let transcriptPath: String?
  let turnLifecycle: TerminalAgentTurnLifecycle
  let phase: AgentActivityPhase
  let detail: String?
  let attentionRequestID: String?
  let hoverMessages: [String]
  let previousMessage: String?
  let isActionable: Bool
  let progressRowsBySource: [TerminalAgentEvent.ProgressSource: [PaneAgentProgressRow]]
  let activeChildren: [TerminalAgentActiveChild]
  let hasPendingBackgroundWork: Bool
  let isForeground: Bool
  let revision: Int
  let workingDirectoryPath: String?

  var processIDs: Set<Int32> {
    Set(processes.map(\.processID))
  }
}

nonisolated struct TerminalAgentStateStore {
  private struct ForegroundKey: Hashable {
    let surfaceID: UUID
    let agent: SupatermAgentKind

    func hash(into hasher: inout Hasher) {
      hasher.combine(surfaceID)
      hasher.combine(agent.rawValue)
    }
  }

  private struct SessionKey: Hashable {
    let agent: SupatermAgentKind
    let sessionID: String

    func hash(into hasher: inout Hasher) {
      hasher.combine(agent.rawValue)
      hasher.combine(sessionID)
    }
  }

  private struct SessionState: Equatable {
    var activeChildren: [TerminalAgentActiveChild.Identity: TerminalAgentActiveChild] = [:]
    var detail: String?
    var attentionRequestID: String?
    var hoverMessages: [String] = []
    var previousMessage: String?
    var hasPendingBackgroundWork = false
    var isActionable = false
    var phase = AgentActivityPhase.idle
    var processes: Set<TerminalAgentProcessIdentity> = []
    var progressRowsBySource: [TerminalAgentEvent.ProgressSource: [PaneAgentProgressRow]] = [:]
    var revision = 0
    var surfaceID: UUID?
    var transcriptPath: String?
    var turnLifecycle = TerminalAgentTurnLifecycle.unseen
    var workingDirectoryPath: String?
  }

  private var foregroundSessions: [ForegroundKey: String] = [:]
  private var nextRevision = 1
  private let processIdentity: (Int32) -> TerminalAgentProcessIdentity?
  private var sessions: [SessionKey: SessionState] = [:]

  init(
    processIdentity: @escaping (Int32) -> TerminalAgentProcessIdentity? =
      TerminalAgentProcessInspector.identity(for:)
  ) {
    self.processIdentity = processIdentity
  }

  @discardableResult
  mutating func apply(_ event: TerminalAgentEvent) -> Bool {
    guard let key = sessionKey(for: event) else { return false }
    let isNewSession = sessions[key] == nil
    var state = sessions[key] ?? SessionState()
    guard accepts(event, state: state, sessionExists: !isNewSession) else { return false }
    if event.scope.subagentID == nil,
      case .sessionStarted = event.action
    {
      state = SessionState()
    }
    bind(event, to: &state)
    if event.scope.subagentID != nil {
      applyChild(event, to: &state)
      store(state, for: key)
      return true
    }
    if case .sessionEnded = event.action {
      clearSession(agent: event.scope.agent, sessionID: event.scope.sessionID)
      return true
    }
    promoteRootIfNeeded(event, state: state, isNewSession: isNewSession)
    applyRoot(event, to: &state)
    store(state, for: key)
    return true
  }

  private func accepts(
    _ event: TerminalAgentEvent,
    state: SessionState,
    sessionExists: Bool
  ) -> Bool {
    if event.scope.subagentID != nil {
      return acceptsChild(event, state: state)
    }
    switch event.action {
    case .sessionStarted, .sessionResumed, .turnStarted:
      return true
    case .sessionEnded:
      return sessionExists
    case .turnCompleted, .turnContinuesInBackground:
      return state.turnLifecycle == .unseen
        || targetsActiveTurn(event.scope.turnID, state: state)
    case .attentionRequested, .progressUpdated(_, source: .nativePlan):
      return state.turnLifecycle == .unseen
        || targetsActiveTurnOrCanAdopt(event.scope.turnID, state: state)
    case .turnRunning:
      return
        (state.turnLifecycle == .unseen
        || targetsActiveTurnOrCanAdopt(event.scope.turnID, state: state))
        && state.phase != .needsInput
    case .attentionResolved(let requestID):
      return targetsActiveTurn(event.scope.turnID, state: state)
        && state.phase == .needsInput
        && (state.attentionRequestID == nil || state.attentionRequestID == requestID)
    case .hoverMessagesUpdated, .progressUpdated(_, source: .transcript):
      return acceptsTranscriptProjection(turnID: event.scope.turnID, state: state)
    case .subagentsReconciled:
      return true
    case .subagentDescribed, .subagentStarted, .subagentStopped:
      return false
    }
  }

  private func acceptsChild(
    _ event: TerminalAgentEvent,
    state: SessionState
  ) -> Bool {
    guard let key = Self.childKey(for: event) else { return false }
    if case .subagentStarted = event.action { return true }
    guard let child = state.activeChildren[key] else { return false }
    switch event.action {
    case .subagentDescribed, .subagentStopped, .attentionRequested, .turnStarted,
      .turnContinuesInBackground:
      return true
    case .attentionResolved(let requestID):
      return child.phase == .needsInput
        && (child.attentionRequestID == nil || child.attentionRequestID == requestID)
    case .turnRunning:
      return child.phase != .needsInput
    case .hoverMessagesUpdated, .progressUpdated, .sessionEnded, .sessionResumed, .sessionStarted,
      .subagentStarted, .subagentsReconciled, .turnCompleted:
      return false
    }
  }

  private func sessionKey(for event: TerminalAgentEvent) -> SessionKey? {
    let key = SessionKey(agent: event.scope.agent, sessionID: event.scope.sessionID)
    guard event.scope.subagentID != nil else { return key }
    return sessions[key] == nil ? nil : key
  }

  private func bind(
    _ event: TerminalAgentEvent,
    to state: inout SessionState
  ) {
    if state.surfaceID == nil, let surfaceID = event.context?.surfaceID {
      state.surfaceID = surfaceID
    }
    if event.scope.subagentID == nil,
      let workingDirectoryPath = Self.normalizedWorkingDirectoryPath(event.workingDirectoryPath)
    {
      state.workingDirectoryPath = workingDirectoryPath
    }
    if let processID = event.processID,
      let identity = processIdentity(processID)
    {
      state.processes = state.processes.filter { $0.processID != processID }
      state.processes.insert(identity)
    }
  }

  private mutating func promoteRootIfNeeded(
    _ event: TerminalAgentEvent,
    state: SessionState,
    isNewSession: Bool
  ) {
    guard let surfaceID = state.surfaceID else { return }
    let key = ForegroundKey(surfaceID: surfaceID, agent: event.scope.agent)
    switch event.action {
    case .turnStarted:
      foregroundSessions[key] = event.scope.sessionID
    case .attentionRequested, .progressUpdated, .turnContinuesInBackground, .turnRunning:
      if foregroundSessions[key] == nil
        || (event.origin == .native && (isNewSession || !state.isActionable))
      {
        foregroundSessions[key] = event.scope.sessionID
      }
    default:
      break
    }
  }

  private mutating func applyRoot(
    _ event: TerminalAgentEvent,
    to state: inout SessionState
  ) {
    switch event.action {
    case .sessionResumed(let transcriptPath), .sessionStarted(let transcriptPath):
      state.transcriptPath = transcriptPath
      if let surfaceID = state.surfaceID {
        foregroundSessions[
          ForegroundKey(surfaceID: surfaceID, agent: event.scope.agent)
        ] = event.scope.sessionID
      }
    case .turnStarted:
      startTurn(event.scope.turnID, state: &state)
    case .turnCompleted(let message):
      completeTurn(
        event.scope.turnID,
        message: message,
        makesActionable: event.origin == .native,
        state: &state
      )
    case .turnContinuesInBackground:
      continueTurnInBackground(
        event.scope.turnID,
        makesActionable: event.origin == .native,
        state: &state
      )
    case .attentionRequested(let requestID, let message):
      requestAttention(requestID: requestID, message: message, turnID: event.scope.turnID, state: &state)
    case .turnRunning(let detail):
      runTurn(
        detail,
        turnID: event.scope.turnID,
        makesActionable: event.origin == .native,
        state: &state
      )
    case .attentionResolved(let requestID):
      resolveAttention(requestID: requestID, turnID: event.scope.turnID, state: &state)
    case .subagentsReconciled(let liveSubagentIDs, let hasRunningWorkflow):
      state.activeChildren = state.activeChildren.filter { _, child in
        child.runsInWorkflow
          ? hasRunningWorkflow
          : liveSubagentIDs.contains(child.subagentID)
      }
    case .hoverMessagesUpdated(let messages):
      updateHoverMessages(messages, turnID: event.scope.turnID, state: &state)
    case .progressUpdated(let rows, let source):
      updateProgress(rows, source: source, turnID: event.scope.turnID, state: &state)
    case .sessionEnded, .subagentDescribed, .subagentStarted, .subagentStopped:
      break
    }
  }

  private func applyChild(
    _ event: TerminalAgentEvent,
    to state: inout SessionState
  ) {
    guard let childKey = Self.childKey(for: event) else { return }
    switch event.action {
    case .subagentStarted(let nickname, let role, let task, let transcriptPath, let usage):
      state.activeChildren = state.activeChildren.filter {
        $0.key.subagentID != childKey.subagentID || $0.key == childKey
      }
      if let child = state.activeChildren[childKey] {
        let updated = child.updating(
          nickname: nickname,
          role: role,
          task: task,
          transcriptPath: transcriptPath,
          usage: usage
        )
        state.activeChildren[childKey] =
          child.phase == .idle ? updated.updating(phase: .running, detail: nil) : updated
      } else {
        state.activeChildren[childKey] = TerminalAgentActiveChild(
          id: childKey,
          nickname: nickname,
          role: role,
          transcriptPath: transcriptPath,
          task: task,
          phase: .running,
          detail: nil,
          usage: usage
        )
      }
    case .subagentDescribed(let nickname, let task, let transcriptPath, let usage):
      guard let child = state.activeChildren[childKey] else { return }
      state.activeChildren[childKey] = child.updating(
        nickname: nickname,
        task: task,
        transcriptPath: transcriptPath,
        usage: usage
      )
    case .subagentStopped(let usage):
      guard let child = state.activeChildren[childKey], child.runsInWorkflow else {
        state.activeChildren.removeValue(forKey: childKey)
        return
      }
      state.activeChildren[childKey] = child.updating(
        phase: .idle,
        detail: nil,
        usage: usage
      )
    default:
      updateChild(event.action, key: childKey, state: &state)
    }
  }

  private func updateChild(
    _ action: TerminalAgentEvent.Action,
    key: TerminalAgentActiveChild.Identity,
    state: inout SessionState
  ) {
    guard let child = state.activeChildren[key] else { return }
    let update: (AgentActivityPhase, String?)?
    switch action {
    case .attentionRequested(let requestID, let message):
      state.activeChildren[key] = child.updating(
        phase: .needsInput,
        detail: message,
        attentionRequestID: requestID
      )
      return
    case .attentionResolved(let requestID)
    where child.phase == .needsInput
      && (child.attentionRequestID == nil || child.attentionRequestID == requestID):
      update = (.running, nil)
    case .turnStarted: update = (.running, nil)
    case .turnContinuesInBackground: update = (.running, nil)
    case .turnRunning(let detail) where child.phase != .needsInput: update = (.running, detail)
    default: update = nil
    }
    if let update {
      state.activeChildren[key] = child.updating(phase: update.0, detail: update.1)
    }
  }

  private func startTurn(
    _ turnID: String?,
    state: inout SessionState
  ) {
    state.activeChildren = state.activeChildren.filter { $0.key.turnID == turnID }
    state.previousMessage = state.hoverMessages.last ?? state.previousMessage
    state.turnLifecycle = .active(turnID)
    state.isActionable = true
    state.phase = .running
    state.detail = nil
    state.attentionRequestID = nil
    state.hoverMessages = []
    state.progressRowsBySource = [:]
  }

  private func completeTurn(
    _ turnID: String?,
    message: String?,
    makesActionable: Bool,
    state: inout SessionState
  ) {
    if state.turnLifecycle == .unseen {
      state.turnLifecycle = .completed(turnID)
    } else {
      guard targetsActiveTurn(turnID, state: state) else { return }
      state.turnLifecycle = .completed(turnID)
    }
    state.hasPendingBackgroundWork = false
    state.isActionable = state.isActionable || makesActionable
    state.phase = .idle
    state.detail = nil
    state.attentionRequestID = nil
    state.progressRowsBySource = [:]
    if let message = Self.normalizedMessages([message].compactMap(\.self)).first {
      state.hoverMessages = [message]
    }
  }

  private func continueTurnInBackground(
    _ turnID: String?,
    makesActionable: Bool,
    state: inout SessionState
  ) {
    recoverTurnIfNeeded(turnID, state: &state)
    guard targetsActiveTurn(turnID, state: state) else { return }
    state.hasPendingBackgroundWork = true
    state.isActionable = state.isActionable || makesActionable
    state.phase = .running
    state.detail = nil
    state.attentionRequestID = nil
  }

  private func requestAttention(
    requestID: String?,
    message: String?,
    turnID: String?,
    state: inout SessionState
  ) {
    recoverTurnIfNeeded(turnID, state: &state)
    guard targetsActiveTurn(turnID, state: state) else { return }
    state.isActionable = true
    state.phase = .needsInput
    state.detail = message
    state.attentionRequestID = requestID
  }

  private func runTurn(
    _ detail: String?,
    turnID: String?,
    makesActionable: Bool,
    state: inout SessionState
  ) {
    recoverTurnIfNeeded(turnID, state: &state)
    guard targetsActiveTurn(turnID, state: state), state.phase != .needsInput else { return }
    state.isActionable = state.isActionable || makesActionable
    state.phase = .running
    state.detail = detail
  }

  private func resolveAttention(
    requestID: String?,
    turnID: String?,
    state: inout SessionState
  ) {
    guard targetsActiveTurn(turnID, state: state), state.phase == .needsInput,
      state.attentionRequestID == nil || state.attentionRequestID == requestID
    else {
      return
    }
    state.isActionable = true
    state.phase = .running
    state.detail = nil
    state.attentionRequestID = nil
  }

  private func updateProgress(
    _ rows: [PaneAgentProgressRow],
    source: TerminalAgentEvent.ProgressSource,
    turnID: String?,
    state: inout SessionState
  ) {
    if source == .nativePlan {
      recoverTurnIfNeeded(turnID, state: &state)
      guard targetsActiveTurn(turnID, state: state) else { return }
      state.isActionable = true
    } else {
      guard acceptsTranscriptProjection(turnID: turnID, state: state) else { return }
    }
    state.progressRowsBySource[source] = rows
  }

  private func updateHoverMessages(
    _ messages: [String],
    turnID: String?,
    state: inout SessionState
  ) {
    guard acceptsTranscriptProjection(turnID: turnID, state: state) else { return }
    state.hoverMessages = Self.normalizedMessages(messages)
  }

  private func acceptsTranscriptProjection(
    turnID: String?,
    state: SessionState
  ) -> Bool {
    switch state.turnLifecycle {
    case .unseen:
      return true
    case .active(let activeTurnID):
      return turnID == nil || activeTurnID == turnID
    case .completed:
      return false
    }
  }

  private func recoverTurnIfNeeded(
    _ turnID: String?,
    state: inout SessionState
  ) {
    switch state.turnLifecycle {
    case .unseen:
      state.turnLifecycle = .active(turnID)
      state.phase = .running
    case .active(nil) where turnID != nil:
      state.turnLifecycle = .active(turnID)
    case .active, .completed:
      break
    }
  }

  private func targetsActiveTurn(
    _ turnID: String?,
    state: SessionState
  ) -> Bool {
    guard case .active(let activeTurnID) = state.turnLifecycle else { return false }
    return turnID == nil || activeTurnID == turnID
  }

  private func targetsActiveTurnOrCanAdopt(
    _ turnID: String?,
    state: SessionState
  ) -> Bool {
    guard case .active(let activeTurnID) = state.turnLifecycle else { return false }
    return activeTurnID == nil || turnID == nil || activeTurnID == turnID
  }

  func presentation(
    for surfaceID: UUID,
    agent: SupatermAgentKind
  ) -> TerminalAgentStatePresentation? {
    guard
      let sessionID = foregroundSessions[
        ForegroundKey(surfaceID: surfaceID, agent: agent)
      ],
      let state = sessions[SessionKey(agent: agent, sessionID: sessionID)]
    else {
      return nil
    }
    let activeChildren = Self.sortedChildren(state.activeChildren.values)
    let phase = activeChildren.reduce(state.phase) { max($0, $1.phase) }
    let detail =
      state.phase == phase
      ? state.detail
      : activeChildren.first(where: { $0.phase == phase })?.displayDetail
    return TerminalAgentStatePresentation(
      agent: agent,
      sessionID: sessionID,
      phase: phase,
      detail: detail,
      hoverMessages: state.hoverMessages,
      latestMessage: state.hoverMessages.last ?? state.previousMessage,
      isActionable: state.isActionable,
      progressRows: Self.progressRows(in: state),
      activeChildren: activeChildren,
      turnLifecycle: state.turnLifecycle,
      workingDirectoryPath: state.workingDirectoryPath
    )
  }

  func foregroundSessionID(
    for surfaceID: UUID,
    agent: SupatermAgentKind
  ) -> String? {
    foregroundSessions[ForegroundKey(surfaceID: surfaceID, agent: agent)]
  }

  func isForeground(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> Bool {
    guard let surfaceID = surfaceID(agent: agent, sessionID: sessionID) else { return false }
    return foregroundSessionID(for: surfaceID, agent: agent) == sessionID
  }

  func hasBackgroundWork(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> Bool {
    sessions[SessionKey(agent: agent, sessionID: sessionID)]?.hasPendingBackgroundWork
      == true
  }

  func surfaceID(
    agent: SupatermAgentKind,
    sessionID: String
  ) -> UUID? {
    sessions[SessionKey(agent: agent, sessionID: sessionID)]?.surfaceID
  }

  func snapshots(for surfaceID: UUID) -> [TerminalAgentStateSnapshot] {
    sessions.compactMap { key, state in
      guard state.surfaceID == surfaceID else { return nil }
      return TerminalAgentStateSnapshot(
        agent: key.agent,
        sessionID: key.sessionID,
        surfaceID: surfaceID,
        processes: state.processes,
        transcriptPath: state.transcriptPath,
        turnLifecycle: state.turnLifecycle,
        phase: state.phase,
        detail: state.detail,
        attentionRequestID: state.attentionRequestID,
        hoverMessages: state.hoverMessages,
        previousMessage: state.previousMessage,
        isActionable: state.isActionable,
        progressRowsBySource: state.progressRowsBySource,
        activeChildren: Self.sortedChildren(state.activeChildren.values),
        hasPendingBackgroundWork: state.hasPendingBackgroundWork,
        isForeground: foregroundSessionID(for: surfaceID, agent: key.agent) == key.sessionID,
        revision: state.revision,
        workingDirectoryPath: state.workingDirectoryPath
      )
    }
    .sorted { lhs, rhs in
      if lhs.agent.rawValue == rhs.agent.rawValue {
        return lhs.sessionID < rhs.sessionID
      }
      return lhs.agent.rawValue < rhs.agent.rawValue
    }
  }

  mutating func restore(_ snapshots: [TerminalAgentStateSnapshot]) {
    for snapshot in snapshots {
      let key = SessionKey(agent: snapshot.agent, sessionID: snapshot.sessionID)
      sessions[key] = SessionState(
        activeChildren: Dictionary(
          uniqueKeysWithValues: snapshot.activeChildren.map {
            ($0.id, $0)
          }
        ),
        detail: snapshot.detail,
        attentionRequestID: snapshot.attentionRequestID,
        hoverMessages: snapshot.hoverMessages,
        previousMessage: snapshot.previousMessage,
        hasPendingBackgroundWork: snapshot.hasPendingBackgroundWork,
        isActionable: snapshot.isActionable,
        phase: snapshot.phase,
        processes: snapshot.processes,
        progressRowsBySource: snapshot.progressRowsBySource,
        revision: snapshot.revision,
        surfaceID: snapshot.surfaceID,
        transcriptPath: snapshot.transcriptPath,
        turnLifecycle: snapshot.turnLifecycle,
        workingDirectoryPath: snapshot.workingDirectoryPath
      )
      if snapshot.isForeground {
        foregroundSessions[
          ForegroundKey(surfaceID: snapshot.surfaceID, agent: snapshot.agent)
        ] = snapshot.sessionID
      }
      nextRevision = max(nextRevision, snapshot.revision + 1)
    }
  }

  func hasSession(agent: SupatermAgentKind, sessionID: String) -> Bool {
    sessions[SessionKey(agent: agent, sessionID: sessionID)] != nil
  }

  @discardableResult
  mutating func removeChildren(
    agent: SupatermAgentKind,
    sessionID: String,
    transcriptDirectoryPath: String
  ) -> Bool {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    guard var state = sessions[key] else { return false }
    let transcriptDirectoryPath = URL(fileURLWithPath: transcriptDirectoryPath).standardizedFileURL
      .path
    let count = state.activeChildren.count
    state.activeChildren = state.activeChildren.filter { _, child in
      child.transcriptDirectoryPath != transcriptDirectoryPath
    }
    guard state.activeChildren.count != count else { return false }
    store(state, for: key)
    return true
  }

  @discardableResult
  mutating func pruneDeadProcesses(
    isProcessCurrent: (TerminalAgentProcessIdentity) -> Bool,
    didClearSession: (SupatermAgentKind, String) -> Void
  ) -> Set<UUID> {
    var changedSurfaceIDs: Set<UUID> = []
    let keys = Array(sessions.keys)
    for key in keys {
      guard var state = sessions[key], !state.processes.isEmpty else { continue }
      let currentProcesses = Set(state.processes.filter(isProcessCurrent))
      guard currentProcesses != state.processes else { continue }
      if let surfaceID = state.surfaceID {
        changedSurfaceIDs.insert(surfaceID)
      }
      if currentProcesses.isEmpty {
        clearSession(agent: key.agent, sessionID: key.sessionID)
        didClearSession(key.agent, key.sessionID)
      } else {
        state.processes = currentProcesses
        store(state, for: key)
      }
    }
    return changedSurfaceIDs
  }

  mutating func clearSession(
    agent: SupatermAgentKind,
    sessionID: String
  ) {
    let key = SessionKey(agent: agent, sessionID: sessionID)
    guard let state = sessions.removeValue(forKey: key),
      let surfaceID = state.surfaceID
    else {
      return
    }
    let foregroundKey = ForegroundKey(surfaceID: surfaceID, agent: agent)
    if foregroundSessions[foregroundKey] == sessionID {
      foregroundSessions.removeValue(forKey: foregroundKey)
    }
  }

  mutating func clearSessions(for surfaceID: UUID) {
    let keys = sessions.compactMap { key, state in
      state.surfaceID == surfaceID ? key : nil
    }
    for key in keys {
      clearSession(agent: key.agent, sessionID: key.sessionID)
    }
  }

  private mutating func store(_ state: SessionState, for key: SessionKey) {
    guard sessions[key] != state else { return }
    var state = state
    state.revision = nextRevision
    nextRevision += 1
    sessions[key] = state
  }

  private static func progressRows(in state: SessionState) -> [PaneAgentProgressRow] {
    let transcript = state.progressRowsBySource[.transcript] ?? []
    guard let nativePlan = state.progressRowsBySource[.nativePlan], !nativePlan.isEmpty else {
      return transcript
    }
    return transcript.filter { $0.kind == .goal } + nativePlan
  }

  private static func normalizedMessages(_ messages: [String]) -> [String] {
    messages.compactMap { message in
      let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
      return message.isEmpty ? nil : message
    }
  }

  private static func normalizedWorkingDirectoryPath(_ path: String?) -> String? {
    TerminalAgentPanelWorkspaceKey(workingDirectoryPath: path)?.workingDirectoryPath
  }

  private static func sortedChildren(
    _ children: Dictionary<TerminalAgentActiveChild.Identity, TerminalAgentActiveChild>.Values
  ) -> [TerminalAgentActiveChild] {
    children.sorted {
      ($0.subagentID, $0.sessionID, $0.turnID ?? "")
        < ($1.subagentID, $1.sessionID, $1.turnID ?? "")
    }
  }

  private static func childKey(for event: TerminalAgentEvent) -> TerminalAgentActiveChild.Identity? {
    event.scope.subagentID.map {
      TerminalAgentActiveChild.Identity(
        subagentID: $0,
        sessionID: event.scope.sessionID,
        turnID: event.scope.turnID
      )
    }
  }
}

extension TerminalAgentActiveChild {
  fileprivate nonisolated func updating(
    nickname: String?,
    role: String? = nil,
    task: String?,
    transcriptPath: String? = nil,
    usage: TerminalAgentChildUsage? = nil
  ) -> Self {
    Self(
      id: id,
      nickname: nickname ?? self.nickname,
      role: role ?? self.role,
      transcriptPath: transcriptPath ?? self.transcriptPath,
      task: task ?? self.task,
      phase: phase,
      detail: detail,
      attentionRequestID: attentionRequestID,
      usage: usage ?? self.usage
    )
  }

  fileprivate nonisolated func updating(
    phase: AgentActivityPhase,
    detail: String?,
    attentionRequestID: String? = nil,
    usage: TerminalAgentChildUsage? = nil
  ) -> Self {
    Self(
      id: id,
      nickname: nickname,
      role: role,
      transcriptPath: transcriptPath,
      task: task,
      phase: phase,
      detail: detail,
      attentionRequestID: attentionRequestID,
      usage: usage ?? self.usage
    )
  }
}
