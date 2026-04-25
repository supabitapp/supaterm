import Foundation
import SupatermCLIShared

nonisolated enum TerminalBarPresenter {
  static func presentation(
    settings: SupatermBottomBarSettings,
    context: TerminalBarContext?,
    gitState: TerminalBarGitState?,
    now: Date
  ) -> TerminalBarPresentation {
    guard settings.enabled, let context else {
      return .empty
    }
    return TerminalBarPresentation(
      left: segments(for: settings.left, context: context, gitState: gitState, now: now),
      center: segments(for: settings.center, context: context, gitState: gitState, now: now),
      right: segments(for: settings.right, context: context, gitState: gitState, now: now)
    )
  }

  private static func segments(
    for modules: [SupatermBottomBarModule],
    context: TerminalBarContext,
    gitState: TerminalBarGitState?,
    now: Date
  ) -> [TerminalBarSegment] {
    modules.compactMap { module in
      segment(for: module, context: context, gitState: gitState, now: now)
    }
  }

  private static func segment(
    for module: SupatermBottomBarModule,
    context: TerminalBarContext,
    gitState: TerminalBarGitState?,
    now: Date
  ) -> TerminalBarSegment? {
    switch module {
    case .directory:
      return directorySegment(context)
    case .gitBranch:
      return gitBranchSegment(gitState)
    case .gitStatus:
      return gitStatusSegment(gitState)
    case .paneTitle:
      return paneTitleSegment(context)
    case .agent:
      return agentSegment(context)
    case .exitStatus:
      return exitStatusSegment(context)
    case .commandDuration:
      return commandDurationSegment(context)
    case .time:
      return timeSegment(now)
    }
  }

  private static func directorySegment(_ context: TerminalBarContext) -> TerminalBarSegment? {
    guard let path = normalized(context.workingDirectoryPath) else {
      return nil
    }
    let url = URL(fileURLWithPath: path, isDirectory: true)
    let name = normalized(url.lastPathComponent) ?? path
    return TerminalBarSegment(
      id: "directory",
      text: name,
      tooltip: path,
      tone: .normal
    )
  }

  private static func gitBranchSegment(_ state: TerminalBarGitState?) -> TerminalBarSegment? {
    guard let state else { return nil }
    return TerminalBarSegment(
      id: "git_branch",
      text: state.branch,
      tone: .accent
    )
  }

  private static func gitStatusSegment(_ state: TerminalBarGitState?) -> TerminalBarSegment? {
    guard let state, state.hasStatus else { return nil }
    var parts: [String] = []
    if state.conflictCount > 0 {
      parts.append("!\(state.conflictCount)")
    }
    if state.stagedCount > 0 {
      parts.append("+\(state.stagedCount)")
    }
    if state.unstagedCount > 0 {
      parts.append("~\(state.unstagedCount)")
    }
    if state.untrackedCount > 0 {
      parts.append("?\(state.untrackedCount)")
    }
    if state.aheadCount > 0 {
      parts.append("ahead \(state.aheadCount)")
    }
    if state.behindCount > 0 {
      parts.append("behind \(state.behindCount)")
    }
    return TerminalBarSegment(
      id: "git_status",
      text: parts.joined(separator: " "),
      tone: state.conflictCount > 0 ? .error : .warning
    )
  }

  private static func paneTitleSegment(_ context: TerminalBarContext) -> TerminalBarSegment? {
    guard let title = normalized(context.paneTitle) else { return nil }
    return TerminalBarSegment(id: "pane_title", text: title, tone: .muted)
  }

  private static func agentSegment(_ context: TerminalBarContext) -> TerminalBarSegment? {
    guard let activity = context.agentActivity else { return nil }
    let status =
      switch activity.phase {
      case .needsInput:
        "needs input"
      case .running:
        "running"
      case .idle:
        "idle"
      }
    var text = status
    if let detail = normalized(activity.detail) {
      text += ": \(detail)"
    }
    let tooltip = "\(activity.kindTitle) \(text)"
    let tone: TerminalBarSegmentTone =
      switch activity.tone {
      case .attention:
        .warning
      case .active:
        .accent
      case .muted:
        .muted
      }
    return TerminalBarSegment(id: "agent", symbol: "hammer", text: text, tooltip: tooltip, tone: tone)
  }

  private static func exitStatusSegment(_ context: TerminalBarContext) -> TerminalBarSegment? {
    guard let code = context.commandExitCode, code != 0 else { return nil }
    return TerminalBarSegment(
      id: "exit_status",
      text: "exit \(code)",
      tone: .error
    )
  }

  private static func commandDurationSegment(_ context: TerminalBarContext) -> TerminalBarSegment? {
    guard let duration = context.commandDuration else { return nil }
    return TerminalBarSegment(
      id: "command_duration",
      text: formattedDuration(duration),
      tone: .muted
    )
  }

  private static func timeSegment(_ now: Date) -> TerminalBarSegment {
    let components = Calendar.current.dateComponents([.hour, .minute], from: now)
    let hour = components.hour ?? 0
    let minute = components.minute ?? 0
    return TerminalBarSegment(
      id: "time",
      text: String(format: "%02d:%02d", hour, minute),
      tone: .muted
    )
  }

  private static func formattedDuration(_ milliseconds: UInt64) -> String {
    if milliseconds < 1_000 {
      return "\(milliseconds)ms"
    }
    let seconds = Double(milliseconds) / 1_000
    if seconds < 10 {
      return String(format: "%.1fs", seconds)
    }
    return "\(Int(seconds.rounded()))s"
  }

  private static func normalized(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
  }
}
