import SwiftUI

struct AgentPanelView: View {
  let presentation: PaneAgentPanelPresentation
  let palette: TerminalPalette
  let openURL: (URL) -> Void

  var body: some View {
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
              symbol: "arrow.triangle.branch",
              title: branchDetails.branchName
            )
            valueRow(
              symbol: "plus.forwardslash.minus",
              title: "+\(branchDetails.addedLineCount) -\(branchDetails.removedLineCount)"
            )
            valueRow(
              symbol: branchDetails.hasWorkingTreeChanges ? "circle.fill" : "checkmark.circle",
              title: branchDetails.hasWorkingTreeChanges ? "Uncommitted changes" : "Working tree clean"
            )
            pullRequestRow(branchDetails.pullRequestStatus)
          }
        }
      }

      if !presentation.artifacts.isEmpty {
        section("Artifacts") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(presentation.artifacts) { artifact in
              linkRow(symbol: "network", title: artifact.title, url: artifact.url)
            }
          }
        }
      }

      if !presentation.sources.isEmpty {
        section("Sources") {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(presentation.sources) { source in
              valueRow(symbol: sourceSymbol(source), title: source.title)
            }
          }
        }
      }
    }
    .padding(12)
    .frame(width: 306, alignment: .leading)
    .background(
      palette.detailBackground.opacity(0.96),
      in: .rect(cornerRadius: 8)
    )
    .overlay {
      RoundedRectangle(cornerRadius: 8, style: .continuous)
        .strokeBorder(palette.detailStroke, lineWidth: 1)
    }
    .shadow(color: palette.shadow, radius: 18, y: 10)
    .accessibilityElement(children: .contain)
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
      Image(systemName: progressSymbol(row.status))
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(progressColor(row.status))
        .frame(width: 14)
        .accessibilityHidden(true)
      Text(row.title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.primaryText)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func valueRow(symbol: String, title: String) -> some View {
    HStack(spacing: 7) {
      Image(systemName: symbol)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .frame(width: 14)
        .accessibilityHidden(true)
      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.primaryText)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func pullRequestRow(_ status: PaneAgentPullRequestStatus) -> some View {
    if let url = status.url {
      linkRow(symbol: "arrow.up.right.square", title: status.title, url: url)
    } else {
      valueRow(symbol: pullRequestSymbol(status.kind), title: status.title)
    }
  }

  private func linkRow(symbol: String, title: String, url: URL) -> some View {
    Button {
      openURL(url)
    } label: {
      HStack(spacing: 7) {
        Image(systemName: symbol)
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 14)
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

  private func progressSymbol(_ status: PaneAgentProgressRow.Status) -> String {
    switch status {
    case .pending:
      return "circle"
    case .running:
      return "circle.dotted"
    case .completed:
      return "checkmark.circle.fill"
    }
  }

  private func progressColor(_ status: PaneAgentProgressRow.Status) -> Color {
    switch status {
    case .pending:
      return palette.secondaryText
    case .running:
      return Color.accentColor
    case .completed:
      return palette.mint
    }
  }

  private func pullRequestSymbol(_ kind: PaneAgentPullRequestStatus.Kind) -> String {
    switch kind {
    case .unavailable:
      return "exclamationmark.circle"
    case .none:
      return "circle"
    case .open, .draft:
      return "arrow.up.right.circle"
    case .merged:
      return "checkmark.circle.fill"
    case .closed:
      return "xmark.circle"
    }
  }

  private func sourceSymbol(_ source: PaneAgentSource) -> String {
    switch source.kind {
    case .webSearch:
      return "globe"
    }
  }
}
