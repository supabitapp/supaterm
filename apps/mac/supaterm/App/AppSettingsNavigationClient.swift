import AppKit
import ComposableArchitecture
import SupatermSettingsFeature

struct AppSettingsNavigationClient: Sendable {
  var open: @MainActor @Sendable (SettingsFeature.Tab) -> Void
}

extension AppSettingsNavigationClient: DependencyKey {
  static let liveValue = Self(
    open: { tab in
      _ = (NSApp.delegate as? AppDelegate)?.performShowSettings(tab: tab)
    }
  )

  static let testValue = Self(open: { _ in })
}

extension DependencyValues {
  var appSettingsNavigationClient: AppSettingsNavigationClient {
    get { self[AppSettingsNavigationClient.self] }
    set { self[AppSettingsNavigationClient.self] = newValue }
  }
}
