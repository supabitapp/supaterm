public struct WindowActivityState: Equatable, Sendable {
  public let isKeyWindow: Bool
  public let isVisible: Bool

  public static let inactive = Self(isKeyWindow: false, isVisible: false)

  public init(isKeyWindow: Bool, isVisible: Bool) {
    self.isKeyWindow = isKeyWindow
    self.isVisible = isVisible
  }
}
