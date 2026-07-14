import SupaTheme
import SupatermCLIShared
import SwiftUI

enum AgentPanelMetrics {
  static let expandedWidth: CGFloat = 306
  static let collapsedLength: CGFloat = 30
  static let contentPadding: CGFloat = 12
  static let sectionSpacing: CGFloat = 10
  static let sectionContentSpacing: CGFloat = 6
  static let rowContentSpacing: CGFloat = 7
  static let rowTrailingSpacing: CGFloat = 4
  static let rowIconWidth: CGFloat = 14
  static let expandedCornerRadius: CGFloat = 8
  static let collapsedCornerRadius: CGFloat = 6
}

enum AgentPanelShortcut {
  static let toggleVisibility = KeyboardShortcut("i", modifiers: .command)
  static let forkSession = KeyboardShortcut("f", modifiers: [.command, .option])
  static let copySessionID = KeyboardShortcut("c", modifiers: [.command, .option])
}

struct AgentPanelView: View {
  let presentation: PaneAgentPanelPresentation
  let palette: Palette
  let forksDown: Bool
  let showsShortcutHints: Bool
  let copyText: (String) -> Void
  let forkSession: (SupatermPaneDirection, PaneAgentPanelSession) -> Void
  let openURL: (URL) -> Void

  @State private var checksAreExpanded = false

  var body: some View {
    content
      .padding(AgentPanelMetrics.contentPadding)
      .frame(width: AgentPanelMetrics.expandedWidth, alignment: .leading)
      .accessibilityElement(children: .contain)
  }

  private var content: some View {
    VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionSpacing) {
      if !presentation.progressRows.isEmpty {
        section("Progress") {
          VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
            ForEach(presentation.progressRows) { row in
              progressRow(row)
            }
          }
        }
      }

