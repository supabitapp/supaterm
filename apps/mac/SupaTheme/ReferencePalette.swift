import SwiftUI

public struct ReferenceTone: Equatable, Sendable {
  public let light: ThemeColor
  public let dark: ThemeColor

  public init(light: ThemeColor, dark: ThemeColor) {
    self.light = light
    self.dark = dark
  }

  public func color(for colorScheme: ColorScheme) -> ThemeColor {
    colorScheme == .dark ? dark : light
  }
}

public struct ThemeSwatch {
  public let name: String
  public let color: Color

  public init(name: String, color: Color) {
    self.name = name
    self.color = color
  }
}

public struct ReferencePalette: Equatable, Sendable {
  public let neutral: ReferenceTone
  public let rose: ReferenceTone
  public let clay: ReferenceTone
  public let gold: ReferenceTone
  public let green: ReferenceTone
  public let blush: ReferenceTone
  public let blue: ReferenceTone
  public let violet: ReferenceTone

  public init(
    neutral: ReferenceTone,
    rose: ReferenceTone,
    clay: ReferenceTone,
    gold: ReferenceTone,
    green: ReferenceTone,
    blush: ReferenceTone,
    blue: ReferenceTone,
    violet: ReferenceTone
  ) {
    self.neutral = neutral
    self.rose = rose
    self.clay = clay
    self.gold = gold
    self.green = green
    self.blush = blush
    self.blue = blue
    self.violet = violet
  }

  public static let `default` = ReferencePalette(
    neutral: ReferenceTone(light: ThemeColor(hex: 0xE3E6EC), dark: ThemeColor(hex: 0x9AA2AF)),
    rose: ReferenceTone(light: ThemeColor(hex: 0xC1575C), dark: ThemeColor(hex: 0xCC4A55)),
    clay: ReferenceTone(light: ThemeColor(hex: 0xD87249), dark: ThemeColor(hex: 0xC95125)),
    gold: ReferenceTone(light: ThemeColor(hex: 0xE3AC38), dark: ThemeColor(hex: 0xC98400)),
    green: ReferenceTone(light: ThemeColor(hex: 0x3EB489), dark: ThemeColor(hex: 0x008B5D)),
    blush: ReferenceTone(light: ThemeColor(hex: 0xD37B8B), dark: ThemeColor(hex: 0xBD556B)),
    blue: ReferenceTone(light: ThemeColor(hex: 0x3A88C4), dark: ThemeColor(hex: 0x007FBD)),
    violet: ReferenceTone(light: ThemeColor(hex: 0x5F5B9E), dark: ThemeColor(hex: 0x625DA5))
  )

  public func swatches(for colorScheme: ColorScheme) -> [ThemeSwatch] {
    [
      ThemeSwatch(name: "ref.neutral", color: neutral.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.rose", color: rose.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.clay", color: clay.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.gold", color: gold.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.green", color: green.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.blush", color: blush.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.blue", color: blue.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.violet", color: violet.color(for: colorScheme).color),
    ]
  }
}
