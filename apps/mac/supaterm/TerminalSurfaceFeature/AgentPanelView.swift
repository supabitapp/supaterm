import SupatermCLIShared
import SupatermTerminalAgentPanelFeature
import SupatermTerminalPresentationFeature
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

struct AgentPanelView: View {
  let presentation: PaneAgentPanelPresentation
  let palette: TerminalPalette
  let forksDown: Bool
  let showsShortcutHints: Bool
  let copyBranchName: (String) -> Void
  let copySessionID: (String) -> Void
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

      if let branchDetails = presentation.branchDetails {
        section("Branch details") {
          VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
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
            copySessionID(session.sessionID)
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
      copyBranchName(branchName)
    } label: {
      valueRow(icon: .asset("git-branch"), title: branchName)
    }
    .buttonStyle(.plain)
    .help("Copy branch name")
    .accessibilityLabel("Copy branch name")
    .accessibilityValue(branchName)
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
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }

  private func pullRequestChecksRows(_ checks: PaneAgentPullRequestChecks) -> some View {
    VStack(alignment: .leading, spacing: AgentPanelMetrics.sectionContentSpacing) {
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
      .buttonStyle(.plain)
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
        return .asset("github-logo")
      }
      return .system("plus.circle")
    case .open, .draft, .merged:
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

}
