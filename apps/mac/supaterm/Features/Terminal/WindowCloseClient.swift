import ComposableArchitecture
import Foundation

struct WindowCloseClient: Sendable {
  var closeWindow: @MainActor @Sendable (ObjectIdentifier) async -> Void
  var closeWindows: @MainActor @Sendable ([ObjectIdentifier]) async -> Void
}

extension WindowCloseClient: DependencyKey {
  static let liveValue = unimplementedValue()

  static let testValue = unimplementedValue()

  private static func unimplementedValue() -> Self {
    Self(
      closeWindow: unimplemented("WindowCloseClient.closeWindow"),
      closeWindows: unimplemented("WindowCloseClient.closeWindows")
    )
  }
}

extension DependencyValues {
  var windowCloseClient: WindowCloseClient {
    get { self[WindowCloseClient.self] }
    set { self[WindowCloseClient.self] = newValue }
  }
}
