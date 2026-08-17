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

  let origin: AgentDetectionRuleOrigin?
  let generation: UInt64?
  let status: Status
  let processIdentity: TerminalAgentProcessIdentity?
  let agent: AgentDetectionAgentIdentity?
  let matchedPhase: AgentActivityPhase?
  let matchedRuleID: String?
  let publishedPhase: AgentActivityPhase?
  let publishedRuleID: String?

  static let disabled = TerminalAgentDetectionExplanation(
    origin: nil,
    generation: nil,
    status: .disabled,
    processIdentity: nil,
    agent: nil,
    matchedPhase: nil,
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

nonisolated struct TerminalAgentDetectionCapture: Equatable, Sendable {
  let screen: String
  let oscTitle: String
  let oscProgress: String

  init(screen: String, oscTitle: String, oscProgress: String = "") {
    self.screen = screen
    self.oscTitle = oscTitle
    self.oscProgress = oscProgress
  }
}

nonisolated struct TerminalAgentDetectionRuleAccess: Sendable {
  let snapshot: @Sendable () async -> AgentDetectionRuleSnapshot
  let evaluate: @Sendable (String, AgentDetectionInput) async -> AgentDetectionEvaluation?

  init(repository: AgentDetectionRuleRepository) {
    snapshot = { await repository.snapshot() }
    evaluate = { agentID, input in
      await repository.evaluate(agentID: agentID, input: input)
    }
  }

  init(
    snapshot: @escaping @Sendable () async -> AgentDetectionRuleSnapshot,
    evaluate: @escaping @Sendable (String, AgentDetectionInput) async -> AgentDetectionEvaluation?
  ) {
    self.snapshot = snapshot
    self.evaluate = evaluate
  }
}

nonisolated struct TerminalAgentDetectionSampler: Sendable {
  let foregroundProcessGroups: @Sendable ([UUID: Int32]) async -> [UUID: Int32]
  let matches:
    @Sendable (Set<Int32>, [AgentDetectionProcessManifest]) async ->
      [Int32: AgentDetectionProcessMatch]
  let current: @Sendable (Set<TerminalAgentProcessIdentity>) async -> Set<TerminalAgentProcessIdentity>
}

@MainActor
struct TerminalAgentDetectionHostAccess {
  let surfaces: () -> [TerminalAgentDetectionSurfaceSnapshot]
  let capture: (TerminalAgentDetectionSurfaceKey) -> TerminalAgentDetectionCapture?
  let nativeAuthority: (UUID) -> Set<TerminalAgentProcessIdentity>
  let observation: (UUID) -> TerminalAgentDetectionObservation?
  let apply: (TerminalAgentDetectionObservation, UUID) -> Bool
  let clear: (UUID) -> Void
}

private actor TerminalAgentDetectionLiveSampler {
  private let zmxClient: ZmxClient
  private let zmxSessionsEnabled: Bool

  init(zmxClient: ZmxClient, zmxSessionsEnabled: Bool) {
    self.zmxClient = zmxClient
    self.zmxSessionsEnabled = zmxSessionsEnabled
  }

  func foregroundProcessGroups(_ direct: [UUID: Int32]) async -> [UUID: Int32] {
    guard zmxSessionsEnabled, let sessions = await zmxClient.sessions() else {
      return direct
    }
    return sessions.reduce(into: direct) { processGroups, session in
      guard
        direct[session.surfaceID] != nil,
        let processGroupID = TerminalAgentProcessInspector.foregroundProcessGroupID(
          for: session.processID
        )
      else {
        return
      }
      processGroups[session.surfaceID] = processGroupID
    }
  }

  func matches(
    foregroundProcessGroupIDs: Set<Int32>,
    manifests: [AgentDetectionProcessManifest]
  ) -> [Int32: AgentDetectionProcessMatch] {
    AgentDetectionProcessRecognizer.matches(
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

  private static let evaluationInterval: Duration = .milliseconds(300)
  private static let idleConfirmationInterval: Duration = .milliseconds(100)
  private static let processAcquisitionInterval: Duration = .milliseconds(500)
  private static let processAcquisitionWindow: Duration = .milliseconds(1_500)
  private static let recognizedProcessInterval: Duration = .seconds(5)
  private static let unrecognizedProcessInterval: Duration = .seconds(2)

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
    let input: AgentDetectionInput
  }

  private struct DueScan: Sendable {
    let surface: TerminalAgentDetectionSurfaceSnapshot
    let nonce: UInt64
    let processGroupID: Int32
  }

  private let rules: TerminalAgentDetectionRuleAccess
  private let sampler: TerminalAgentDetectionSampler
  private let host: TerminalAgentDetectionHostAccess
  private let clock = ContinuousClock()
  private var task: Task<Void, Never>?
  private var states: [UUID: SurfaceState] = [:]
  private var origin: AgentDetectionRuleOrigin?
  private var generation: UInt64?
  private var nextNonce: UInt64 = 0
  private var sequence: UInt64 = 0

  convenience init(
    host terminal: TerminalHostState,
    repository: AgentDetectionRuleRepository
  ) {
    let liveSampler = TerminalAgentDetectionLiveSampler(
      zmxClient: terminal.zmxClient,
      zmxSessionsEnabled: terminal.zmxSessionsEnabled
    )
    self.init(
      rules: TerminalAgentDetectionRuleAccess(repository: repository),
      sampler: TerminalAgentDetectionSampler(
        foregroundProcessGroups: { processGroupIDs in
          await liveSampler.foregroundProcessGroups(processGroupIDs)
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
    host: TerminalAgentDetectionHostAccess
  ) {
    self.rules = rules
    self.sampler = sampler
    self.host = host
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
        origin: origin,
        generation: generation,
        status: .waiting,
        processIdentity: nil,
        agent: observation?.agent,
        matchedPhase: nil,
        matchedRuleID: nil,
        publishedPhase: observation?.phase,
        publishedRuleID: observation?.ruleID
      )
    }
    return TerminalAgentDetectionExplanation(
      origin: origin,
      generation: generation,
      status: state.status,
      processIdentity: state.proof?.processIdentity,
      agent: state.matched?.agent ?? observation?.agent,
      matchedPhase: state.matched?.phase,
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
      let resolvedProcessGroups = await sampler.foregroundProcessGroups(directProcessGroups)
      guard !Task.isCancelled else { return }
      let resolved = due.map { scan in
        DueScan(
          surface: scan.surface,
          nonce: scan.nonce,
          processGroupID: resolvedProcessGroups[scan.surface.key.id].flatMap { $0 > 0 ? $0 : nil }
            ?? scan.processGroupID
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
    guard generation != snapshot.generation else {
      origin = snapshot.origin
      return
    }
    invalidateAll()
    origin = snapshot.origin
    generation = snapshot.generation
  }

  private func reconcile(
    _ surfaces: [TerminalAgentDetectionSurfaceSnapshot],
    now: ContinuousClock.Instant
  ) {
    let liveIDs = Set(surfaces.map(\.key.id))
    for surfaceID in states.keys where !liveIDs.contains(surfaceID) {
      invalidate(surfaceID)
    }
    for surface in surfaces {
      let surfaceID = surface.key.id
      if states[surfaceID]?.key != surface.key {
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
    let identities = Set(states.values.compactMap(\.proof?.processIdentity))
    let currentIdentities = await sampler.current(identities)
    guard !Task.isCancelled else { return }
    guard self.generation == generation else { return }
    let currentSnapshot = await rules.snapshot()
    guard !Task.isCancelled else { return }
    guard currentSnapshot.generation == generation else {
      activate(currentSnapshot)
      reconcile(host.surfaces(), now: now)
      return
    }

    for surfaceID in states.keys.sorted(by: { $0.uuidString < $1.uuidString }) {
      guard
        let attempt = prepareEvaluation(
          for: surfaceID,
          currentIdentities: currentIdentities,
          now: now
        )
      else { continue }
      guard await finishEvaluation(attempt, generation: generation, now: now) else { return }
    }
  }

  private func prepareEvaluation(
    for surfaceID: UUID,
    currentIdentities: Set<TerminalAgentProcessIdentity>,
    now: ContinuousClock.Instant
  ) -> EvaluationAttempt? {
    guard var state = states[surfaceID], let proof = state.proof else { return nil }
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
    guard let captured = host.capture(state.key) else {
      resetEvaluation(&state, status: .protectedOrUnreadableScreen)
      states[surfaceID] = state
      return nil
    }
    return EvaluationAttempt(
      surfaceID: surfaceID,
      state: state,
      proof: proof,
      input: AgentDetectionInput(
        screen: Self.utf8Suffix(captured.screen, maximumBytes: Self.screenByteLimit),
        oscTitle: Self.utf8Prefix(captured.oscTitle, maximumBytes: Self.titleByteLimit),
        oscProgress: captured.oscProgress
      )
    )
  }

  private func finishEvaluation(
    _ attempt: EvaluationAttempt,
    generation: UInt64,
    now: ContinuousClock.Instant
  ) async -> Bool {
    let surfaceID = attempt.surfaceID
    let nonce = attempt.state.nonce
    let proof = attempt.proof
    let evaluation = await rules.evaluate(proof.agentID, attempt.input)
    guard !Task.isCancelled else { return false }
    guard states[surfaceID]?.nonce == nonce else { return true }
    let latestSnapshot = await rules.snapshot()
    guard !Task.isCancelled else { return false }
    guard states[surfaceID]?.nonce == nonce else { return true }
    guard latestSnapshot.generation == generation else {
      activate(latestSnapshot)
      reconcile(host.surfaces(), now: now)
      return false
    }
    guard let evaluation, evaluation.generation == generation else {
      var state = attempt.state
      markUnrecognized(&state, now: now)
      states[surfaceID] = state
      return true
    }
    let remainsCurrent = await sampler.current([proof.processIdentity])
    guard !Task.isCancelled else { return false }
    guard
      canPublish(
        attempt,
        generation: generation,
        currentIdentities: remainsCurrent
      )
    else {
      if self.generation == generation {
        clearPublished(surfaceID)
      }
      return true
    }
    var state = attempt.state
    settle(
      evaluation,
      proof: proof,
      surfaceID: surfaceID,
      state: &state,
      now: now
    )
    states[surfaceID] = state
    return true
  }

  private func canPublish(
    _ attempt: EvaluationAttempt,
    generation: UInt64,
    currentIdentities: Set<TerminalAgentProcessIdentity>
  ) -> Bool {
    self.generation == generation
      && states[attempt.surfaceID]?.nonce == attempt.state.nonce
      && currentIdentities.contains(attempt.proof.processIdentity)
      && host.surfaces().contains(where: { $0.key == attempt.state.key })
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
    observation?.agent == evaluation.identity
      && observation?.phase == phase
      && observation?.processIdentity == proof.processIdentity
      && observation?.ruleID == ruleID
      && observation?.generation == evaluation.generation
  }

  private func phase(_ state: AgentDetectionState) -> AgentActivityPhase? {
    switch state {
    case .unknown: nil
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
      capture: { [weak terminal] key in
        guard let surface = terminal?.surfaces[key.id],
          ObjectIdentifier(surface) == key.instance,
          surface.foregroundProcessGroupID == key.foregroundProcessGroupID,
          let screen = surface.activeScreenText(maximumUTF8Bytes: screenByteLimit)
        else {
          return nil
        }
        return TerminalAgentDetectionCapture(
          screen: screen,
          oscTitle: surface.rawTitle ?? "",
          oscProgress: surface.bridge.state.agentOSCProgressProcessGroupID
            == key.foregroundProcessGroupID
            ? surface.bridge.state.agentOSCProgress
            : ""
        )
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
