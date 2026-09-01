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
  private var titleStorage: String?
  @ObservationIgnored
  private var publishedEffectiveTitle: String?
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
      return titleStorage
    }
    set {
      titleStorage = newValue
    }
  }

  func publishTitle() -> Bool {
    guard effectiveTitle != publishedEffectiveTitle else { return false }
    publishedEffectiveTitle = effectiveTitle
    withMutation(keyPath: \.title) {}
    return true
  }

  var effectiveTitle: String? {
    if let titleOverride {
      return titleOverride
    }
    guard let title, !title.isEmpty else { return nil }
    return title
  }

  var effectiveBackgroundColor: NSColor {
    oscBackgroundColor ?? derivedConfig.backgroundColor
  }

  var progressStyleEnabled: Bool {
    derivedConfig.progressStyleEnabled
  }
}
