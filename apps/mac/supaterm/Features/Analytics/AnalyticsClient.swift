import ComposableArchitecture

struct AnalyticsClient: Sendable {
  var capture: @Sendable (_ event: String) -> Void
}

extension AnalyticsClient: DependencyKey {
  static let liveValue = Self(
    capture: { event in
      Task { @MainActor in
        AppTelemetry.capture(event)
      }
    }
  )

  static let testValue = Self(
    capture: { _ in }
  )
}

extension DependencyValues {
  var analyticsClient: AnalyticsClient {
    get { self[AnalyticsClient.self] }
    set { self[AnalyticsClient.self] = newValue }
  }
}
