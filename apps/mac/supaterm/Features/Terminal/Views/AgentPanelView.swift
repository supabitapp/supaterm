import SwiftUI

enum AgentPanelMetrics {
  static let expandedWidth: CGFloat = 306
  static let collapsedLength: CGFloat = 30
  static let contentPadding: CGFloat = 12
  static let expandedCornerRadius: CGFloat = 8
  static let collapsedCornerRadius: CGFloat = 6
}

enum AgentPanelShortcut {
  static let toggleVisibility = KeyboardShortcut("i", modifiers: .command)
}

struct AgentPanelView: View {
  let presentation: PaneAgentPanelPresentation
  let palette: TerminalPalette
  let openURL: (URL) -> Void

  @State private var checksAreExpanded = false

  var body: some View {
    content
      .padding(AgentPanelMetrics.contentPadding)
      .frame(width: AgentPanelMetrics.expandedWidth, alignment: .leading)
      .accessibilityElement(children: .contain)
  }

  private var content: some View {
    VStack(alignment: .leading, spacing: 10) {
      if !presentation.progressRows.isEmpty {
        section("Progress") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(presentation.progressRows) { row in
              progressRow(row)
            }
          }
        }
      }

      if let branchDetails = presentation.branchDetails {
        section("Branch details") {
          VStack(alignment: .leading, spacing: 6) {
            valueRow(
              icon: .asset("git-branch"),
              title: branchDetails.branchName
            )
            changesRow(
              addedLineCount: branchDetails.addedLineCount,
              removedLineCount: branchDetails.removedLineCount
            )
            if let pullRequestStatus = branchDetails.displayedPullRequestStatus {
              pullRequestRow(pullRequestStatus)
              if let checks = pullRequestStatus.checks, !checks.isEmpty {
                pullRequestChecksRows(checks)
              }
            }
          }
        }
      }

