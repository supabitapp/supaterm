import SupatermTerminalAgentPanelFeature
import SupatermTerminalPresentationFeature
import SwiftUI

enum AgentPanelIcon {
  case asset(String)
  case system(String)
}

struct AgentPanelIconView: View {
  let icon: AgentPanelIcon
  let color: Color

  var body: some View {
    switch icon {
    case .asset(let name):
      Image(name)
        .renderingMode(.template)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 13, height: 13)
        .frame(width: AgentPanelMetrics.rowIconWidth)
        .foregroundStyle(color)
        .accessibilityHidden(true)

    case .system(let name):
      Image(systemName: name)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(color)
        .frame(width: AgentPanelMetrics.rowIconWidth)
        .accessibilityHidden(true)
    }
  }
}

struct AgentPanelRowContent<Leading: View, Trailing: View>: View {
  let leading: Leading
  let title: String
  let titleColor: Color
  let trailingSpacing: CGFloat?
  let trailing: Trailing

  init(
    @ViewBuilder leading: () -> Leading,
    title: String,
    palette: TerminalPalette,
    titleColor: Color? = nil,
    trailingSpacing: CGFloat? = AgentPanelMetrics.rowTrailingSpacing,
    @ViewBuilder trailing: () -> Trailing
  ) {
    self.leading = leading()
    self.title = title
    self.titleColor = titleColor ?? palette.primaryText
    self.trailingSpacing = trailingSpacing
    self.trailing = trailing()
  }

  init(
    icon: AgentPanelIcon,
    title: String,
    palette: TerminalPalette,
    iconColor: Color,
    @ViewBuilder trailing: () -> Trailing
  ) where Leading == AgentPanelIconView {
    self.init(
      leading: {
        AgentPanelIconView(icon: icon, color: iconColor)
      },
      title: title,
      palette: palette,
      trailing: trailing
    )
  }

  var body: some View {
    HStack(spacing: AgentPanelMetrics.rowContentSpacing) {
      leading
      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(titleColor)
        .lineLimit(1)
        .truncationMode(.middle)
      if let trailingSpacing {
        Spacer(minLength: trailingSpacing)
      }
      trailing
    }
    .contentShape(.rect)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension AgentPanelRowContent where Trailing == EmptyView {
  init(
    @ViewBuilder leading: () -> Leading,
    title: String,
    palette: TerminalPalette,
    titleColor: Color? = nil
  ) {
    self.init(
      leading: leading,
      title: title,
      palette: palette,
      titleColor: titleColor,
      trailingSpacing: nil,
      trailing: {
        EmptyView()
      }
    )
  }

  init(
    icon: AgentPanelIcon,
    title: String,
    palette: TerminalPalette,
    iconColor: Color
  ) where Leading == AgentPanelIconView {
    self.init(
      leading: {
        AgentPanelIconView(icon: icon, color: iconColor)
      },
      title: title,
      palette: palette,
      trailingSpacing: nil,
      trailing: {
        EmptyView()
      }
    )
  }
}

struct AgentPanelActionRow: View {
  let icon: AgentPanelIcon
  let title: String
  let palette: TerminalPalette
  let shortcutHint: String?
  let helpText: String
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      rowContent
        .background {
          RoundedRectangle(cornerRadius: 5)
            .fill(rowBackground)
            .padding(.vertical, -4)
            .padding(.horizontal, -5)
        }
    }
    .buttonStyle(.plain)
    .help(helpText)
    .accessibilityLabel(title)
    .onHover { isHovering = $0 }
  }

  private var rowBackground: Color {
    isHovering ? palette.secondaryText.opacity(0.12) : .clear
  }

  @ViewBuilder
  private var rowContent: some View {
    if let shortcutHint {
      AgentPanelRowContent(
        icon: icon,
        title: title,
        palette: palette,
        iconColor: palette.secondaryText
      ) {
        Text(shortcutHint)
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(palette.secondaryText)
          .monospacedDigit()
          .lineLimit(1)
      }
    } else {
      AgentPanelRowContent(
        icon: icon,
        title: title,
        palette: palette,
        iconColor: palette.secondaryText
      )
    }
  }
}

struct AgentPanelProgressIcon: View {
  let status: PaneAgentProgressRow.Status
  let palette: TerminalPalette

  var body: some View {
    Group {
      switch status {
      case .pending:
        image("circle", color: palette.secondaryText)
      case .running:
        TerminalAgentRunningSpinnerView(isSelected: false, palette: palette, diameter: 11)
      case .completed:
        image("checkmark.circle.fill", color: palette.mint)
      }
    }
    .frame(width: 16)
  }

  private func image(_ symbol: String, color: Color) -> some View {
    Image(systemName: symbol)
      .font(.system(size: 11, weight: .semibold))
      .foregroundStyle(color)
      .accessibilityHidden(true)
  }
}

struct PullRequestChecksRingView: View {
  let checks: PaneAgentPullRequestChecks
  let palette: TerminalPalette

  @ScaledMetric(relativeTo: .caption) private var diameter: CGFloat = 12
  @ScaledMetric(relativeTo: .caption) private var lineWidth: CGFloat = 2

  private let segmentGapFraction = 0.05

  var body: some View {
    ZStack {
      ForEach(segments(), id: \.id) { segment in
        Circle()
          .trim(from: segment.start, to: segment.end)
          .stroke(segment.color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
          .rotationEffect(.degrees(-90))
      }
    }
    .frame(width: diameter, height: diameter)
  }

  private func segments() -> [Segment] {
    let total = Double(checks.items.count)
    guard total > 0 else {
      return []
    }
    var start = 0.0
    var segments: [Segment] = []
    let counts = checks.itemCounts
    func addSegment(id: String, count: Int, color: Color) {
      guard count > 0 else {
        return
      }
      let end = start + Double(count) / total
      segments.append(Segment(id: id, start: start, end: end, color: color))
      start = end
    }
    addSegment(id: "failing", count: counts[.failing, default: 0], color: palette.coral)
    addSegment(id: "pending", count: counts[.pending, default: 0], color: palette.amber)
    addSegment(id: "skipped", count: counts[.skipped, default: 0], color: palette.secondaryText)
    addSegment(id: "passing", count: counts[.passing, default: 0], color: palette.mint)
    guard segments.count > 1 else {
      return segments
    }
    return segments.compactMap(trimmed)
  }

  private func trimmed(_ segment: Segment) -> Segment? {
    let length = segment.end - segment.start
    let gap = min(segmentGapFraction, length * 0.45)
    let start = segment.start + gap
    let end = segment.end - gap
    guard end > start else {
      return nil
    }
    return Segment(id: segment.id, start: start, end: end, color: segment.color)
  }

  private struct Segment {
    let id: String
    let start: Double
    let end: Double
    let color: Color
  }
}
