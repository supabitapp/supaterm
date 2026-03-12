import Sparkle

@MainActor
final class AppUpdater {
  private let controller: SPUStandardUpdaterController?

  init() {
    #if DEBUG
      controller = nil
    #else
      controller = SPUStandardUpdaterController(
        startingUpdater: true,
        updaterDelegate: nil,
        userDriverDelegate: nil
      )
    #endif
  }

  var isAvailable: Bool {
    controller != nil
  }

  func checkForUpdates() {
    controller?.updater.checkForUpdates()
  }
}
