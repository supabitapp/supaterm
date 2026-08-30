import Foundation
import SupatermSupport

nonisolated struct TerminalAgentDetectionExplanation: Equatable, Sendable {
  enum Status: String, Equatable, Sendable {
    case detected
    case disabled
    case nativeAuthority
    case noForegroundProcess
    case noRuleMatchOrSettling
    case protectedOrUnreadableScreen
    case unrecognizedProcess
    case waiting
  }

  let generation: UInt64?
  let status: Status
  let processIdentity: TerminalAgentProcessIdentity?
  let agent: AgentDetectionAgentIdentity?
  let matchedRuleID: String?
  let publishedPhase: AgentActivityPhase?
  let publishedRuleID: String?

  static let disabled = TerminalAgentDetectionExplanation(
    generation: nil,
    status: .disabled,
    processIdentity: nil,
    agent: nil,
    matchedRuleID: nil,
    publishedPhase: nil,
    publishedRuleID: nil
  )
}

nonisolated struct TerminalAgentDetectionSurfaceKey: Equatable, Hashable, Sendable {
  let id: UUID
  let instance: ObjectIdentifier
  let foregroundProcessGroupID: Int32?
}

nonisolated struct TerminalAgentDetectionSurfaceSnapshot: Equatable, Sendable {
  let key: TerminalAgentDetectionSurfaceKey
}

nonisolated struct TerminalAgentDetectionSignals: Equatable, Sendable {
  let oscTitle: String
  let oscProgress: String

  init(oscTitle: String, oscProgress: String = "") {
    self.oscTitle = oscTitle
    self.oscProgress = oscProgress
  }
}

nonisolated struct TerminalAgentDetectionRuleAccess: Sendable {
  let snapshot: @Sendable () async -> AgentDetectionRuleSnapshot
  let evaluateSignals: @Sendable ([AgentDetectionSignalRequest]) async -> [AgentDetectionSignalEvaluation?]
  let evaluate: @Sendable ([AgentDetectionEvaluationRequest]) async -> [AgentDetectionEvaluation?]

  init(repository: AgentDetectionRuleRepository) {
    snapshot = { await repository.snapshot() }
    evaluateSignals = { requests in
      await repository.evaluateSignals(requests)
    }
    evaluate = { requests in
      await repository.evaluate(requests)
    }
  }

  init(
    snapshot: @escaping @Sendable () async -> AgentDetectionRuleSnapshot,
    evaluateSignals:
      @escaping @Sendable ([AgentDetectionSignalRequest]) async ->
      [AgentDetectionSignalEvaluation?],
    evaluate:
      @escaping @Sendable ([AgentDetectionEvaluationRequest]) async ->
      [AgentDetectionEvaluation?]
  ) {
    self.snapshot = snapshot
    self.evaluateSignals = evaluateSignals
    self.evaluate = evaluate
  }
}

nonisolated struct TerminalAgentDetectionSampler: Sendable {
  let resolveForegroundProcessGroups: @Sendable ([UUID: Int32]) async -> [UUID: Int32]
  let matches:
    @Sendable (Set<Int32>, [AgentDetectionProcessManifest]) async ->
      [Int32: AgentDetectionProcessMatch]
  let current: @Sendable (Set<TerminalAgentProcessIdentity>) async -> Set<TerminalAgentProcessIdentity>
}

@MainActor
struct TerminalAgentDetectionHostAccess {
  let surfaces: () -> [TerminalAgentDetectionSurfaceSnapshot]
  let signals: (TerminalAgentDetectionSurfaceKey) -> TerminalAgentDetectionSignals?
  let screen: (TerminalAgentDetectionSurfaceKey) -> String?
  let nativeAuthority: (UUID) -> Set<TerminalAgentProcessIdentity>
  let observation: (UUID) -> TerminalAgentDetectionObservation?
  let apply: (TerminalAgentDetectionObservation, UUID) -> Bool
  let clear: (UUID) -> Void
  var pruneDeadAgentProcesses: () -> Void = {}
}

