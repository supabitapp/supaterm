import AppKit
import SupatermSettingsFeature

@MainActor
protocol GhosttyOpenConfigPerforming: AnyObject {
  func performOpenConfig() -> Bool
}

extension AppDelegate: GhosttyOpenConfigPerforming {
  @discardableResult
  func performOpenConfig() -> Bool {
    performShowSettings(tab: .terminal)
  }
}
