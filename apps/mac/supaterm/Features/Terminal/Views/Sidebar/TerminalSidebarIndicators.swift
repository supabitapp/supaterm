import SupaTheme
import SupatermUI
import SwiftUI

struct TerminalSidebarTerminalProgress: Equatable {
  enum Tone: Equatable {
    case active
    case paused
    case error
  }

  enum IndicatorStyle: Equatable {
    case ring
    case pauseIcon
  }

  let fraction: Double?
  let tone: Tone

  var indicatorStyle: IndicatorStyle {
    switch tone {
    case .paused:
      return .pauseIcon
    case .active, .error:
      return .ring
    }
  }
}

struct TerminalSidebarProgressIndicatorView: View {
  let progress: TerminalSidebarTerminalProgress
  let isSelected: Bool
  let palette: Palette

  var body: some View {
    Group {
      switch progress.indicatorStyle {
      case .ring:
        if let fraction = progress.fraction {
          TerminalProgressRingIndicatorView(
            fraction: fraction,
            color: color,
            trackColor: trackColor
          )
        } else {
          DotsSpinner(size: 11, color: color)
            .frame(width: 16, height: 16)
        }
      case .pauseIcon:
        RoundedRectangle(cornerRadius: 5, style: .continuous)
          .fill(color.opacity(isSelected ? 0.24 : 0.16))
          .frame(width: 16, height: 16)
          .overlay {
            Image(systemName: "pause.fill")
              .font(.system(size: 8, weight: .bold))
              .foregroundStyle(color)
              .accessibilityHidden(true)
          }
      }
    }
    .accessibilityHidden(true)
  }

  private var trackColor: Color {
    color.opacity(isSelected ? 0.24 : 0.18)
  }

  private var color: Color {
    switch progress.tone {
    case .active:
      return isSelected ? palette.selectedSecondaryText : palette.secondaryText
    case .paused:
      return palette.warning
    case .error:
      return palette.danger
    }
  }
}

struct TerminalSidebarAgentStatusIconView: View {
  let status: TerminalHostState.TabAgentStatus
  let palette: Palette

  var body: some View {
    Group {
      switch status {
      case .needsInput:
        Image(systemName: "exclamationmark.circle.fill")
          .font(.system(size: 12, weight: .semibold))

      case .working:
        DotsSpinner(size: 12, color: color)

      case .done:
        Image(systemName: "checkmark.circle.fill")
          .font(.system(size: 12, weight: .semibold))
      }
    }
    .foregroundStyle(color)
    .accessibilityHidden(true)
  }

  private var color: Color {
    switch status {
    case .needsInput:
      palette.warning
    case .working:
      palette.working
    case .done:
      palette.success
    }
  }

}

enum TerminalSidebarWarningBadgeStyle {
  static func backgroundColor(isSelected: Bool, palette: Palette) -> Color {
    palette.warningFill.opacity(backgroundOpacity(isSelected: isSelected))
  }

  static func foregroundColor(isSelected: Bool, palette: Palette) -> Color {
    foregroundValue(isSelected: isSelected, palette: palette).color
  }

  static func selectedBackgroundValue(palette: Palette) -> ThemeColor {
    ColorMath.composited(
      palette.warningFillValue,
      opacity: backgroundOpacity(isSelected: true),
      over: palette.sidebarTabPrimarySurfaceValue
    )
  }

  static func foregroundValue(isSelected: Bool, palette: Palette) -> ThemeColor {
    guard isSelected else { return palette.onWarningFillValue }
    let background = selectedBackgroundValue(palette: palette)
    let blackContrast = ColorMath.contrastRatio(.black, background)
    let whiteContrast = ColorMath.contrastRatio(.white, background)
    return whiteContrast >= blackContrast ? .white : .black
  }

  private static func backgroundOpacity(isSelected: Bool) -> Double {
    isSelected ? 0.72 : 0.9
  }
}

struct TerminalSidebarBellIndicatorView: View {
  let isSelected: Bool
  let palette: Palette

  var body: some View {
    RoundedRectangle(cornerRadius: 5, style: .continuous)
      .fill(TerminalSidebarWarningBadgeStyle.backgroundColor(isSelected: isSelected, palette: palette))
      .frame(width: 16, height: 16)
      .overlay {
        Image(systemName: "bell.fill")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(TerminalSidebarWarningBadgeStyle.foregroundColor(isSelected: isSelected, palette: palette))
          .accessibilityHidden(true)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(accessibilityLabel)
      .help(accessibilityLabel)
  }

  private var accessibilityLabel: String { "Terminal attention" }
}
