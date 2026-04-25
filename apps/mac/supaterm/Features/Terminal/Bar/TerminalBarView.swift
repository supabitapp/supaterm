import Sharing
import SupatermCLIShared
import SwiftUI

struct TerminalBarView: View {
  @Shared(.supatermSettings) private var supatermSettings = .default
  let palette: TerminalPalette
  let terminal: TerminalHostState

  @State private var previousRefreshKey: TerminalBarRefreshKey?
  @State private var timeTick = 0

  private var settings: SupatermBottomBarSettings {
    supatermSettings.bottomBarSettings
  }

  private var refreshKey: TerminalBarRefreshKey {
    TerminalBarRefreshKey(
      settings: settings,
      contextID: terminal.selectedBarContext?.refreshID,
      timeTick: timeTick
    )
  }

  private var presentation: TerminalBarPresentation {
    terminal.terminalBarRuntime.presentation
  }

  var body: some View {
    HStack(spacing: 8) {
      segmentGroup(presentation.left)
        .frame(maxWidth: .infinity, alignment: .leading)
      segmentGroup(presentation.center)
        .frame(maxWidth: .infinity, alignment: .center)
      segmentGroup(presentation.right)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
    .padding(.horizontal, 10)
    .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
    .background(terminal.terminalBackgroundColor)
    .overlay(alignment: .top) {
      if !presentation.isEmpty {
        Rectangle()
          .fill(palette.detailStroke)
          .frame(height: 1)
      }
    }
    .clipped()
    .opacity(presentation.isEmpty ? 0 : 1)
    .task(id: refreshKey) {
      let reason = refreshKey.reason(comparedTo: previousRefreshKey)
      previousRefreshKey = refreshKey
      terminal.terminalBarRuntime.refresh(
        settings: settings,
        context: terminal.selectedBarContext,
        reason: reason
      )
    }
    .task(id: settings.containsTimeModule) {
      guard settings.containsTimeModule else { return }
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        guard !Task.isCancelled else { return }
        timeTick += 1
      }
    }
  }

  private var height: CGFloat {
    presentation.isEmpty ? 0 : 28
  }

  private func segmentGroup(_ segments: [TerminalBarSegment]) -> some View {
    HStack(spacing: 10) {
      ForEach(segments) { segment in
        segmentView(segment)
      }
    }
    .lineLimit(1)
  }

  private func segmentView(_ segment: TerminalBarSegment) -> some View {
    HStack(spacing: 4) {
      if let symbol = segment.symbol {
        Image(systemName: symbol)
          .font(.system(size: 11, weight: .semibold))
          .accessibilityHidden(true)
        Text("-")
      }
      Text(segment.text)
        .truncationMode(.middle)
    }
    .font(.system(size: 12, weight: .medium))
    .foregroundStyle(color(for: segment.tone))
    .lineLimit(1)
    .help(segment.tooltip ?? segment.text)
  }

  private func color(for tone: TerminalBarSegmentTone) -> Color {
    switch tone {
    case .normal:
      palette.primaryText
    case .muted:
      palette.secondaryText
    case .success:
      palette.mint
    case .warning:
      palette.amber
    case .error:
      palette.coral
    case .accent:
      palette.sky
    }
  }
}

private struct TerminalBarRefreshKey: Equatable {
  let settings: SupatermBottomBarSettings
  let contextID: TerminalBarContextRefreshID?
  let timeTick: Int

  func reason(comparedTo previous: Self?) -> TerminalBarRefreshReason {
    guard let previous else { return .settings }
    if settings != previous.settings {
      return .settings
    }
    guard let contextID, let previousContextID = previous.contextID else {
      return .focus
    }
    if contextID.focusedPaneID != previousContextID.focusedPaneID {
      return .focus
    }
    if contextID.workingDirectoryPath != previousContextID.workingDirectoryPath {
      return .workingDirectory
    }
    if contextID.commandExitCode != previousContextID.commandExitCode
      || contextID.commandDuration != previousContextID.commandDuration
    {
      return .commandFinished
    }
    if contextID.agentID != previousContextID.agentID {
      return .agent
    }
    if contextID.paneTitle != previousContextID.paneTitle {
      return .title
    }
    if timeTick != previous.timeTick {
      return .time
    }
    return .settings
  }
}
