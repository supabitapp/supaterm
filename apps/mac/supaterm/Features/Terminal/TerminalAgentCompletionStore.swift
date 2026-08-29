import Foundation
import SupatermCLIShared
import SupatermSupport

nonisolated enum TerminalAgentCompletionIdentity: Equatable, Hashable, Sendable {
  case native(agent: SupatermAgentKind, sessionID: String)
  case screen(
    agent: AgentDetectionAgentIdentity,
    processIdentity: TerminalAgentProcessIdentity
  )
}

struct TerminalAgentExitContext: Equatable, Sendable {
  let activity: TerminalHostState.AgentActivity
  let completionIdentity: TerminalAgentCompletionIdentity
  let phaseSource: TerminalHostState.AgentPhaseSource
  let revision: UInt64
  let workingDirectoryPath: String?

  init(_ instance: TerminalHostState.AgentStateInstance) {
    activity = instance.activity
    completionIdentity = instance.completionIdentity
    phaseSource = instance.phaseSource
    revision = instance.revision
    workingDirectoryPath = instance.nativePresentation?.workingDirectoryPath
  }
}

struct TerminalAgentCessation: Equatable, Sendable {
  let context: TerminalAgentExitContext
  let exitCode: Int?

  var completionIdentity: TerminalAgentCompletionIdentity {
    context.completionIdentity
  }

  var workingDirectoryPath: String? {
    context.workingDirectoryPath
  }

  func instance(for surfaceID: UUID) -> TerminalHostState.AgentStateInstance {
    TerminalHostState.AgentStateInstance(
      activity: TerminalHostState.AgentActivity(
        identity: context.activity.identity,
        phase: .idle,
        detail: context.activity.detail
      ),
      completionIdentity: completionIdentity,
      lifecycle: .ceased(exitCode: exitCode),
      nativePresentation: nil,
      phaseSource: context.phaseSource,
      revision: context.revision == UInt64.max ? context.revision : context.revision + 1,
      surfaceID: surfaceID
    )
  }
}

struct TerminalAgentCompletionStore {
  private enum ExitState {
    case pending(TerminalAgentExitContext)
    case ceased(TerminalAgentCessation)
  }

  private struct SurfaceState {
    var completionIdentity: TerminalAgentCompletionIdentity?
    var exitState: ExitState?
  }

  private var statesBySurfaceID: [UUID: SurfaceState] = [:]

  func contains(
    _ identity: TerminalAgentCompletionIdentity,
    for surfaceID: UUID
  ) -> Bool {
    statesBySurfaceID[surfaceID]?.completionIdentity == identity
  }

  func identity(for surfaceID: UUID) -> TerminalAgentCompletionIdentity? {
    statesBySurfaceID[surfaceID]?.completionIdentity
  }

  func cessation(for surfaceID: UUID) -> TerminalAgentCessation? {
    guard case .ceased(let cessation) = statesBySurfaceID[surfaceID]?.exitState else {
      return nil
    }
    return cessation
  }

  func pendingExit(for surfaceID: UUID) -> TerminalAgentExitContext? {
    guard case .pending(let context) = statesBySurfaceID[surfaceID]?.exitState else {
      return nil
    }
    return context
  }

  mutating func record(
    _ identity: TerminalAgentCompletionIdentity,
    for surfaceID: UUID
  ) {
    statesBySurfaceID[surfaceID] = SurfaceState(
      completionIdentity: identity,
      exitState: nil
    )
  }

  mutating func recordPendingExit(
    _ context: TerminalAgentExitContext,
    for surfaceID: UUID
  ) {
    var state =
      statesBySurfaceID[surfaceID]
      ?? SurfaceState(completionIdentity: nil, exitState: nil)
    state.exitState = .pending(context)
    statesBySurfaceID[surfaceID] = state
  }

  mutating func recordCessation(
    _ cessation: TerminalAgentCessation,
    isCompletion: Bool,
    for surfaceID: UUID
  ) {
    statesBySurfaceID[surfaceID] = SurfaceState(
      completionIdentity: isCompletion ? cessation.completionIdentity : nil,
      exitState: .ceased(cessation)
    )
  }

  mutating func clear(for surfaceID: UUID) {
    statesBySurfaceID.removeValue(forKey: surfaceID)
  }

  mutating func clear(
    _ identity: TerminalAgentCompletionIdentity,
    for surfaceID: UUID
  ) {
    guard contains(identity, for: surfaceID) else { return }
    clear(for: surfaceID)
  }

  mutating func take(_ surfaceIDs: Set<UUID>) -> TerminalAgentCompletionStore {
    var taken = TerminalAgentCompletionStore()
    for surfaceID in surfaceIDs {
      if let state = statesBySurfaceID.removeValue(forKey: surfaceID) {
        taken.statesBySurfaceID[surfaceID] = state
      }
    }
    return taken
  }

  mutating func merge(_ other: TerminalAgentCompletionStore) {
    precondition(statesBySurfaceID.keys.allSatisfy { other.statesBySurfaceID[$0] == nil })
    statesBySurfaceID.merge(other.statesBySurfaceID) { _, incoming in incoming }
  }
}
