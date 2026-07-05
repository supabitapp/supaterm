import SwiftUI

public nonisolated struct Theme: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let lightPrimary: Color
  public let darkPrimary: Color

  public init(id: String, name: String, lightPrimary: Color, darkPrimary: Color) {
    self.id = id
    self.name = name
    self.lightPrimary = lightPrimary
    self.darkPrimary = darkPrimary
  }

  public func primary(for colorScheme: ColorScheme) -> Color {
    colorScheme == .dark ? darkPrimary : lightPrimary
  }

  public static let isabelline = Theme(
    id: "isabelline",
    name: "Isabelline",
    lightPrimary: Color(.displayP3, red: 0.89, green: 0.902, blue: 0.925),
    darkPrimary: Color(.displayP3, red: 0.89, green: 0.902, blue: 0.925)
  )

  public static let bittersweetShimmer = Theme(
    id: "bittersweet-shimmer",
    name: "Bittersweet Shimmer",
    lightPrimary: Color(p3: 0xC1575C),
    darkPrimary: Color(p3: 0xCC4A55)
  )

  public static let burntSienna = Theme(
    id: "burnt-sienna",
    name: "Burnt Sienna",
    lightPrimary: Color(p3: 0xD87249),
    darkPrimary: Color(p3: 0xC95125)
  )

  public static let hunyadiYellow = Theme(
    id: "hunyadi-yellow",
    name: "Hunyadi Yellow",
    lightPrimary: Color(p3: 0xE3AC38),
    darkPrimary: Color(p3: 0xC98400)
  )

  public static let mint = Theme(
    id: "mint",
    name: "Mint",
    lightPrimary: Color(p3: 0x3EB489),
    darkPrimary: Color(p3: 0x008B5D)
  )

  public static let puce = Theme(
    id: "puce",
    name: "Puce",
    lightPrimary: Color(p3: 0xD37B8B),
    darkPrimary: Color(p3: 0xBD556B)
  )

  public static let steelBlue = Theme(
    id: "steel-blue",
    name: "Steel Blue",
    lightPrimary: Color(p3: 0x3A88C4),
    darkPrimary: Color(p3: 0x007FBD)
  )

  public static let ultraViolet = Theme(
    id: "ultra-violet",
    name: "Ultra Violet",
    lightPrimary: Color(p3: 0x5F5B9E),
    darkPrimary: Color(p3: 0x625DA5)
  )

  public static let curated: [Theme] = [
    isabelline, bittersweetShimmer, burntSienna, hunyadiYellow, mint, puce, steelBlue, ultraViolet,
  ]

  public static let `default` = isabelline
}

extension Color {
  fileprivate nonisolated init(p3 hex: UInt32) {
    self.init(
      .displayP3,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}
