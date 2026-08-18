import SupaTheme
import SwiftUI

enum TerminalMetadataIcon: Equatable, Sendable {
  case asset(String)
  case system(String)
}

extension PaneAgentPullRequestStatus {
  var icon: TerminalMetadataIcon {
    switch kind {
    case .unavailable:
      .system("exclamationmark.circle")
    case .none where url != nil:
      .asset("github")
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

  func color(in palette: Palette) -> Color {
    if kind == .open, mergeAutomation == .mergeQueue {
      return palette.queued
    }
    return switch kind {
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

  var stateTitle: String {
    switch kind {
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

  var compactContextTitle: String {
    "\(stateTitle) \(title)"
  }

  var accessibilityTitle: String {
    "\(stateTitle) pull request \(title)"
  }
}