private actor TerminalAgentDetectionLiveSampler {
  private let zmxClient: ZmxClient
  private let zmxSessionsEnabled: Bool
  private let processSampler: AgentDetectionProcessSampler

  init(
    zmxClient: ZmxClient,
    zmxSessionsEnabled: Bool,
    processSampler: AgentDetectionProcessSampler
  ) {
    self.zmxClient = zmxClient
    self.zmxSessionsEnabled = zmxSessionsEnabled
    self.processSampler = processSampler
  }

  func resolveForegroundProcessGroups(_ direct: [UUID: Int32]) async -> [UUID: Int32] {
    guard zmxSessionsEnabled, let sessions = await zmxClient.listSessions() else {
      return direct
    }
    var resolved = direct
    for session in sessions {
      guard
        direct[session.surfaceID] != nil,
        let processGroupID = TerminalAgentProcessInspector.foregroundProcessGroupID(
          for: session.processID
        )
      else {
        continue
      }
      resolved[session.surfaceID] = processGroupID
    }
    return resolved
  }

  func matches(
    foregroundProcessGroupIDs: Set<Int32>,
    manifests: [AgentDetectionProcessManifest]
  ) async -> [Int32: AgentDetectionProcessMatch] {
    await processSampler.matches(
      foregroundProcessGroupIDs: foregroundProcessGroupIDs,
      manifests: manifests
    )
  }

  func current(
    _ identities: Set<TerminalAgentProcessIdentity>
  ) -> Set<TerminalAgentProcessIdentity> {
    identities.filter(TerminalAgentProcessInspector.isCurrent)
  }
}

@MainActor
final class TerminalAgentDetectionController {
  static let screenByteLimit = 64 * 1_024
  static let titleByteLimit = 4 * 1_024

  private static let phaseDetectionMinimumAgeMicroseconds: UInt64 = 3_000_000
  private static let evaluationInterval: Duration = .milliseconds(300)
  private static let idleConfirmationInterval: Duration = .milliseconds(100)
  private static let processAcquisitionInterval: Duration = .milliseconds(500)
  private static let processAcquisitionWindow: Duration = .milliseconds(1_500)
  private static let recognizedProcessInterval: Duration = .seconds(5)
  private static let unrecognizedProcessInterval: Duration = .seconds(2)
  private static let processSampler = AgentDetectionProcessSampler()

  private typealias Proof = AgentDetectionProcessMatch

  private struct Matched: Equatable, Sendable {
    let agent: AgentDetectionAgentIdentity
    let phase: AgentActivityPhase?
    let ruleID: String
  }

  private struct SurfaceState: Sendable {
    let key: TerminalAgentDetectionSurfaceKey
    let nonce: UInt64
    var proof: Proof?
    var nextScanAt: ContinuousClock.Instant
    var acquisitionStartedAt: ContinuousClock.Instant?
    var settler = AgentDetectionSettler<TerminalAgentProcessIdentity>()
    var matched: Matched?
    var status = TerminalAgentDetectionExplanation.Status.waiting
  }

  private struct EvaluationAttempt: Sendable {
    let surfaceID: UUID
    let state: SurfaceState
    let proof: Proof
    let signals: AgentDetectionSignalInput
  }

  private struct EvaluationBatch: Sendable {
    let attempts: [EvaluationAttempt]
    var evaluations: [UUID: AgentDetectionEvaluation] = [:]
    var unknownSurfaceIDs: Set<UUID> = []

    var activeAttempts: [EvaluationAttempt] {
      attempts.filter {
        evaluations[$0.surfaceID] != nil || unknownSurfaceIDs.contains($0.surfaceID)
      }
    }

    mutating func record(
      _ evaluation: AgentDetectionEvaluation?,
      for attempt: EvaluationAttempt
    ) {
      if let evaluation {
        evaluations[attempt.surfaceID] = evaluation
      } else {
        unknownSurfaceIDs.insert(attempt.surfaceID)
      }
    }
  }

  private struct ScreenEvaluationBatch: Sendable {
    var attempts: [EvaluationAttempt] = []
    var requests: [AgentDetectionEvaluationRequest] = []
  }

  private struct EvaluationValidation: Sendable {
    let generation: UInt64
    let currentIdentities: Set<TerminalAgentProcessIdentity>
    let live: [UUID: TerminalAgentDetectionSurfaceKey]
  }

  private struct DueScan: Sendable {
    let surface: TerminalAgentDetectionSurfaceSnapshot
    let nonce: UInt64
    let processGroupID: Int32
  }

  private let rules: TerminalAgentDetectionRuleAccess
  private let sampler: TerminalAgentDetectionSampler
  private let host: TerminalAgentDetectionHostAccess
  private let currentTimeMicroseconds: @MainActor () -> UInt64
  private let clock = ContinuousClock()
  private var task: Task<Void, Never>?
  private var states: [UUID: SurfaceState] = [:]
  private var generation: UInt64?
  private var nextNonce: UInt64 = 0
  private var sequence: UInt64 = 0

