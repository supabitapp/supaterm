import Foundation
import SupatermSupport

extension TerminalHostState {
  enum AgentPresentationStatus: Equatable {
    case unknown
    case idle
    case done
    case needsInput
    case working
  }

  struct WindowAgentPresentationID: Hashable {
    let surfaceID: UUID
    let completionIdentity: TerminalAgentCompletionIdentity
  }

  struct WindowAgentPresentation: Identifiable, Equatable {
    let id: WindowAgentPresentationID
    let identity: AgentDetectionAgentIdentity
    let task: String
    let workspace: String
    let status: AgentPresentationStatus
  }

  func windowAgentPresentations() -> [WindowAgentPresentation] {
    spaces.flatMap { space -> [WindowAgentPresentation] in
      spaceManager.tabs(in: space.id).flatMap { tab -> [WindowAgentPresentation] in
        guard let tree = trees[tab.id] else { return [] }
        return tree.leaves().flatMap { surface -> [WindowAgentPresentation] in
          resolvedAgentState(for: surface.id).instances.compactMap { instance in
            guard let status = agentPresentationStatus(for: instance) else { return nil }
            let cessation = matchingCessation(for: instance)
            return WindowAgentPresentation(
              id: WindowAgentPresentationID(
                surfaceID: surface.id,
                completionIdentity: instance.completionIdentity
              ),
              identity: instance.activity.identity,
              task: Self.trimmedNonEmpty(instance.activity.detail) ?? tab.title,
              workspace: windowAgentWorkspace(
                workingDirectoryPath: instance.nativePresentation?.workingDirectoryPath
                  ?? cessation?.workingDirectoryPath
                  ?? surface.bridge.state.pwd,
                fallback: space.name
              ),
              status: status
            )
          }
        }
      }
    }
  }

  func agentPresentationStatus(
    for instance: AgentStateInstance
  ) -> AgentPresentationStatus? {
    let isDone = agentCompletionStore.contains(
      instance.completionIdentity,
      for: instance.surfaceID
    )
    if case .ceased = instance.lifecycle {
      return isDone ? .done : nil
    }
    guard instance.hasActivity else { return .unknown }
    switch instance.activity.phase {
    case .unknown:
      return .unknown
    case .idle:
      return isDone ? .done : .idle
    case .needsInput:
      return .needsInput
    case .running:
      return .working
    }
  }

  private func matchingCessation(
    for instance: AgentStateInstance
  ) -> TerminalAgentCessation? {
    guard
      let cessation = agentCompletionStore.cessation(for: instance.surfaceID),
      cessation.completionIdentity == instance.completionIdentity
    else {
      return nil
    }
    return cessation
  }

  private func windowAgentWorkspace(
    workingDirectoryPath: String?,
    fallback: String
  ) -> String {
    guard
      let path = TerminalAgentPanelWorkspaceKey(
        workingDirectoryPath: workingDirectoryPath
      )?.workingDirectoryPath
    else {
      return fallback
    }
    return Self.trimmedNonEmpty(URL(fileURLWithPath: path).lastPathComponent) ?? path
  }
}