      if !presentation.artifacts.isEmpty {
        section("Artifacts") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(presentation.artifacts) { artifact in
              linkRow(icon: .system("network"), title: artifact.title, url: artifact.url)
            }
          }
        }
      }

      if !presentation.sources.isEmpty {
        section("Sources") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(presentation.sources) { source in
              valueRow(icon: .system(sourceSymbol(source)), title: source.title)
            }
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func section<Content: View>(
    _ title: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(palette.secondaryText)
        .textCase(.uppercase)
      content()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func progressRow(_ row: PaneAgentProgressRow) -> some View {
    HStack(spacing: 7) {
      AgentPanelProgressIcon(
        status: row.status,
        palette: palette
      )
      Text(row.title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.primaryText)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func valueRow(
    icon: AgentPanelIcon,
    title: String,
    iconColor: Color? = nil
  ) -> some View {
    HStack(spacing: 7) {
      rowIcon(icon, color: iconColor ?? palette.secondaryText)
      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func changesRow(addedLineCount: Int, removedLineCount: Int) -> some View {
    HStack(spacing: 7) {
      Image(systemName: "plus.forwardslash.minus")
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .frame(width: 14)
        .accessibilityHidden(true)
      HStack(spacing: 4) {
        Text("+\(addedLineCount, format: .number)")
          .foregroundStyle(palette.mint)
        Text("-\(removedLineCount, format: .number)")
          .foregroundStyle(palette.coral)
      }
      .font(.system(size: 12, weight: .medium))
      .lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func pullRequestRow(_ status: PaneAgentPullRequestStatus) -> some View {
    let icon = pullRequestIcon(status)
    let color = pullRequestColor(status.kind)
    if let url = status.url {
      linkRow(icon: icon, title: status.title, url: url, iconColor: color)
    } else {
      valueRow(icon: icon, title: status.title, iconColor: color)
    }
  }

  private func linkRow(
    icon: AgentPanelIcon,
    title: String,
    url: URL,
    iconColor: Color? = nil
  ) -> some View {
    Button {
      openURL(url)
    } label: {
      HStack(spacing: 7) {
        rowIcon(icon, color: iconColor ?? palette.secondaryText)
        Text(title)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.primaryText)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 4)
        Image(systemName: "arrow.up.right")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(palette.secondaryText)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }

  @ViewBuilder
  private func rowIcon(
    _ icon: AgentPanelIcon,
    color: Color
  ) -> some View {
    switch icon {
    case .asset(let name):
      Image(name)
        .renderingMode(.template)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 13, height: 13)
        .frame(width: 14)
        .foregroundStyle(color)
        .accessibilityHidden(true)

    case .system(let name):
      Image(systemName: name)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(color)
        .frame(width: 14)
        .accessibilityHidden(true)
    }
  }

  private func pullRequestChecksRows(_ checks: PaneAgentPullRequestChecks) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Button {
        checksAreExpanded.toggle()
      } label: {
        pullRequestChecksSummaryRow(checks)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(checks.title)
      .accessibilityValue(checksAreExpanded ? "Expanded" : "Collapsed")

      if checksAreExpanded {
        ForEach(checks.items) { item in
          checkRow(item)
        }
      }
    }
  }

  private func pullRequestChecksSummaryRow(_ checks: PaneAgentPullRequestChecks) -> some View {
    HStack(spacing: 7) {
      PullRequestChecksRingView(checks: checks, palette: palette)
        .frame(width: 14)
        .accessibilityHidden(true)
      Text(checks.title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)
        .truncationMode(.middle)
      Spacer(minLength: 4)
      Image(systemName: checksAreExpanded ? "chevron.down" : "chevron.right")
        .font(.system(size: 8, weight: .bold))
        .foregroundStyle(palette.secondaryText)
        .frame(width: 10)
        .accessibilityHidden(true)
    }
    .contentShape(.rect)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func checkRow(_ item: PaneAgentPullRequestCheck) -> some View {
    if let url = item.url {
      Button {
        openURL(url)
      } label: {
        checkRowContent(item, showsLink: true)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("\(item.title), \(item.detailText())")
    } else {
      checkRowContent(item, showsLink: false)
    }
  }

  private func checkRowContent(
    _ item: PaneAgentPullRequestCheck,
    showsLink: Bool
  ) -> some View {
    HStack(spacing: 7) {
      Circle()
        .fill(checkColor(item.status))
        .frame(width: 6, height: 6)
        .frame(width: 14)
        .accessibilityHidden(true)
      Text("\(item.title) - \(item.detailText())")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .lineLimit(1)
        .truncationMode(.middle)
      if showsLink {
        Spacer(minLength: 4)
        Image(systemName: "arrow.up.right")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(palette.secondaryText)
          .accessibilityHidden(true)
      }
    }
    .contentShape(.rect)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func pullRequestIcon(_ status: PaneAgentPullRequestStatus) -> AgentPanelIcon {
    switch status.kind {
    case .unavailable:
      return .system("exclamationmark.circle")
    case .none:
      if status.url != nil {
        return .asset("github-logo")
      }
      return .system("plus.circle")
    case .open, .draft, .merged, .closed:
      return .asset("git-pull-request-arrow")
    }
  }

  private func pullRequestColor(_ kind: PaneAgentPullRequestStatus.Kind) -> Color {
    switch kind {
    case .unavailable:
      return palette.amber
    case .none:
      return palette.secondaryText
    case .open:
      return palette.mint
    case .draft:
      return palette.secondaryText
    case .merged:
      return palette.violet
    case .closed:
      return palette.coral
    }
  }

  private func checkColor(_ status: PaneAgentPullRequestCheck.Status) -> Color {
    switch status {
    case .pending:
      return palette.amber
    case .passing:
      return palette.mint
    case .failing:
      return palette.coral
    case .skipped:
      return palette.secondaryText
    }
  }

  private func sourceSymbol(_ source: PaneAgentSource) -> String {
    switch source.kind {
    case .webSearch:
      return "globe"
    }
  }
}

private enum AgentPanelIcon {
  case asset(String)
  case system(String)
}

private struct AgentPanelProgressIcon: View {
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

private struct PullRequestChecksRingView: View {
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
