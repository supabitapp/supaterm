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
    triTone(in: palette).primary
  }

  public func triTone(in palette: ReferencePalette) -> ReferenceTriTone {
    palette.triTone(for: self)
  }
}