  convenience init(
    host terminal: TerminalHostState,
    repository: AgentDetectionRuleRepository
  ) {
    let liveSampler = TerminalAgentDetectionLiveSampler(
      zmxClient: terminal.zmxClient,
      zmxSessionsEnabled: terminal.zmxSessionsEnabled,
      processSampler: Self.processSampler
    )
    self.init(
      rules: TerminalAgentDetectionRuleAccess(repository: repository),
      sampler: TerminalAgentDetectionSampler(
        resolveForegroundProcessGroups: { processGroupIDs in
          await liveSampler.resolveForegroundProcessGroups(processGroupIDs)
        },
        matches: { processGroupIDs, manifests in
          await liveSampler.matches(
            foregroundProcessGroupIDs: processGroupIDs,
            manifests: manifests
          )
        },
        current: { identities in
          await liveSampler.current(identities)
        }
      ),
      host: Self.liveHostAccess(terminal)
    )
  }

  init(
    rules: TerminalAgentDetectionRuleAccess,
    sampler: TerminalAgentDetectionSampler,
    host: TerminalAgentDetectionHostAccess,
    currentTimeMicroseconds: @escaping @MainActor () -> UInt64 = {
      UInt64(Date.now.timeIntervalSince1970 * 1_000_000)
    }
  ) {
    self.rules = rules
    self.sampler = sampler
    self.host = host
    self.currentTimeMicroseconds = currentTimeMicroseconds
  }

  deinit {
    task?.cancel()
  }

  var isRunning: Bool {
    task != nil
  }

