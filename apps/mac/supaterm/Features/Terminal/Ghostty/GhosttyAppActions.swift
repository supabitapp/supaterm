import AppKit

@MainActor
public protocol GhosttyAppActionPerforming: AnyObject {
  func performCheckForUpdates() -> Bool
  func performCloseAllWindows() -> Bool
  func performNewWindow() -> Bool
  func performQuit() -> Bool
  func performQuitTerminatingSessions() -> Bool
  func performToggleVisibility() -> Bool
}

@MainActor
public protocol GhosttyOpenConfigPerforming: AnyObject {
  func performOpenConfig() -> Bool
}

@MainActor
public protocol GhosttyBindingMenuKeyPerforming: AnyObject {
  func performGhosttyBindingMenuKeyEquivalent(with event: NSEvent) -> Bool
}
