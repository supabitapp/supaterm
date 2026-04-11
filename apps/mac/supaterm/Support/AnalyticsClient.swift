import ComposableArchitecture

public struct AnalyticsClient: Sendable {
  public var capture: @Sendable (_ event: String) -> Void

  public init(
    capture: @escaping @Sendable (_ event: String) -> Void
  ) {
    self.capture = capture
  }
}

extension AnalyticsClient: DependencyKey {
  public static let liveValue = Self(
    capture: { _ in }
  )

  public static let testValue = Self(
    capture: { _ in }
  )
}

extension DependencyValues {
  public var analyticsClient: AnalyticsClient {
    get { self[AnalyticsClient.self] }
    set { self[AnalyticsClient.self] = newValue }
  }
}
