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

struct TerminalSidebarAgentStatusView: View {
  let activity: TerminalHostState.AgentActivity
  let showsText: Bool
  let palette: Palette

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isAnimating = false

  var body: some View {
    HStack(spacing: 4) {
      indicator

      if showsText, let label {
        Text(label)
          .font(.system(size: 10, weight: .semibold))
      }
    }
    .foregroundStyle(color)
    .fixedSize()
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
    .accessibilityLabel(accessibilityLabel)
  }

  @ViewBuilder
  private var indicator: some View {
    switch activity.phase {
    case .needsInput:
      Image(systemName: "bell.fill")
        .font(.system(size: 8, weight: .semibold))
        .frame(width: 16, height: 16)
        .scaleEffect(scale)
        .offset(y: verticalOffset)
        .accessibilityHidden(true)

    case .running:
      TerminalProgressRingIndicatorView(
        fraction: nil,
        color: palette.accent,
        trackColor: palette.accent.opacity(0.2),
        diameter: 10
      )

    case .idle:
      EmptyView()
    }
  }

  private var label: String? {
    switch activity.phase {
    case .needsInput:
      "Input"
    case .running:
      "Working"
    case .idle:
      nil
    }
  }

  private var accessibilityLabel: String {
    switch activity.phase {
    case .needsInput:
      "Agent needs input"
    case .running:
      "Agent working"
    case .idle:
      "Agent idle"
    }
  }

  private var color: Color {
    switch activity.phase {
    case .needsInput:
      palette.warning
    case .running:
      palette.accent
    case .idle:
      palette.secondaryText
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

  private var scale: CGFloat {
    activity.phase == .needsInput && isAnimating ? 1.14 : 1
  }

  private var verticalOffset: CGFloat {
    activity.phase == .needsInput && isAnimating ? -1 : 0
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
