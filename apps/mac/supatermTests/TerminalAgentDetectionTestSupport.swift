import Foundation

@testable import supaterm

@MainActor
func terminalObservation(
  in host: TerminalHostState,
  for surfaceID: UUID
) -> TerminalAgentDetectionObservation? {
  guard case .terminal(let observation, _) = host.resolvedAgentState(for: surfaceID).resolution
  else {
    return nil
  }
  return observation
}
