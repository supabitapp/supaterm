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
  public static let liveValue = unimplementedValue()

  public static let testValue = unimplementedValue()

  private static func unimplementedValue() -> Self {
    Self(capture: unimplemented("AnalyticsClient.capture"))
  }
}

extension DependencyValues {
  public var analyticsClient: AnalyticsClient {
    get { self[AnalyticsClient.self] }
    set { self[AnalyticsClient.self] = newValue }
  }
}
