import Foundation
import SupatermCLIShared

nonisolated enum AgentActivityPhase: Codable, Equatable, Sendable {
  case idle
  case needsInput
  case running
}

nonisolated enum TerminalAgentTurnLifecycle: Codable, Equatable, Sendable {
  case active(String?)
  case completed(String?)
  case unseen
}

nonisolated struct TerminalAgentActiveChild: Codable, Equatable, Identifiable, Sendable {
  struct Identity: Codable, Equatable, Hashable, Sendable {
    let subagentID: String
    let sessionID: String
    let turnID: String?
  }

  let id: Identity
  let type: String?
  let phase: AgentActivityPhase
  let detail: String?
  let attentionRequestID: String?

  init(
    id: Identity,
    type: String?,
    phase: AgentActivityPhase,
    detail: String?,
    attentionRequestID: String? = nil
  ) {
    self.id = id
    self.type = type
    self.phase = phase
    self.detail = detail
    self.attentionRequestID = attentionRequestID
  }

  var subagentID: String { id.subagentID }
  var sessionID: String { id.sessionID }
  var turnID: String? { id.turnID }
}

nonisolated struct TerminalAgentStatePresentation: Equatable, Sendable {
  let agent: SupatermAgentKind
  let sessionID: String
  let phase: AgentActivityPhase
  let detail: String?
  let hoverMessages: [String]
  let isActionable: Bool
  let progressRows: [PaneAgentProgressRow]
  let activeChildren: [TerminalAgentActiveChild]
  let turnLifecycle: TerminalAgentTurnLifecycle

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
  let isActionable: Bool
  let progressRowsBySource: [TerminalAgentEvent.ProgressSource: [PaneAgentProgressRow]]
  let activeChildren: [TerminalAgentActiveChild]
  let isForeground: Bool
  let revision: Int

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
    var isActionable = false
    var phase = AgentActivityPhase.idle
    var processes: Set<TerminalAgentProcessIdentity> = []
    var progressRowsBySource: [TerminalAgentEvent.ProgressSource: [PaneAgentProgressRow]] = [:]
    var revision = 0
    var surfaceID: UUID?
    var transcriptPath: String?
    var turnLifecycle = TerminalAgentTurnLifecycle.unseen
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
    case .turnCompleted:
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
    case .subagentStarted, .subagentStopped:
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
    case .subagentStopped, .attentionRequested, .turnStarted, .turnCompleted:
      return true
    case .attentionResolved(let requestID):
      return child.phase == .needsInput
        && (child.attentionRequestID == nil || child.attentionRequestID == requestID)
    case .turnRunning:
      return child.phase != .needsInput
    case .hoverMessagesUpdated, .progressUpdated, .sessionEnded, .sessionResumed, .sessionStarted,
      .subagentStarted:
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
    case .attentionRequested, .progressUpdated, .turnRunning:
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
    case .hoverMessagesUpdated(let messages):
      updateHoverMessages(messages, turnID: event.scope.turnID, state: &state)
    case .progressUpdated(let rows, let source):
      updateProgress(rows, source: source, turnID: event.scope.turnID, state: &state)
    case .sessionEnded, .subagentStarted, .subagentStopped:
      break
    }
  }

  private func applyChild(
    _ event: TerminalAgentEvent,
    to state: inout SessionState
  ) {
    guard let childKey = Self.childKey(for: event) else { return }
    switch event.action {
    case .subagentStarted(let type):
      state.activeChildren = state.activeChildren.filter {
        $0.key.subagentID != childKey.subagentID || $0.key == childKey
      }
      if state.activeChildren[childKey] == nil {
        state.activeChildren[childKey] = TerminalAgentActiveChild(
          id: childKey,
          type: type,
          phase: .running,
          detail: nil
        )
      }
    case .subagentStopped:
      state.activeChildren.removeValue(forKey: childKey)
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
    case .turnCompleted: update = (.idle, nil)
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
    state.isActionable = state.isActionable || makesActionable
    state.phase = .idle
    state.detail = nil
    state.attentionRequestID = nil
    state.progressRowsBySource = [:]
    if let message = Self.normalizedMessages([message].compactMap(\.self)).first {
      state.hoverMessages = [message]
    }
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
    let phase = activeChildren.reduce(state.phase) { phase, child in
      Self.highest(phase, child.phase)
    }
    let detail =
      state.phase == phase
      ? state.detail
      : activeChildren.first(where: { $0.phase == phase })?.detail
    return TerminalAgentStatePresentation(
      agent: agent,
      sessionID: sessionID,
      phase: phase,
      detail: detail,
      hoverMessages: state.hoverMessages,
      isActionable: state.isActionable,
      progressRows: Self.progressRows(in: state),
      activeChildren: activeChildren,
      turnLifecycle: state.turnLifecycle
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
        isActionable: state.isActionable,
        progressRowsBySource: state.progressRowsBySource,
        activeChildren: Self.sortedChildren(state.activeChildren.values),
        isForeground: foregroundSessionID(for: surfaceID, agent: key.agent) == key.sessionID,
        revision: state.revision
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
        isActionable: snapshot.isActionable,
        phase: snapshot.phase,
        processes: snapshot.processes,
        progressRowsBySource: snapshot.progressRowsBySource,
        revision: snapshot.revision,
        surfaceID: snapshot.surfaceID,
        transcriptPath: snapshot.transcriptPath,
        turnLifecycle: snapshot.turnLifecycle
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

  private static func highest(
    _ lhs: AgentActivityPhase,
    _ rhs: AgentActivityPhase
  ) -> AgentActivityPhase {
    rank(lhs) >= rank(rhs) ? lhs : rhs
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

  private static func rank(_ phase: AgentActivityPhase) -> Int {
    switch phase {
    case .idle: 0
    case .running: 1
    case .needsInput: 2
    }
  }
}

extension TerminalAgentActiveChild {
  fileprivate nonisolated func updating(
    phase: AgentActivityPhase,
    detail: String?,
    attentionRequestID: String? = nil
  ) -> Self {
    Self(
      id: id,
      type: type,
      phase: phase,
      detail: detail,
      attentionRequestID: attentionRequestID
    )
  }
}
