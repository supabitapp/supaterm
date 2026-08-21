import ComposableArchitecture

public struct AnalyticsClient: Sendable {
  public var capture: @Sendable (_ event: String) -> Void
  public var captureProperties: @Sendable (_ event: String, _ properties: [String: String]) -> Void

  public init(
    capture: @escaping @Sendable (_ event: String) -> Void,
    captureProperties: (@Sendable (_ event: String, _ properties: [String: String]) -> Void)? = nil
  ) {
    self.capture = capture
    self.captureProperties = captureProperties ?? { event, _ in capture(event) }
  }
}

extension AnalyticsClient: DependencyKey {
  public static let liveValue = unimplementedValue()

  public static let testValue = Self(capture: { _ in }, captureProperties: { _, _ in })

  private static func unimplementedValue() -> Self {
    Self(
      capture: unimplemented("AnalyticsClient.capture"),
      captureProperties: unimplemented("AnalyticsClient.captureProperties")
    )
  }
}

extension DependencyValues {
  public var analyticsClient: AnalyticsClient {
    get { self[AnalyticsClient.self] }
    set { self[AnalyticsClient.self] = newValue }
  }
}
