import SupaTheme
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
        TerminalProgressRingIndicatorView(
          fraction: progress.fraction,
          color: color,
          trackColor: trackColor
        )
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

struct TerminalSidebarAgentActivityView: View {
  let activity: TerminalHostState.AgentActivity
  let isSelected: Bool
  let palette: Palette

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isAnimating = false

  var body: some View {
    RoundedRectangle(cornerRadius: 5, style: .continuous)
      .fill(backgroundColor)
      .frame(width: 16, height: 16)
      .overlay {
        switch activity.phase {
        case .needsInput:
          Image(systemName: "bell.fill")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(TerminalSidebarWarningBadgeStyle.foregroundColor(isSelected: isSelected, palette: palette))
            .scaleEffect(scale)
            .offset(y: verticalOffset)
            .accessibilityHidden(true)

        case .running:
          TerminalAgentRunningSpinnerView(isSelected: isSelected, palette: palette)

        case .idle:
          EmptyView()
        }
      }
      .onAppear {
        startActivityAnimation(reduceMotion: reduceMotion)
      }
      .onChange(of: activity) { _, _ in
        restartActivityAnimation(reduceMotion: reduceMotion)
      }
      .onChange(of: reduceMotion) { _, reduceMotion in
        restartActivityAnimation(reduceMotion: reduceMotion)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("Agent activity: \(accessibilityPhase)")
  }

  private var accessibilityPhase: String {
    switch activity.phase {
    case .needsInput:
      "Needs input"
    case .running:
      "Running"
    case .idle:
      "Idle"
    }
  }

  private var animation: Animation? {
    switch activity.phase {
    case .needsInput:
      return .easeInOut(duration: 0.65)
        .repeatForever(autoreverses: true)
    case .running, .idle:
      return nil
    }
  }

  private func startActivityAnimation(reduceMotion: Bool) {
    guard !reduceMotion, let animation else { return }
    TerminalMotion.animate(animation, reduceMotion: reduceMotion) {
      isAnimating = true
    }
  }

  private func restartActivityAnimation(reduceMotion: Bool) {
    isAnimating = false
    startActivityAnimation(reduceMotion: reduceMotion)
  }

  private var backgroundColor: Color {
    switch activity.phase {
    case .needsInput:
      return TerminalSidebarWarningBadgeStyle.backgroundColor(isSelected: isSelected, palette: palette)
    case .running:
      return .clear
    case .idle:
      return fillColor(for: activity.tone).opacity(isSelected ? 0.72 : 0.9)
    }
  }

  private var scale: CGFloat {
    activity.phase == .needsInput && isAnimating ? 1.14 : 1
  }

  private var verticalOffset: CGFloat {
    activity.phase == .needsInput && isAnimating ? -1 : 0
  }

  private func fillColor(for tone: TerminalHostState.AgentActivityTone) -> Color {
    switch tone {
    case .attention:
      return palette.warningFill
    case .active:
      return palette.accent
    case .muted:
      return palette.secondaryText
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
  }
}
