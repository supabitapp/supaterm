import SwiftUI

public nonisolated struct Theme: Identifiable, Equatable, Sendable {
  public struct Background: Equatable, Sendable {
    public let top: Color
    public let bottom: Color

    public init(top: Color, bottom: Color) {
      self.top = top
      self.bottom = bottom
    }
  }

  public let id: String
  public let name: String
  public let lightPrimary: Color
  public let darkPrimary: Color
  public let lightBackground: Background
  public let darkBackground: Background

  public init(
    id: String,
    name: String,
    lightPrimary: Color,
    darkPrimary: Color,
    lightBackground: Background,
    darkBackground: Background
  ) {
    self.id = id
    self.name = name
    self.lightPrimary = lightPrimary
    self.darkPrimary = darkPrimary
    self.lightBackground = lightBackground
    self.darkBackground = darkBackground
  }

  public func primary(for colorScheme: ColorScheme) -> Color {
    colorScheme == .dark ? darkPrimary : lightPrimary
  }

  public func background(for colorScheme: ColorScheme) -> Background {
    colorScheme == .dark ? darkBackground : lightBackground
  }

  public static let isabelline = Theme(
    id: "isabelline",
    name: "Isabelline",
    lightPrimary: Color(.displayP3, red: 0.89, green: 0.902, blue: 0.925),
    darkPrimary: Color(.displayP3, red: 0.89, green: 0.902, blue: 0.925),
    lightBackground: Background(top: Color(rgb: 0xE4E4E4), bottom: Color(rgb: 0xEDEDED)),
    darkBackground: Background(top: Color(rgb: 0x1F1F1F), bottom: Color(rgb: 0x191919))
  )

  public static let bittersweetShimmer = Theme(
    id: "bittersweet-shimmer",
    name: "Bittersweet Shimmer",
    lightPrimary: Color(p3: 0xC1575C),
    darkPrimary: Color(p3: 0xCC4A55),
    lightBackground: Background(top: Color(rgb: 0xEDD0D1), bottom: Color(rgb: 0xFAF6F6)),
    darkBackground: Background(top: Color(rgb: 0x351C1E), bottom: Color(rgb: 0x3D3A3A))
  )

  public static let burntSienna = Theme(
    id: "burnt-sienna",
    name: "Burnt Sienna",
    lightPrimary: Color(p3: 0xD87249),
    darkPrimary: Color(p3: 0xC95125),
    lightBackground: Background(top: Color(rgb: 0xEFD4CA), bottom: Color(rgb: 0xFBF8F7)),
    darkBackground: Background(top: Color(rgb: 0x351D16), bottom: Color(rgb: 0x3E3C3B))
  )

  public static let hunyadiYellow = Theme(
    id: "hunyadi-yellow",
    name: "Hunyadi Yellow",
    lightPrimary: Color(p3: 0xE3AC38),
    darkPrimary: Color(p3: 0xC98400),
    lightBackground: Background(top: Color(rgb: 0xF4E5CA), bottom: Color(rgb: 0xFBFAF6)),
    darkBackground: Background(top: Color(rgb: 0x312414), bottom: Color(rgb: 0x3E3D3A))
  )

  public static let mint = Theme(
    id: "mint",
    name: "Mint",
    lightPrimary: Color(p3: 0x3EB489),
    darkPrimary: Color(p3: 0x008B5D),
    lightBackground: Background(top: Color(rgb: 0xCCE8DC), bottom: Color(rgb: 0xEFF7F4)),
    darkBackground: Background(top: Color(rgb: 0x4C4848), bottom: Color(rgb: 0x353B39))
  )

  public static let puce = Theme(
    id: "puce",
    name: "Puce",
    lightPrimary: Color(p3: 0xD37B8B),
    darkPrimary: Color(p3: 0xBD556B),
    lightBackground: Background(top: Color(rgb: 0xF1D9DD), bottom: Color(rgb: 0xFCFBFB)),
    darkBackground: Background(top: Color(rgb: 0x331E20), bottom: Color(rgb: 0x3E3E3E))
  )

  public static let steelBlue = Theme(
    id: "steel-blue",
    name: "Steel Blue",
    lightPrimary: Color(p3: 0x3A88C4),
    darkPrimary: Color(p3: 0x007FBD),
    lightBackground: Background(top: Color(rgb: 0xC7D9E9), bottom: Color(rgb: 0xF1F5F9)),
    darkBackground: Background(top: Color(rgb: 0x132630), bottom: Color(rgb: 0x373A3C))
  )

  public static let ultraViolet = Theme(
    id: "ultra-violet",
    name: "Ultra Violet",
    lightPrimary: Color(p3: 0x5F5B9E),
    darkPrimary: Color(p3: 0x625DA5),
    lightBackground: Background(top: Color(rgb: 0xD1D0E2), bottom: Color(rgb: 0xF2F2F6)),
    darkBackground: Background(top: Color(rgb: 0x1E1F2E), bottom: Color(rgb: 0x38373A))
  )

  public static let curated: [Theme] = [
    isabelline, bittersweetShimmer, burntSienna, hunyadiYellow, mint, puce, steelBlue, ultraViolet,
  ]

  public static let `default` = isabelline

  public static func curated(id: String) -> Theme {
    curated.first { $0.id == id } ?? .default
  }
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

  fileprivate nonisolated init(rgb hex: UInt32) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}
