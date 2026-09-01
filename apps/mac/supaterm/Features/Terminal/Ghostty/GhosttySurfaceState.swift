import AppKit
import GhosttyKit
import Observation

enum GhosttySurfaceFailure: Equatable {
  case rendererUnavailable
  case startupConfigurationFailed
  case surfaceCreationFailed
}

@MainActor
@Observable
final class GhosttySurfaceState {
  @ObservationIgnored
  private var rawTitle: String?
  var titleOverride: String?
  var pwd: String?
  var derivedConfig = GhosttySurfaceConfig()
  var oscBackgroundColor: NSColor?
  var agentOSCProgress = ""
  var agentOSCProgressProcessGroupID: Int32?
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

  var title: String? {
    get {
      access(keyPath: \.title)
      return rawTitle
    }
    set {
      let previousDisplayTitle = titleOverride ?? Self.displayTitle(from: rawTitle)
      let nextDisplayTitle = titleOverride ?? Self.displayTitle(from: newValue)
      guard previousDisplayTitle != nextDisplayTitle else {
        rawTitle = newValue
        return
      }
      withMutation(keyPath: \.title) {
        rawTitle = newValue
      }
    }
  }

  var effectiveTitle: String? {
    if let titleOverride {
      return titleOverride
    }
    guard let title, !title.isEmpty else { return nil }
    return title
  }

  var effectiveDisplayTitle: String? {
    if let titleOverride {
      return titleOverride
    }
    return Self.displayTitle(from: title)
  }

  nonisolated static func displayTitle(from title: String?) -> String? {
    guard let title, let scalar = title.unicodeScalars.first,
      "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".unicodeScalars.contains(scalar)
    else {
      return title
    }
    let suffix = title.dropFirst()
    guard suffix.isEmpty || suffix.first?.isWhitespace == true else { return title }
    return String(suffix.drop(while: { $0.isWhitespace }))
  }

  var effectiveBackgroundColor: NSColor {
    oscBackgroundColor ?? derivedConfig.backgroundColor
  }

  var progressStyleEnabled: Bool {
    derivedConfig.progressStyleEnabled
  }
}
