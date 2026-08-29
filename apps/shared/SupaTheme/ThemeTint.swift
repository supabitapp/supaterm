public enum ThemeTint: String, CaseIterable, Codable, Sendable {
  case neutral
  case red
  case orange
  case yellow
  case green
  case blue
  case pink
  case purple

  public static var chromatic: [ThemeTint] {
    allCases.filter { $0 != .neutral }
  }

  public func tone(in palette: ReferencePalette) -> ReferenceTone {
    switch self {
    case .neutral: palette.neutral
    case .red: palette.rose
    case .orange: palette.clay
    case .yellow: palette.gold
    case .green: palette.green
    case .blue: palette.blue
    case .pink: palette.blush
    case .purple: palette.violet
    }
  }
}
