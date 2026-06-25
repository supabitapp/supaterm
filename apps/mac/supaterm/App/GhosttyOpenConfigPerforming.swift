import SupatermGhosttyFeature
import SupatermSettingsFeature

extension AppDelegate: GhosttyOpenConfigPerforming {
  @discardableResult
  func performOpenConfig() -> Bool {
    performShowSettings(tab: .terminal)
  }
}
