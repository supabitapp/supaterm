import ComposableArchitecture
import Foundation

public struct WindowCloseClient: Sendable {
  public var closeWindow: @MainActor @Sendable (ObjectIdentifier) async -> Void
  public var closeWindows: @MainActor @Sendable ([ObjectIdentifier]) async -> Void

  public init(
    closeWindow: @escaping @MainActor @Sendable (ObjectIdentifier) async -> Void,
    closeWindows: @escaping @MainActor @Sendable ([ObjectIdentifier]) async -> Void
  ) {
    self.closeWindow = closeWindow
    self.closeWindows = closeWindows
  }
}

extension WindowCloseClient: DependencyKey {
  public static let liveValue = Self(
    closeWindow: { _ in },
    closeWindows: { _ in }
  )

  public static let testValue = liveValue
}

extension DependencyValues {
  public var windowCloseClient: WindowCloseClient {
    get { self[WindowCloseClient.self] }
    set { self[WindowCloseClient.self] = newValue }
  }
}
