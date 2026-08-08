import GhosttyKit
import Observation

enum GhosttySurfaceFailure: Equatable {
  case rendererUnavailable
  case surfaceCreationFailed
}

@MainActor
@Observable
final class GhosttySurfaceState {
  var title: String?
  var titleOverride: String?
  var pwd: String?
  var progressStyleEnabled = true
  var progressState: ghostty_action_progress_report_state_e?
  var progressValue: Int?
  var commandExitCode: Int?
  var commandDuration: UInt64?
  var childExitCode: UInt32?
  var childExitTimeMs: UInt64?
  var readOnly: ghostty_action_readonly_e?
  var mouseOverLink: String?
  var failure: GhosttySurfaceFailure?
  var searchNeedle: String?
  var searchTotal: Int?
  var searchSelected: Int?
  var searchFocusCount = 0
  var searchSelectionRequestCount = 0
  var keySequenceActive: Bool?
  var keyTableDepth: Int = 0
  var userInputGeneration = 0
  var bellCount: Int = 0

  var effectiveTitle: String? {
    if let titleOverride {
      return titleOverride
    }
    guard let title, !title.isEmpty else { return nil }
    return title
  }
}
