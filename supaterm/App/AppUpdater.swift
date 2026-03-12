import Sparkle

@MainActor
final class AppUpdater {
  private let controller: SPUStandardUpdaterController?

  init() {
    #if DEBUG
      controller = nil
    #else
      let controller = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: nil,
        userDriverDelegate: nil
      )
      let updater = controller.updater
      updater.updateCheckInterval = 900
      if updater.automaticallyChecksForUpdates {
        updater.checkForUpdatesInBackground()
      }
      self.controller = controller
    #endif
  }

  var isAvailable: Bool {
    controller != nil
  }

  func checkForUpdates() {
    controller?.updater.checkForUpdates()
  }
}
