import SwiftUI

public struct ThemeColor: Equatable, Sendable {
  public let red: Double
  public let green: Double
  public let blue: Double
  public let alpha: Double

  public init(
    red: Double,
    green: Double,
    blue: Double,
    alpha: Double = 1
  ) {
    self.red = red
    self.green = green
    self.blue = blue
    self.alpha = alpha
  }

  public init(hex: UInt32, alpha: Double = 1) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255,
      alpha: alpha
    )
  }

  public var color: Color {
    Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
  }

  public func mixed(with other: ThemeColor, by amount: Double) -> ThemeColor {
    let t = ColorMath.clamped(amount)
    return ThemeColor(
      red: red + (other.red - red) * t,
      green: green + (other.green - green) * t,
      blue: blue + (other.blue - blue) * t,
      alpha: alpha + (other.alpha - alpha) * t
    )
  }

  public static let black = ThemeColor(red: 0, green: 0, blue: 0)
  public static let white = ThemeColor(red: 1, green: 1, blue: 1)
}
