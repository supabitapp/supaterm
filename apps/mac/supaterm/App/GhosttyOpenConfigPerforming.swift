import SupatermSettingsFeature
import SupatermTerminalFeature

extension AppDelegate: GhosttyOpenConfigPerforming {
  @discardableResult
  func performOpenConfig() -> Bool {
    performShowSettings(tab: .terminal)
  }
}
