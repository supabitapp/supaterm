import SupaTheme
import SupatermSupport
import SwiftUI

struct TerminalAgentBadgeGroupView: View {
  static let maxVisibleCount = 3
  static let badgeSize: CGFloat = 16
  static let badgeOverlap: CGFloat = badgeSize * 0.35

  let activities: [TerminalHostState.AgentActivity]
  let isSelected: Bool
  let palette: Palette

  static func visibleActivities(
    _ activities: [TerminalHostState.AgentActivity],
    maxVisibleCount: Int = Self.maxVisibleCount
  ) -> [TerminalHostState.AgentActivity] {
    Array(activities.prefix(maxVisibleCount))
  }

  static func overflowCount(
    for activities: [TerminalHostState.AgentActivity],
    maxVisibleCount: Int = Self.maxVisibleCount
  ) -> Int {
    max(0, activities.count - maxVisibleCount)
  }

  static let markRenderingMode: Image.TemplateRenderingMode = .template

  var body: some View {
    let visibleActivities = Self.visibleActivities(activities)
    let overflowCount = Self.overflowCount(for: activities)

    HStack(spacing: 4) {
      HStack(spacing: -Self.badgeOverlap) {
        ForEach(Array(visibleActivities.enumerated()), id: \.offset) { index, activity in
          TerminalAgentBadgeView(
            activity: activity,
            isSelected: isSelected,
            palette: palette
          )
          .zIndex(Double(visibleActivities.count - index))
        }
      }

      if overflowCount > 0 {
        Text("+\(overflowCount)")
          .font(.system(size: 7, weight: .bold))
          .foregroundStyle(isSelected ? palette.selectedText : palette.primaryText)
          .padding(.horizontal, 3)
          .frame(minWidth: Self.badgeSize, minHeight: Self.badgeSize)
          .background(badgeFill, in: Capsule(style: .continuous))
          .overlay {
            Capsule(style: .continuous)
              .strokeBorder(badgeStroke, lineWidth: pixelLength)
          }
      }
    }
    .fixedSize()
    .accessibilityHidden(true)
  }

  @Environment(\.pixelLength) private var pixelLength

  private var badgeFill: Color {
    isSelected ? palette.selectedPillFill : palette.unselectedFill
  }

  private var badgeStroke: Color {
    isSelected ? palette.selectedPillStroke : palette.detailStroke
  }
}

private struct TerminalAgentBadgeView: View {
  let activity: TerminalHostState.AgentActivity
  let isSelected: Bool
  let palette: Palette

  var body: some View {
    Image(activity.kind.markImageName)
      .renderingMode(TerminalAgentBadgeGroupView.markRenderingMode)
      .resizable()
      .aspectRatio(contentMode: .fit)
      .padding(3)
      .frame(
        width: TerminalAgentBadgeGroupView.badgeSize,
        height: TerminalAgentBadgeGroupView.badgeSize
      )
      .foregroundStyle(isSelected ? palette.selectedText : palette.primaryText)
      .background {
        ZStack {
          Circle().fill(palette.detailBackground)
          Circle().fill(badgeFill)
        }
      }
      .overlay {
        Circle()
          .strokeBorder(badgeStroke, lineWidth: pixelLength)
      }
      .accessibilityHidden(true)
  }

  @Environment(\.pixelLength) private var pixelLength

  private var badgeFill: Color {
    isSelected ? palette.selectedPillFill : palette.unselectedFill
  }

  private var badgeStroke: Color {
    isSelected ? palette.selectedPillStroke : palette.detailStroke
  }
}

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
      return palette.attention
    case .error:
      return palette.destructive
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
            .foregroundStyle(Color.white)
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
      return color(for: activity.tone).opacity(isSelected ? 0.72 : 0.9)
    case .running:
      return .clear
    case .idle:
      return color(for: activity.tone).opacity(isSelected ? 0.72 : 0.9)
    }
  }

  private var scale: CGFloat {
    activity.phase == .needsInput && isAnimating ? 1.14 : 1
  }

  private var verticalOffset: CGFloat {
    activity.phase == .needsInput && isAnimating ? -1 : 0
  }

  private func color(for tone: TerminalHostState.AgentActivityTone) -> Color {
    switch tone {
    case .attention:
      return palette.attention
    case .active:
      return palette.accent
    case .muted:
      return palette.secondaryText
    }
  }
}

struct TerminalSidebarBellIndicatorView: View {
  let isSelected: Bool
  let palette: Palette

  var body: some View {
    RoundedRectangle(cornerRadius: 5, style: .continuous)
      .fill(palette.attention.opacity(isSelected ? 0.72 : 0.9))
      .frame(width: 16, height: 16)
      .overlay {
        Image(systemName: "bell.fill")
          .font(.system(size: 9, weight: .semibold))
          .foregroundStyle(Color.white)
          .accessibilityHidden(true)
      }
  }
}
