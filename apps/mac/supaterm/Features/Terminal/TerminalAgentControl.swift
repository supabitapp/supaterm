import Darwin
import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

nonisolated struct TerminalAgentControlSample: Equatable, Sendable {
  let identity: SupatermAgentIdentity?
  let phase: SupatermAppDebugSnapshot.AgentPhase?
  let expectedProcessIsAlive: Bool

  func validateSubmission(expected: SupatermAgentGuard) throws {
    guard let identity else { throw SupatermAgentControlError.notRunning }
    guard expected.matches(identity) else { throw SupatermAgentControlError.replaced }
    switch phase {
    case .needsInput: throw SupatermAgentControlError.blocked
    case .idle, .running: return
    case .unknown, nil: throw SupatermAgentControlError.unknown
    }
  }
}

extension TerminalHostState {
  func validateAgentSubmission(_ request: TerminalSendTextRequest, for surfaceID: UUID) throws {
    guard let expected = request.expectedAgent else { return }
    guard request.mode == .submit else {
      throw SupatermAgentControlError.invalidRequest("An agent guard requires submit mode.")
    }
    try expected.validate()
    try agentControlSample(for: surfaceID, expected: nil).validateSubmission(expected: expected)
  }

  func agentControlSample(
    for surfaceID: UUID,
    expected: SupatermAgentIdentity?
  ) throws -> TerminalAgentControlSample {
    guard surfaces[surfaceID] != nil else { throw TerminalControlError.contextPaneNotFound }
    let expectedIsAlive = expected.map { TerminalAgentProcessInspector.isCurrent($0.process.nativeIdentity) } ?? false
    let observation = agentDetectionStore.observation(for: surfaceID)
    let match = agentDetectionStore.processMatch(for: surfaceID)
    let process = match?.processIdentity ?? observation?.processIdentity
    let kind = (match?.agentID ?? observation?.agent.id).flatMap(SupatermAgentKind.init(rawValue:))
    guard let process, let kind,
      TerminalAgentProcessInspector.isCurrent(process),
      let foregroundGroup = TerminalAgentProcessInspector.foregroundProcessGroupID(for: process.processID),
      getpgid(process.processID) == foregroundGroup
    else {
      return TerminalAgentControlSample(identity: nil, phase: nil, expectedProcessIsAlive: expectedIsAlive)
    }
    let phase = observation.flatMap {
      $0.processIdentity == process && $0.agent.id == kind.rawValue ? debugAgentPhase($0.phase) : nil
    }
    return TerminalAgentControlSample(
      identity: SupatermAgentIdentity(
        kind: kind,
        process: SupatermAppDebugSnapshot.AgentProcess(
          processID: process.processID,
          startTimeMicroseconds: process.startTimeMicroseconds
        )
      ),
      phase: phase,
      expectedProcessIsAlive: expectedIsAlive
    )
  }
}

extension SupatermAppDebugSnapshot.AgentProcess {
  fileprivate var nativeIdentity: TerminalAgentProcessIdentity {
    TerminalAgentProcessIdentity(processID: processID, startTimeMicroseconds: startTimeMicroseconds)
  }
}
