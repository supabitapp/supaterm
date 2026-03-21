import AppKit
import ComposableArchitecture

struct AppTerminationClient: Sendable {
  var reply: @MainActor @Sendable (Bool) -> Void
}

extension AppTerminationClient: DependencyKey {
  static let liveValue = Self(
    reply: { shouldTerminate in
      NSApplication.shared.reply(toApplicationShouldTerminate: shouldTerminate)
    }
  )

  static let testValue = Self(
    reply: { _ in }
  )
}

extension DependencyValues {
  var appTerminationClient: AppTerminationClient {
    get { self[AppTerminationClient.self] }
    set { self[AppTerminationClient.self] = newValue }
  }
}
