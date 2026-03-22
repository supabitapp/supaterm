import AppKit

@testable import supaterm

@MainActor
final class GhosttyAppActionPerformerSpy: NSObject, NSApplicationDelegate, GhosttyAppActionPerforming,
  GhosttyOpenConfigPerforming
{
  var checkForUpdatesCount = 0
  var closeAllWindowsCount = 0
  var newWindowCount = 0
  var openConfigCount = 0
  var quitCount = 0

  func performCheckForUpdates() -> Bool {
    checkForUpdatesCount += 1
    return true
  }

  func performCloseAllWindows() -> Bool {
    closeAllWindowsCount += 1
    return true
  }

  func performNewWindow() -> Bool {
    newWindowCount += 1
    return true
  }

  func performOpenConfig() -> Bool {
    openConfigCount += 1
    return true
  }

  func performQuit() -> Bool {
    quitCount += 1
    return true
  }
}
