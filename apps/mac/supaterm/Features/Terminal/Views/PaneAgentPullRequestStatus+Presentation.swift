import SupaTheme
import SwiftUI

enum TerminalMetadataIcon: Equatable, Sendable {
  case asset(String)
  case system(String)
}

extension PaneAgentPullRequestStatus {
  var icon: TerminalMetadataIcon {
    if kind == .none, url != nil {
      return .asset("github")
    }
    return kind.icon
  }

  func color(in palette: Palette) -> Color {
    kind.color(in: palette, mergeAutomation: mergeAutomation)
  }
}

extension TerminalTabAgentWorkspace.PullRequest {
  var icon: TerminalMetadataIcon {
    kind.icon
  }

  func color(in palette: Palette) -> Color {
    kind.color(in: palette, mergeAutomation: mergeAutomation)
  }

  var compactContextTitle: String {
    "\(kind.stateTitle) \(title)"
  }

  var accessibilityTitle: String {
    "\(kind.stateTitle) pull request \(title)"
  }
}

extension PaneAgentPullRequestStatus.Kind {
  fileprivate var icon: TerminalMetadataIcon {
    switch self {
    case .unavailable:
      .system("exclamationmark.circle")
    case .none:
      .system("plus.circle")
    case .open:
      .asset("git-pull-request")
    case .draft:
      .asset("git-pull-request-draft")
    case .merged:
      .asset("git-merge")
    case .closed:
      .asset("git-pull-request-closed")
    }
  }

  fileprivate func color(
    in palette: Palette,
    mergeAutomation: PaneAgentPullRequestStatus.MergeAutomation?
  ) -> Color {
    if self == .open, mergeAutomation == .mergeQueue {
      return palette.queued
    }
    return switch self {
    case .unavailable:
      palette.warning
    case .none, .draft:
      palette.secondaryText
    case .open:
      palette.success
    case .merged:
      palette.merged
    case .closed:
      palette.danger
    }
  }

  fileprivate var stateTitle: String {
    switch self {
    case .unavailable:
      "Unavailable"
    case .none:
      "No pull request"
    case .open:
      "Open"
    case .draft:
      "Draft"
    case .merged:
      "Merged"
    case .closed:
      "Closed"
    }
  }
}
