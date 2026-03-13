import Foundation

@MainActor
final class UpdateRelaunchCoordinator {
  static let shared = UpdateRelaunchCoordinator()

  private(set) var bypassesQuitConfirmation = false

  func prepareForRelaunch() {
    bypassesQuitConfirmation = true
  }

  func reset() {
    bypassesQuitConfirmation = false
  }
}
