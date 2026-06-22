public struct TerminalSidebarTerminalProgress: Equatable {
  public enum Tone: Equatable {
    case active
    case paused
    case error
  }

  public enum IndicatorStyle: Equatable {
    case ring
    case pauseIcon
  }

  public let fraction: Double?
  public let tone: Tone

  public init(fraction: Double?, tone: Tone) {
    self.fraction = fraction
    self.tone = tone
  }

  public var indicatorStyle: IndicatorStyle {
    switch tone {
    case .paused:
      return .pauseIcon
    case .active, .error:
      return .ring
    }
  }
}
