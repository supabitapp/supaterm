import AppKit

@MainActor
protocol GhosttyOpenConfigPerforming: AnyObject {
  func performOpenConfig() -> Bool
}

extension AppDelegate: GhosttyOpenConfigPerforming {
  @discardableResult
  func performOpenConfig() -> Bool {
    performShowSettings(tab: .general)
  }
}
