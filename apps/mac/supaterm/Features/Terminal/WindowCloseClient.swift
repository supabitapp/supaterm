import ComposableArchitecture
import Foundation

struct WindowCloseClient: Sendable {
  var closeWindow: @MainActor @Sendable (ObjectIdentifier) async -> Void
  var closeWindows: @MainActor @Sendable ([ObjectIdentifier]) async -> Void
}

extension WindowCloseClient: DependencyKey {
  static let liveValue = Self(
    closeWindow: { _ in },
    closeWindows: { _ in }
  )

  static let testValue = liveValue
}

extension DependencyValues {
  var windowCloseClient: WindowCloseClient {
    get { self[WindowCloseClient.self] }
    set { self[WindowCloseClient.self] = newValue }
  }
}