      if !presentation.activeChildren.isEmpty {
        section("Active agents") {
          VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
            ForEach(presentation.activeChildren) { child in
              activeChildRow(child)
            }
          }
        }
      }

      if presentation.workingDirectoryPath != nil || presentation.branchDetails != nil {
        section("Workspace") {
          VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
            if let workingDirectoryPath = presentation.workingDirectoryPath {
              workingDirectoryRow(workingDirectoryPath)
            }
            if let branchDetails = presentation.branchDetails {
              branchRow(branchDetails.branchName)
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
      }

      if !presentation.artifacts.isEmpty {
        section("Artifacts") {
          VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
            ForEach(presentation.artifacts) { artifact in
              linkRow(icon: .system("network"), title: artifact.title, url: artifact.url)
            }
          }
        }
      }

      if let session = presentation.session {
        actionBar(session)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func section<Content: View>(
    _ title: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
      Text(title)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(palette.secondaryText)
        .textCase(.uppercase)
      content()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func progressRow(_ row: PaneAgentProgressRow) -> some View {
    HStack(spacing: AgentPanelMetrics.rowContentSpacing) {
      AgentPanelProgressIcon(
        status: row.status,
        kind: row.kind,
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

  private func activeChildRow(_ child: TerminalAgentActiveChild) -> some View {
    HStack(alignment: .top, spacing: AgentPanelMetrics.rowContentSpacing) {
      AgentPanelProgressIcon(
        status: childProgressStatus(child.phase),
        kind: .task,
        palette: palette
      )
      VStack(alignment: .leading, spacing: 2) {
        Text(Self.childTitle(child))
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.primaryText)
        Text(Self.childDetail(child))
          .font(.system(size: 11))
          .foregroundStyle(palette.secondaryText)
          .lineLimit(2)
      }
      .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  static func childTitle(_ child: TerminalAgentActiveChild) -> String {
    let nickname = normalizedChildLabel(child.nickname)
    let role = normalizedChildLabel(child.role)
    switch (nickname, role) {
    case (.some(let nickname), .some(let role)):
      return "\(nickname) [\(role)]"
    case (.some(let nickname), nil):
      return nickname
    case (nil, .some(let role)):
      return role.replacingOccurrences(of: "_", with: " ").capitalized
    case (nil, nil):
      return "Agent"
    }
  }

  static func childDetail(_ child: TerminalAgentActiveChild) -> String {
    child.detail ?? "Working…"
  }

  private static func normalizedChildLabel(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
      !value.isEmpty
    else { return nil }
    return value
  }

  private func childProgressStatus(
    _ phase: AgentActivityPhase
  ) -> PaneAgentProgressRow.Status {
    switch phase {
    case .idle: .completed
    case .needsInput: .pending
    case .running: .running
    }
  }

  private func actionBar(_ session: PaneAgentPanelSession) -> some View {
    section("Agent actions") {
      VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
        AgentPanelActionRow(
          icon: .asset("git-fork"),
          title: Self.forkTitle(forksDown: forksDown),
          palette: palette,
          shortcutHint: shortcutHint(AgentPanelShortcut.forkSession),
          helpText: Self.forkHelpText(forksDown: forksDown),
          action: {
            forkSession(Self.forkDirection(forksDown: forksDown), session)
          }
        )
        AgentPanelActionRow(
          icon: .asset("copy"),
          title: "Copy session ID",
          palette: palette,
          shortcutHint: shortcutHint(AgentPanelShortcut.copySessionID),
          helpText: "Copy session ID",
          action: {
            copyText(session.sessionID)
          }
        )
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }

  static func forkDirection(forksDown: Bool) -> SupatermPaneDirection {
    forksDown ? .down : .right
  }

  static func forkTitle(forksDown: Bool) -> String {
    forksDown ? "Fork session below" : "Fork session right"
  }

  static func forkHelpText(forksDown: Bool) -> String {
    forksDown
      ? "Fork session below. Release Option to fork right."
      : "Fork session right. Hold Option to fork below."
  }

  private func shortcutHint(_ shortcut: KeyboardShortcut) -> String? {
    showsShortcutHints ? shortcut.display : nil
  }

  private func branchRow(_ branchName: String) -> some View {
    Button {
      copyText(branchName)
    } label: {
      valueRow(icon: .asset("git-branch"), title: branchName)
    }
    .buttonStyle(AgentPanelRowButtonStyle(palette: palette))
    .help("Copy branch name")
    .accessibilityLabel("Copy branch name")
    .accessibilityValue(branchName)
  }

  private func workingDirectoryRow(_ path: String) -> some View {
    let displayPath = (path as NSString).abbreviatingWithTildeInPath
    return Button {
      copyText(path)
    } label: {
      AgentPanelRowContent(
        icon: .system("folder"),
        title: displayPath,
        palette: palette,
        iconColor: palette.secondaryText,
        truncationMode: .middle
      )
    }
    .buttonStyle(AgentPanelRowButtonStyle(palette: palette))
    .help("Copy \(path)")
    .accessibilityLabel("Copy working directory")
    .accessibilityValue(path)
  }

  private func valueRow(
    icon: AgentPanelIcon,
    title: String,
    iconColor: Color? = nil
  ) -> some View {
    AgentPanelRowContent(
      icon: icon,
      title: title,
      palette: palette,
      iconColor: iconColor ?? palette.secondaryText
    )
  }

  private func changesRow(addedLineCount: Int, removedLineCount: Int) -> some View {
    HStack(spacing: AgentPanelMetrics.rowContentSpacing) {
      Image(systemName: "plus.forwardslash.minus")
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .frame(width: AgentPanelMetrics.rowIconWidth)
        .accessibilityHidden(true)
      HStack(spacing: 4) {
        Text("+\(addedLineCount, format: .number)")
          .foregroundStyle(palette.success)
        Text("-\(removedLineCount, format: .number)")
          .foregroundStyle(palette.danger)
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
      AgentPanelRowContent(
        icon: icon,
        title: title,
        palette: palette,
        iconColor: iconColor ?? palette.secondaryText
      ) {
        Image(systemName: "arrow.up.right")
          .font(.system(size: 9, weight: .bold))
          .foregroundStyle(palette.secondaryText)
      }
    }
    .buttonStyle(AgentPanelRowButtonStyle(palette: palette))
    .accessibilityLabel(title)
  }

  private func pullRequestChecksRows(_ checks: PaneAgentPullRequestChecks) -> some View {
    VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
      Button {
        checksAreExpanded.toggle()
      } label: {
        pullRequestChecksSummaryRow(checks)
      }
      .buttonStyle(AgentPanelRowButtonStyle(palette: palette))
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
    AgentPanelRowContent(
      leading: {
        PullRequestChecksRingView(checks: checks, palette: palette)
          .frame(width: AgentPanelMetrics.rowIconWidth)
          .accessibilityHidden(true)
      },
      title: checks.title,
      palette: palette,
      trailing: {
        Image(systemName: checksAreExpanded ? "chevron.down" : "chevron.right")
          .font(.system(size: 8, weight: .bold))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 10)
          .accessibilityHidden(true)
      }
    )
  }

  @ViewBuilder
  private func checkRow(_ item: PaneAgentPullRequestCheck) -> some View {
    if let url = item.url {
      Button {
        openURL(url)
      } label: {
        checkRowContent(item, showsLink: true)
      }
      .buttonStyle(AgentPanelRowButtonStyle(palette: palette))
      .accessibilityLabel("\(item.title), \(item.detailText())")
    } else {
      checkRowContent(item, showsLink: false)
    }
  }

  @ViewBuilder
  private func checkRowContent(
    _ item: PaneAgentPullRequestCheck,
    showsLink: Bool
  ) -> some View {
    if showsLink {
      AgentPanelRowContent(
        leading: {
          checkStatusView(item)
        },
        title: "\(item.title) - \(item.detailText())",
        palette: palette,
        titleColor: palette.secondaryText,
        trailing: {
          Image(systemName: "arrow.up.right")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(palette.secondaryText)
            .accessibilityHidden(true)
        }
      )
    } else {
      AgentPanelRowContent(
        leading: {
          checkStatusView(item)
        },
        title: "\(item.title) - \(item.detailText())",
        palette: palette,
        titleColor: palette.secondaryText
      )
    }
  }

  private func checkStatusView(_ item: PaneAgentPullRequestCheck) -> some View {
    Circle()
      .fill(checkColor(item.status))
      .frame(width: 6, height: 6)
      .frame(width: AgentPanelMetrics.rowIconWidth)
      .accessibilityHidden(true)
  }

  private func pullRequestIcon(_ status: PaneAgentPullRequestStatus) -> AgentPanelIcon {
    switch status.kind {
    case .unavailable:
      return .system("exclamationmark.circle")
    case .none:
      if status.url != nil {
        return .asset("github")
      }
      return .system("plus.circle")
    case .open, .draft, .merged:
      return .asset("git-pull-request-arrow")
    }
  }

  private func pullRequestColor(_ kind: PaneAgentPullRequestStatus.Kind) -> Color {
    switch kind {
    case .unavailable:
      return palette.warning
    case .none:
      return palette.secondaryText
    case .open:
      return palette.success
    case .draft:
      return palette.secondaryText
    case .merged:
      return palette.merged
    }
  }

  private func checkColor(_ status: PaneAgentPullRequestCheck.Status) -> Color {
    switch status {
    case .pending:
      return palette.warning
    case .passing:
      return palette.success
    case .failing:
      return palette.danger
    case .skipped:
      return palette.secondaryText
    }
  }

}

private enum AgentPanelIcon {
  case asset(String)
  case system(String)
}

private struct AgentPanelIconView: View {
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

private struct AgentPanelRowContent<Leading: View, Trailing: View>: View {
  let leading: Leading
  let title: String
  let titleColor: Color
  let truncationMode: Text.TruncationMode
  let trailingSpacing: CGFloat?
  let trailing: Trailing

  init(
    @ViewBuilder leading: () -> Leading,
    title: String,
    palette: Palette,
    titleColor: Color? = nil,
    truncationMode: Text.TruncationMode = .tail,
    trailingSpacing: CGFloat? = AgentPanelMetrics.rowTrailingSpacing,
    @ViewBuilder trailing: () -> Trailing
  ) {
    self.leading = leading()
    self.title = title
    self.titleColor = titleColor ?? palette.primaryText
    self.truncationMode = truncationMode
    self.trailingSpacing = trailingSpacing
    self.trailing = trailing()
  }

  init(
    icon: AgentPanelIcon,
    title: String,
    palette: Palette,
    iconColor: Color,
    truncationMode: Text.TruncationMode = .tail,
    @ViewBuilder trailing: () -> Trailing
  ) where Leading == AgentPanelIconView {
    self.init(
      leading: {
        AgentPanelIconView(icon: icon, color: iconColor)
      },
      title: title,
      palette: palette,
      truncationMode: truncationMode,
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
        .truncationMode(truncationMode)
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
    palette: Palette,
    titleColor: Color? = nil,
    truncationMode: Text.TruncationMode = .tail
  ) {
    self.init(
      leading: leading,
      title: title,
      palette: palette,
      titleColor: titleColor,
      truncationMode: truncationMode,
      trailingSpacing: nil,
      trailing: {
        EmptyView()
      }
    )
  }

  init(
    icon: AgentPanelIcon,
    title: String,
    palette: Palette,
    iconColor: Color,
    truncationMode: Text.TruncationMode = .tail
  ) where Leading == AgentPanelIconView {
    self.init(
      leading: {
        AgentPanelIconView(icon: icon, color: iconColor)
      },
      title: title,
      palette: palette,
      truncationMode: truncationMode,
      trailingSpacing: nil,
      trailing: {
        EmptyView()
      }
    )
  }
}

private struct AgentPanelActionRow: View {
  let icon: AgentPanelIcon
  let title: String
  let palette: Palette
  let shortcutHint: String?
  let helpText: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      rowContent
    }
    .buttonStyle(AgentPanelRowButtonStyle(palette: palette))
    .help(helpText)
    .accessibilityLabel(title)
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

private struct AgentPanelRowButtonStyle: ButtonStyle {
  let palette: Palette

  func makeBody(configuration: Configuration) -> some View {
    AgentPanelRowButtonStyleBody(configuration: configuration, palette: palette)
  }
}

private struct AgentPanelRowButtonStyleBody: View {
  let configuration: ButtonStyle.Configuration
  let palette: Palette

  @State private var isHovering = false

  var body: some View {
    configuration.label
      .background {
        RoundedRectangle(cornerRadius: 5)
          .fill(isHovering ? palette.secondaryText.opacity(0.12) : .clear)
          .padding(.vertical, -4)
          .padding(.horizontal, -5)
      }
      .onHover { isHovering = $0 }
  }
}

private struct AgentPanelProgressIcon: View {
  let status: PaneAgentProgressRow.Status
  let kind: PaneAgentProgressRow.Kind
  let palette: Palette

  var body: some View {
    Group {
      switch kind {
      case .goal:
        assetImage("goal", color: status == .completed ? palette.success : palette.secondaryText)
      case .task:
        switch status {
        case .pending:
          image("circle", color: palette.secondaryText)
        case .running:
          TerminalAgentRunningSpinnerView(isSelected: false, palette: palette, diameter: 11)
        case .completed:
          image("checkmark.circle.fill", color: palette.success)
        }
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

  private func assetImage(_ name: String, color: Color) -> some View {
    Image(name)
      .renderingMode(.template)
      .resizable()
      .aspectRatio(contentMode: .fit)
      .frame(width: 13, height: 13)
      .foregroundStyle(color)
      .accessibilityHidden(true)
  }
}

private struct PullRequestChecksRingView: View {
  let checks: PaneAgentPullRequestChecks
  let palette: Palette

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
    addSegment(id: "failing", count: counts[.failing, default: 0], color: palette.danger)
    addSegment(id: "pending", count: counts[.pending, default: 0], color: palette.warning)
    addSegment(id: "skipped", count: counts[.skipped, default: 0], color: palette.secondaryText)
    addSegment(id: "passing", count: counts[.passing, default: 0], color: palette.success)
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
