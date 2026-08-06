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

public struct ReferenceTriTone: Equatable, Sendable {
  public let primary: ReferenceTone
  public let secondary: ReferenceTone
  public let tertiary: ReferenceTone
  public let vibrant: ReferenceTone

  public init(
    primary: ReferenceTone,
    secondary: ReferenceTone,
    tertiary: ReferenceTone,
    vibrant: ReferenceTone
  ) {
    self.primary = primary
    self.secondary = secondary
    self.tertiary = tertiary
    self.vibrant = vibrant
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
  public let neutral: ReferenceTriTone
  public let rose: ReferenceTriTone
  public let clay: ReferenceTriTone
  public let gold: ReferenceTriTone
  public let green: ReferenceTriTone
  public let blush: ReferenceTriTone
  public let blue: ReferenceTriTone
  public let violet: ReferenceTriTone

  public init(
    neutral: ReferenceTriTone,
    rose: ReferenceTriTone,
    clay: ReferenceTriTone,
    gold: ReferenceTriTone,
    green: ReferenceTriTone,
    blush: ReferenceTriTone,
    blue: ReferenceTriTone,
    violet: ReferenceTriTone
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
    neutral: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0xCE6E3E), dark: ThemeColor(hex: 0xFA2AA9)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0x6DDC3D), dark: ThemeColor(hex: 0xE4E4E4)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0x3101E0), dark: ThemeColor(hex: 0x7F5F4F)),
      vibrant: ReferenceTone(light: .black, dark: .white)
    ),
    rose: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0xC5751C), dark: ThemeColor(hex: 0x55A4CC)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0x890DCF), dark: ThemeColor(hex: 0x02E236)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0x237191), dark: ThemeColor(hex: 0x9C9C7E)),
      vibrant: ReferenceTone(light: ThemeColor(hex: 0xB323FF), dark: ThemeColor(hex: 0xB000FF))
    ),
    clay: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0x94278D), dark: ThemeColor(hex: 0x52159C)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0x1B1DFF), dark: ThemeColor(hex: 0xA15256)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0x92D063), dark: ThemeColor(hex: 0xBB8DBE)),
      vibrant: ReferenceTone(light: ThemeColor(hex: 0x0026FF), dark: ThemeColor(hex: 0x0088FF))
    ),
    gold: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0x83CA3E), dark: ThemeColor(hex: 0x00489C)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0x0C6E9F), dark: ThemeColor(hex: 0xE17306)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0xB0B044), dark: ThemeColor(hex: 0x3BFD7F)),
      vibrant: ReferenceTone(light: ThemeColor(hex: 0x008CFF), dark: ThemeColor(hex: 0x008CFF))
    ),
    green: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0x984BE3), dark: ThemeColor(hex: 0xD5B800)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0xDA8E8C), dark: ThemeColor(hex: 0xD44500)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0x429200), dark: ThemeColor(hex: 0x3BFC1C)),
      vibrant: ReferenceTone(light: ThemeColor(hex: 0x3BFF03), dark: ThemeColor(hex: 0x2AFF00))
    ),
    blush: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0xB8B73D), dark: ThemeColor(hex: 0xB655DB)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0x0F5D4D), dark: ThemeColor(hex: 0x1805E4)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0x534183), dark: ThemeColor(hex: 0xADECBD)),
      vibrant: ReferenceTone(light: ThemeColor(hex: 0xFAEAFF), dark: ThemeColor(hex: 0x3717FC))
    ),
    blue: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0x4C88A3), dark: ThemeColor(hex: 0xDBF700)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0x9EFEFC), dark: ThemeColor(hex: 0x362400)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0x3380B0), dark: ThemeColor(hex: 0x4F2E1D)),
      vibrant: ReferenceTone(light: ThemeColor(hex: 0xFF4C20), dark: ThemeColor(hex: 0xFF4C20))
    ),
    violet: ReferenceTriTone(
      primary: ReferenceTone(light: ThemeColor(hex: 0xE9B5F5), dark: ThemeColor(hex: 0x5AD526)),
      secondary: ReferenceTone(light: ThemeColor(hex: 0xFBEB2E), dark: ThemeColor(hex: 0x34F265)),
      tertiary: ReferenceTone(light: ThemeColor(hex: 0x3380B0), dark: ThemeColor(hex: 0xAD9CAC)),
      vibrant: ReferenceTone(light: ThemeColor(hex: 0xFF789D), dark: ThemeColor(hex: 0xFF043C))
    )
  )

  public func swatches(for colorScheme: ColorScheme) -> [ThemeSwatch] {
    [
      ThemeSwatch(name: "ref.neutral", color: neutral.primary.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.rose", color: rose.primary.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.clay", color: clay.primary.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.gold", color: gold.primary.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.green", color: green.primary.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.blush", color: blush.primary.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.blue", color: blue.primary.color(for: colorScheme).color),
      ThemeSwatch(name: "ref.violet", color: violet.primary.color(for: colorScheme).color),
    ]
  }

  public func triTone(for tint: ThemeTint) -> ReferenceTriTone {
    switch tint {
    case .neutral: neutral
    case .red: rose
    case .orange: clay
    case .yellow: gold
    case .green: green
    case .blue: blue
    case .pink: blush
    case .purple: violet
    }
  }
}