  func start() {
    guard task == nil else { return }
    let clock = clock
    task = Task { @MainActor [weak self, clock] in
      while !Task.isCancelled {
        await self?.tick(now: clock.now)
        guard !Task.isCancelled else { return }
        do {
          try await clock.sleep(
            for: self?.nextTickDelay(now: clock.now) ?? Self.evaluationInterval
          )
        } catch {
          return
        }
      }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
    invalidateAll()
  }

  func surfaceDidAttach(_ surfaceID: UUID) {
    invalidate(surfaceID)
  }

  func surfaceDidRemove(_ surfaceID: UUID) {
    invalidate(surfaceID)
  }

  func surfaceCommandDidFinish(_ surfaceID: UUID) {
    invalidate(surfaceID)
  }

  func explanation(for surfaceID: UUID) -> TerminalAgentDetectionExplanation {
    let observation = host.observation(surfaceID)
    guard let state = states[surfaceID] else {
      return TerminalAgentDetectionExplanation(
        generation: generation,
        status: .waiting,
        processIdentity: nil,
        agent: observation?.agent,
        matchedRuleID: nil,
        publishedPhase: observation?.phase,
        publishedRuleID: observation?.ruleID
      )
    }
    return TerminalAgentDetectionExplanation(
      generation: generation,
      status: state.status,
      processIdentity: state.proof?.processIdentity,
      agent: state.matched?.agent ?? observation?.agent,
      matchedRuleID: state.matched?.ruleID,
      publishedPhase: observation?.phase,
      publishedRuleID: observation?.ruleID
    )
  }

  func provenProcessIdentity(
    for surfaceID: UUID
  ) -> TerminalAgentProcessIdentity? {
    states[surfaceID]?.proof?.processIdentity
  }

  func tick(now: ContinuousClock.Instant) async {
    guard !Task.isCancelled else { return }
    let snapshot = await rules.snapshot()
    guard !Task.isCancelled else { return }
    activate(snapshot)
    let surfaces = host.surfaces()
    reconcile(surfaces, now: now)
    guard !surfaces.isEmpty else { return }

    let due = surfaces.compactMap { surface -> DueScan? in
      guard let processGroupID = surface.key.foregroundProcessGroupID, processGroupID > 0,
        let state = states[surface.key.id]
      else {
        return nil
      }
      guard state.nextScanAt <= now else { return nil }
      return DueScan(
        surface: surface,
        nonce: state.nonce,
        processGroupID: processGroupID
      )
    }
    if !due.isEmpty {
      let directProcessGroups = Dictionary(
        uniqueKeysWithValues: due.map { ($0.surface.key.id, $0.processGroupID) }
      )
      let resolvedProcessGroups = await sampler.resolveForegroundProcessGroups(directProcessGroups)
      guard !Task.isCancelled else { return }
      let resolved = due.map { scan in
        let processGroupID =
          if let resolvedProcessGroupID = resolvedProcessGroups[scan.surface.key.id],
            resolvedProcessGroupID > 0
          {
            resolvedProcessGroupID
          } else {
            scan.processGroupID
          }
        return DueScan(
          surface: scan.surface,
          nonce: scan.nonce,
          processGroupID: processGroupID
        )
      }
      let processGroupIDs = Set(resolved.map(\.processGroupID))
      let matches = await sampler.matches(processGroupIDs, snapshot.processManifests)
      guard !Task.isCancelled else { return }
      let currentSnapshot = await rules.snapshot()
      guard !Task.isCancelled else { return }
      guard currentSnapshot.generation == snapshot.generation else {
        activate(currentSnapshot)
        reconcile(host.surfaces(), now: now)
        return
      }
      await applyProcessMatches(
        matches,
        to: resolved,
        generation: snapshot.generation,
        now: now
      )
    }

    guard generation == snapshot.generation else { return }
    await evaluateProvenSurfaces(
      generation: snapshot.generation,
      now: now
    )
  }

  func nextTickDelay(now: ContinuousClock.Instant) -> Duration {
    var delay: Duration =
      states.values.contains { $0.settler.isConfirmingIdle }
      ? Self.idleConfirmationInterval
      : Self.evaluationInterval
    for state in states.values
    where state.key.foregroundProcessGroupID.map({ $0 > 0 }) == true
      && state.nextScanAt > now
    {
      delay = min(delay, now.duration(to: state.nextScanAt))
    }
    return delay
  }

  private func activate(_ snapshot: AgentDetectionRuleSnapshot) {
    guard generation != snapshot.generation else { return }
    invalidateAll()
    generation = snapshot.generation
  }

  private func reconcile(
    _ surfaces: [TerminalAgentDetectionSurfaceSnapshot],
    now: ContinuousClock.Instant
  ) {
    let liveIDs = Set(surfaces.map(\.key.id))
    var processFactsChanged = false
    for surfaceID in states.keys where !liveIDs.contains(surfaceID) {
      invalidate(surfaceID)
      processFactsChanged = true
    }
    for surface in surfaces {
      let surfaceID = surface.key.id
      if states[surfaceID]?.key != surface.key {
        processFactsChanged = processFactsChanged || states[surfaceID] != nil
        invalidate(surfaceID)
        states[surfaceID] = SurfaceState(
          key: surface.key,
          nonce: makeNonce(),
          nextScanAt: now,
          acquisitionStartedAt: now,
          status: surface.key.foregroundProcessGroupID.map { $0 > 0 } != true
            ? .noForegroundProcess
            : .waiting
        )
      } else if surface.key.foregroundProcessGroupID.map({ $0 > 0 }) != true,
        var state = states[surfaceID]
      {
        resetProof(&state)
        state.status = .noForegroundProcess
        states[surfaceID] = state
      }
    }
    if processFactsChanged {
      host.pruneDeadAgentProcesses()
    }
  }

  private func applyProcessMatches(
    _ matches: [Int32: AgentDetectionProcessMatch],
    to due: [DueScan],
    generation: UInt64,
    now: ContinuousClock.Instant
  ) async {
    let identities = Set(matches.values.map(\.processIdentity))
    let currentIdentities = await sampler.current(identities)
    guard !Task.isCancelled else { return }
    guard self.generation == generation else { return }
    let live = Dictionary(uniqueKeysWithValues: host.surfaces().map { ($0.key.id, $0.key) })

    for dueScan in due {
      let key = dueScan.surface.key
      guard live[key.id] == key, var state = states[key.id], state.key == key,
        state.nonce == dueScan.nonce
      else {
        continue
      }
      guard let match = matches[dueScan.processGroupID] else {
        markUnrecognized(&state, now: now)
        states[key.id] = state
        continue
      }
      guard currentIdentities.contains(match.processIdentity) else {
        markUnrecognized(&state, now: now)
        states[key.id] = state
        continue
      }
      if state.proof != match {
        clearPublished(key.id)
        state.proof = match
        state.settler = AgentDetectionSettler()
        state.matched = nil
      }
      state.nextScanAt = now.advanced(by: Self.recognizedProcessInterval)
      state.acquisitionStartedAt = nil
      state.status = .waiting
      states[key.id] = state
    }
  }

  private func evaluateProvenSurfaces(
    generation: UInt64,
    now: ContinuousClock.Instant
  ) async {
    let currentTimeMicroseconds = currentTimeMicroseconds()
    let identities = phaseDetectionIdentities(currentTimeMicroseconds: currentTimeMicroseconds)
    guard !identities.isEmpty else { return }
    let currentIdentities = await sampler.current(identities)
    guard !Task.isCancelled else { return }
    guard self.generation == generation else { return }
    guard await rulesAreCurrent(generation: generation, now: now) else { return }

    let attempts = states.keys.sorted(by: { $0.uuidString < $1.uuidString }).compactMap {
      prepareEvaluation(
        for: $0,
        currentIdentities: currentIdentities,
        currentTimeMicroseconds: currentTimeMicroseconds,
        now: now
      )
    }
    guard !attempts.isEmpty else { return }
    guard let batch = await evaluate(attempts, generation: generation, now: now) else { return }
    guard await rulesAreCurrent(generation: generation, now: now) else { return }
    await apply(batch, generation: generation, now: now)
  }

  private func phaseDetectionIdentities(
    currentTimeMicroseconds: UInt64
  ) -> Set<TerminalAgentProcessIdentity> {
    Set(
      states.values.compactMap { state in
        guard let identity = state.proof?.processIdentity,
          Self.canDetectPhase(
            for: identity,
            currentTimeMicroseconds: currentTimeMicroseconds
          )
        else {
          return nil
        }
        return identity
      }
    )
  }

  private func evaluate(
    _ attempts: [EvaluationAttempt],
    generation: UInt64,
    now: ContinuousClock.Instant
  ) async -> EvaluationBatch? {
    let signalEvaluations = await rules.evaluateSignals(
      attempts.map {
        AgentDetectionSignalRequest(
          agentID: $0.proof.agentID,
          input: $0.signals
        )
      }
    )
    guard !Task.isCancelled else { return nil }
    guard self.generation == generation else { return nil }
    precondition(signalEvaluations.count == attempts.count)
    guard signalEvaluations.compactMap({ $0?.generation }).allSatisfy({ $0 == generation }) else {
      _ = await rulesAreCurrent(generation: generation, now: now)
      return nil
    }

    var batch = EvaluationBatch(attempts: attempts)
    var screenBatch = ScreenEvaluationBatch()
    for (attempt, result) in zip(attempts, signalEvaluations) {
      record(
        result,
        for: attempt,
        evaluationBatch: &batch,
        screenBatch: &screenBatch
      )
    }
    guard !screenBatch.requests.isEmpty else { return batch }

    let screenEvaluations = await rules.evaluate(screenBatch.requests)
    guard !Task.isCancelled else { return nil }
    guard self.generation == generation else { return nil }
    precondition(screenEvaluations.count == screenBatch.attempts.count)
    guard screenEvaluations.compactMap({ $0?.generation }).allSatisfy({ $0 == generation }) else {
      _ = await rulesAreCurrent(generation: generation, now: now)
      return nil
    }
    for (attempt, evaluation) in zip(screenBatch.attempts, screenEvaluations) {
      batch.record(evaluation, for: attempt)
    }
    return batch
  }

  private func record(
    _ result: AgentDetectionSignalEvaluation?,
    for attempt: EvaluationAttempt,
    evaluationBatch: inout EvaluationBatch,
    screenBatch: inout ScreenEvaluationBatch
  ) {
    guard states[attempt.surfaceID]?.nonce == attempt.state.nonce else { return }
    guard let result else {
      evaluationBatch.record(nil, for: attempt)
      return
    }
    switch result {
    case .matched(let evaluation):
      evaluationBatch.record(evaluation, for: attempt)
    case .needsScreen:
      guard let request = screenRequest(for: attempt) else { return }
      screenBatch.attempts.append(attempt)
      screenBatch.requests.append(request)
    }
  }

  private func screenRequest(
    for attempt: EvaluationAttempt
  ) -> AgentDetectionEvaluationRequest? {
    guard let screen = host.screen(attempt.state.key) else {
      if var state = states[attempt.surfaceID], state.nonce == attempt.state.nonce {
        resetEvaluation(&state, status: .protectedOrUnreadableScreen)
        states[attempt.surfaceID] = state
      }
      return nil
    }
    return AgentDetectionEvaluationRequest(
      agentID: attempt.proof.agentID,
      input: AgentDetectionInput(
        screen: Self.utf8Suffix(screen, maximumBytes: Self.screenByteLimit),
        oscTitle: attempt.signals.oscTitle,
        oscProgress: attempt.signals.oscProgress
      )
    )
  }

  private func apply(
    _ batch: EvaluationBatch,
    generation: UInt64,
    now: ContinuousClock.Instant
  ) async {
    let attempts = batch.activeAttempts
    guard !attempts.isEmpty else { return }
    let remainsCurrent = await sampler.current(
      Set(attempts.map(\.proof.processIdentity))
    )
    guard !Task.isCancelled else { return }
    guard self.generation == generation else { return }
    let validation = EvaluationValidation(
      generation: generation,
      currentIdentities: remainsCurrent,
      live: Dictionary(uniqueKeysWithValues: host.surfaces().map { ($0.key.id, $0.key) })
    )

    for attempt in attempts {
      apply(
        attempt,
        from: batch,
        validation: validation,
        now: now
      )
    }
  }

  private func apply(
    _ attempt: EvaluationAttempt,
    from batch: EvaluationBatch,
    validation: EvaluationValidation,
    now: ContinuousClock.Instant
  ) {
    if batch.unknownSurfaceIDs.contains(attempt.surfaceID) {
      guard
        canPublish(attempt, validation: validation),
        var state = states[attempt.surfaceID]
      else {
        return
      }
      markUnrecognized(&state, now: now)
      states[attempt.surfaceID] = state
      return
    }
    guard let evaluation = batch.evaluations[attempt.surfaceID],
      evaluation.generation == validation.generation,
      canPublish(attempt, validation: validation)
    else {
      if self.generation == validation.generation {
        clearPublished(attempt.surfaceID)
      }
      return
    }
    guard var state = states[attempt.surfaceID] else { return }
    settle(
      evaluation,
      proof: attempt.proof,
      surfaceID: attempt.surfaceID,
      state: &state,
      now: now
    )
    states[attempt.surfaceID] = state
  }

  private func prepareEvaluation(
    for surfaceID: UUID,
    currentIdentities: Set<TerminalAgentProcessIdentity>,
    currentTimeMicroseconds: UInt64,
    now: ContinuousClock.Instant
  ) -> EvaluationAttempt? {
    guard var state = states[surfaceID], let proof = state.proof else { return nil }
    guard
      Self.canDetectPhase(
        for: proof.processIdentity,
        currentTimeMicroseconds: currentTimeMicroseconds
      )
    else {
      return nil
    }
    guard currentIdentities.contains(proof.processIdentity) else {
      markUnrecognized(&state, now: now)
      states[surfaceID] = state
      return nil
    }
    guard host.nativeAuthority(surfaceID).contains(proof.processIdentity) == false else {
      resetEvaluation(&state, status: .nativeAuthority)
      states[surfaceID] = state
      return nil
    }
    guard let signals = host.signals(state.key) else {
      resetEvaluation(&state, status: .protectedOrUnreadableScreen)
      states[surfaceID] = state
      return nil
    }
    return EvaluationAttempt(
      surfaceID: surfaceID,
      state: state,
      proof: proof,
      signals: AgentDetectionSignalInput(
        oscTitle: Self.utf8Prefix(signals.oscTitle, maximumBytes: Self.titleByteLimit),
        oscProgress: signals.oscProgress
      )
    )
  }

  private func rulesAreCurrent(
    generation: UInt64,
    now: ContinuousClock.Instant
  ) async -> Bool {
    let latestSnapshot = await rules.snapshot()
    guard !Task.isCancelled else { return false }
    guard latestSnapshot.generation == generation else {
      activate(latestSnapshot)
      reconcile(host.surfaces(), now: now)
      return false
    }
    return self.generation == generation
  }

  private func canPublish(
    _ attempt: EvaluationAttempt,
    validation: EvaluationValidation
  ) -> Bool {
    generation == validation.generation
      && states[attempt.surfaceID]?.nonce == attempt.state.nonce
      && validation.currentIdentities.contains(attempt.proof.processIdentity)
      && validation.live[attempt.surfaceID] == attempt.state.key
      && host.nativeAuthority(attempt.surfaceID).contains(attempt.proof.processIdentity) == false
  }

  private func resetEvaluation(
    _ state: inout SurfaceState,
    status: TerminalAgentDetectionExplanation.Status
  ) {
    resetMatch(&state)
    state.status = status
  }

  private func markUnrecognized(
    _ state: inout SurfaceState,
    now: ContinuousClock.Instant
  ) {
    resetProof(&state)
    let acquisitionStartedAt = state.acquisitionStartedAt ?? now
    state.acquisitionStartedAt = acquisitionStartedAt
    let interval: Duration =
      acquisitionStartedAt.duration(to: now) < Self.processAcquisitionWindow
      ? Self.processAcquisitionInterval
      : Self.unrecognizedProcessInterval
    state.nextScanAt = now.advanced(by: interval)
    state.status = .unrecognizedProcess
  }

  private func settle(
    _ evaluation: AgentDetectionEvaluation,
    proof: Proof,
    surfaceID: UUID,
    state: inout SurfaceState,
    now: ContinuousClock.Instant
  ) {
    let settled = state.settler.settle(
      match: evaluation.match,
      processToken: proof.processIdentity,
      now: now
    )
    state.matched = matched(evaluation)
    let previousObservation = host.observation(surfaceID)
    guard let phase = phase(settled),
      let ruleID = publishedRuleID(
        match: evaluation.match,
        settled: settled,
        previous: previousObservation,
        evaluation: evaluation,
        proof: proof
      )
    else {
      clearPublished(surfaceID)
      state.status = .noRuleMatchOrSettling
      return
    }
    if isPublished(
      previousObservation,
      evaluation: evaluation,
      proof: proof,
      phase: phase,
      ruleID: ruleID
    ) {
      state.status = state.matched?.phase == phase ? .detected : .noRuleMatchOrSettling
      return
    }
    precondition(sequence < UInt64.max)
    sequence += 1
    let observation = TerminalAgentDetectionObservation(
      agent: evaluation.identity,
      phase: phase,
      processIdentity: proof.processIdentity,
      workingDirectoryPath: proof.workingDirectoryPath,
      ruleID: ruleID,
      generation: evaluation.generation,
      sequence: sequence
    )
    if host.apply(observation, surfaceID) {
      state.status = state.matched?.phase == phase ? .detected : .noRuleMatchOrSettling
    } else {
      state.status = .waiting
    }
  }

  private func matched(_ evaluation: AgentDetectionEvaluation) -> Matched? {
    let phase: AgentActivityPhase? =
      switch evaluation.match.result {
      case .unknown: AgentActivityPhase.unknown
      case .running: AgentActivityPhase.running
      case .needsInput: AgentActivityPhase.needsInput
      case .idle: AgentActivityPhase.idle
      case .hold: nil
      }
    return Matched(
      agent: evaluation.identity,
      phase: phase,
      ruleID: evaluation.match.ruleID
    )
  }

  private func publishedRuleID(
    match: AgentDetectionMatch,
    settled: AgentDetectionState,
    previous: TerminalAgentDetectionObservation?,
    evaluation: AgentDetectionEvaluation,
    proof: Proof
  ) -> String? {
    let previousRuleID: String? =
      if previous?.agent == evaluation.identity,
        previous?.processIdentity == proof.processIdentity,
        previous?.generation == evaluation.generation
      {
        previous?.ruleID
      } else {
        nil
      }
    switch match.result {
    case .hold:
      return phase(settled) == nil ? nil : previousRuleID
    case .unknown:
      return settled == .unknown ? match.ruleID : previousRuleID
    case .idle:
      return settled == .idle ? match.ruleID : previousRuleID
    case .running, .needsInput:
      return match.ruleID
    }
  }

  private func isPublished(
    _ observation: TerminalAgentDetectionObservation?,
    evaluation: AgentDetectionEvaluation,
    proof: Proof,
    phase: AgentActivityPhase,
    ruleID: String
  ) -> Bool {
    guard let observation else { return false }
    return observation
      == TerminalAgentDetectionObservation(
        agent: evaluation.identity,
        phase: phase,
        processIdentity: proof.processIdentity,
        workingDirectoryPath: proof.workingDirectoryPath,
        ruleID: ruleID,
        generation: evaluation.generation,
        sequence: observation.sequence
      )
  }

  private func phase(_ state: AgentDetectionState) -> AgentActivityPhase? {
    switch state {
    case .unknown: .unknown
    case .running: .running
    case .needsInput: .needsInput
    case .idle: .idle
    }
  }

  private func resetProof(_ state: inout SurfaceState) {
    resetMatch(&state)
    state.proof = nil
  }

  private func resetMatch(_ state: inout SurfaceState) {
    clearPublished(state.key.id)
    state.settler = AgentDetectionSettler()
    state.matched = nil
  }

  private func clearPublished(_ surfaceID: UUID) {
    host.clear(surfaceID)
  }

  private func invalidate(_ surfaceID: UUID) {
    states.removeValue(forKey: surfaceID)
    clearPublished(surfaceID)
  }

  private func invalidateAll() {
    for surfaceID in states.keys {
      clearPublished(surfaceID)
    }
    states.removeAll()
  }

  private func makeNonce() -> UInt64 {
    precondition(nextNonce < UInt64.max)
    nextNonce += 1
    return nextNonce
  }

  private static func canDetectPhase(
    for identity: TerminalAgentProcessIdentity,
    currentTimeMicroseconds: UInt64
  ) -> Bool {
    currentTimeMicroseconds >= identity.startTimeMicroseconds
      && currentTimeMicroseconds - identity.startTimeMicroseconds
        >= phaseDetectionMinimumAgeMicroseconds
  }

  static func utf8Prefix(_ value: String, maximumBytes: Int) -> String {
    guard maximumBytes > 0, value.utf8.count > maximumBytes else {
      return maximumBytes > 0 ? value : ""
    }
    var byteCount = 0
    var end = value.unicodeScalars.startIndex
    while end < value.unicodeScalars.endIndex {
      let next = value.unicodeScalars.index(after: end)
      let scalarBytes = String(value.unicodeScalars[end]).utf8.count
      guard byteCount + scalarBytes <= maximumBytes else { break }
      byteCount += scalarBytes
      end = next
    }
    return String(value.unicodeScalars[..<end])
  }

  static func utf8Suffix(_ value: String, maximumBytes: Int) -> String {
    guard maximumBytes > 0, value.utf8.count > maximumBytes else {
      return maximumBytes > 0 ? value : ""
    }
    var byteCount = 0
    var start = value.unicodeScalars.endIndex
    while start > value.unicodeScalars.startIndex {
      let previous = value.unicodeScalars.index(before: start)
      let scalarBytes = String(value.unicodeScalars[previous]).utf8.count
      guard byteCount + scalarBytes <= maximumBytes else { break }
      byteCount += scalarBytes
      start = previous
    }
    return String(value.unicodeScalars[start...])
  }

  private static func liveHostAccess(
    _ terminal: TerminalHostState
  ) -> TerminalAgentDetectionHostAccess {
    TerminalAgentDetectionHostAccess(
      surfaces: { [weak terminal] in
        guard let terminal else { return [] }
        return terminal.surfaces.values.map { surface in
          TerminalAgentDetectionSurfaceSnapshot(
            key: TerminalAgentDetectionSurfaceKey(
              id: surface.id,
              instance: ObjectIdentifier(surface),
              foregroundProcessGroupID: surface.foregroundProcessGroupID
            )
          )
        }
      },
      signals: { [weak terminal] key in
        guard let surface = terminal?.surfaces[key.id],
          ObjectIdentifier(surface) == key.instance,
          surface.foregroundProcessGroupID == key.foregroundProcessGroupID
        else {
          return nil
        }
        return TerminalAgentDetectionSignals(
          oscTitle: surface.rawTitle ?? "",
          oscProgress: surface.bridge.state.agentOSCProgressProcessGroupID
            == key.foregroundProcessGroupID
            ? surface.bridge.state.agentOSCProgress
            : ""
        )
      },
      screen: { [weak terminal] key in
        guard let surface = terminal?.surfaces[key.id],
          ObjectIdentifier(surface) == key.instance,
          surface.foregroundProcessGroupID == key.foregroundProcessGroupID
        else {
          return nil
        }
        return surface.activeScreenText(maximumUTF8Bytes: screenByteLimit)
      },
      nativeAuthority: { [weak terminal] surfaceID in
        terminal?.nativeAgentDetectionCandidates(for: surfaceID).reduce(into: []) {
          $0.formUnion($1.phaseAuthorityProcessIdentities)
        } ?? []
      },
      observation: { [weak terminal] surfaceID in
        terminal?.agentDetectionStore.observation(for: surfaceID)
      },
      apply: { [weak terminal] observation, surfaceID in
        terminal?.applyAgentDetection(observation, for: surfaceID) == true
      },
      clear: { [weak terminal] surfaceID in
        _ = terminal?.clearAgentDetection(for: surfaceID)
      },
      pruneDeadAgentProcesses: { [weak terminal] in
        guard let terminal, terminal.pruneDeadAgentProcesses() else { return }
        terminal.sessionDidChange()
      }
    )
  }
}

extension TerminalHostState {
  func agentDetectionExplanation(
    for surfaceID: UUID
  ) -> TerminalAgentDetectionExplanation {
    agentDetectionController?.explanation(for: surfaceID) ?? .disabled
  }
}
