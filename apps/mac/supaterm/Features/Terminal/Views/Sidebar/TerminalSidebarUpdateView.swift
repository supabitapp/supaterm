import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import SupaTheme
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

enum TerminalSidebarUpdatePresentation {
  static func detailText(
    for phase: UpdatePhase,
    preservesSessionsOnRestart: Bool
  ) -> String {
    let detail = baseDetailText(for: phase)
    guard preservesSessionsOnRestart, preservesSessionCopyApplies(to: phase) else {
      return detail
    }
    return "\(detail) Your terminal sessions will keep running after restart."
  }

  static func usesSelectedRowStyle(
    for _: UpdatePhase
  ) -> Bool {
    false
  }

  private static func baseDetailText(for phase: UpdatePhase) -> String {
    switch phase {
    case .installing(let installing):
      if installing.isAutoUpdate {
        return phase.detailMessage
      }
      return "The update is ready. Restart Supaterm to complete installation."
    default:
      return phase.detailMessage
    }
  }

  private static func preservesSessionCopyApplies(to phase: UpdatePhase) -> Bool {
    switch phase {
    case .updateAvailable, .downloading, .extracting, .installing:
      return true
    default:
      return false
    }
  }
}

struct TerminalSidebarUpdateSection: View {
  let store: StoreOf<UpdateFeature>
  let palette: Palette

  @Shared(.supatermSettings) private var supatermSettings = .default
  @State private var isHovering = false
  @State private var resetTask: Task<Void, Never>?

  private var phase: UpdatePhase {
    store.phase
  }

  private var style: TerminalSidebarUpdateStyle {
    TerminalSidebarUpdateStyle(
      phase: phase,
      palette: palette
    )
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        if showsIndicator {
          TerminalSidebarUpdateIndicator(
            phase: phase,
            palette: palette
          )
        }

        VStack(alignment: .leading, spacing: 2) {
          Text(phase.summaryText)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(style.primaryText)
            .lineLimit(1)
            .truncationMode(.tail)

          Text(summaryDetailText)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(style.secondaryText)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }

      content
    }
    .padding(.horizontal, TerminalSidebarLayout.tabRowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight, alignment: .topLeading)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        style: .continuous
      )
      .fill(backgroundColor)
    )
    .overlay(
      RoundedRectangle(
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        style: .continuous
      )
      .strokeBorder(
        palette.selectedStroke.opacity(style.usesSelectedRowStyle ? 1 : 0),
        lineWidth: 1
      )
    )
    .shadow(
      color: style.usesSelectedRowStyle ? palette.selectedShadow : .clear,
      radius: style.usesSelectedRowStyle ? 5 : 0
    )
    .contentShape(
      RoundedRectangle(
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        style: .continuous
      )
    )
    .onHover { isHovering = $0 }
    .onAppear {
      handlePhaseChange(to: phase)
    }
    .onChange(of: phase) { _, newPhase in
      handlePhaseChange(to: newPhase)
    }
    .onDisappear {
      resetTask?.cancel()
    }
  }

  @ViewBuilder
  private var content: some View {
    switch phase {
    case .idle:
      EmptyView()

    case .permissionRequest:
      actionRow

    case .checking:
      EmptyView()

    case .updateAvailable(let available):
      VStack(alignment: .leading, spacing: 10) {
        VStack(alignment: .leading, spacing: 6) {
          if phase.badgeText == nil, let version = available.formattedVersion {
            metadataRow("Version", value: version)
          }

          if let contentLength = available.contentLength {
            metadataRow("Size", value: Self.byteCountString(contentLength))
          }

          if let releaseDate = available.releaseDate {
            metadataRow(
              "Released",
              value: releaseDate.formatted(date: .abbreviated, time: .omitted)
            )
          }
        }

        actionRow
      }

    case .downloading:
      VStack(alignment: .leading, spacing: 10) {
        progressContent
        actionRow
      }

    case .extracting:
      VStack(alignment: .leading, spacing: 10) {
        progressContent
      }

    case .installing(let installing):
      if installing.showsPrompt {
        actionRow
      }

    case .notFound:
      EmptyView()

    case .error:
      actionRow
    }
  }

  @ViewBuilder
  private var progressContent: some View {
    if let progressValue = phase.progressValue {
      VStack(alignment: .leading, spacing: 6) {
        ProgressView(value: progressValue, total: 1)
          .tint(progressTint)
        if let badgeText = phase.badgeText {
          Text(badgeText)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(style.secondaryText)
        }
      }
    } else {
      ProgressView()
        .controlSize(.small)
        .tint(progressTint)
    }
  }

  private var backgroundColor: Color {
    if style.usesSelectedRowStyle {
      return palette.selectedFill
    }
    if isHovering {
      return palette.hoverFill
    }
    return palette.unselectedFill
  }

  private var progressTint: Color {
    style.progress
  }

  private var showsIndicator: Bool {
    if case .installing = phase {
      return false
    }
    return true
  }

  private var summaryDetailText: String {
    TerminalSidebarUpdatePresentation.detailText(
      for: phase,
      preservesSessionsOnRestart: supatermSettings.zmxSessionsEnabled
    )
  }

  private func actionButton(
    _ title: String,
    tone: TerminalSidebarUpdateButtonTone = .normal,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Text(title)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(buttonForeground(tone: tone))
        .lineLimit(1)
        .minimumScaleFactor(0.9)
        .allowsTightening(true)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
          Capsule(style: .continuous)
            .fill(buttonBackground(tone: tone))
        )
        .contentShape(Capsule(style: .continuous))
    }
    .buttonStyle(.plain)
  }

  @ViewBuilder
  private var actionRow: some View {
    let actions = Array(phase.actionPresentations.enumerated())
    if !actions.isEmpty {
      ViewThatFits(in: .horizontal) {
        trailingActionRow {
          actionButtons(actions)
        }

        VStack(alignment: .trailing, spacing: 8) {
          actionButtons(actions)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
      }
    }
  }

  @ViewBuilder
  private func actionButtons(
    _ actions: [(offset: Int, element: UpdateActionPresentation)]
  ) -> some View {
    ForEach(actions, id: \.offset) { indexedAction in
      let action = indexedAction.element
      actionButton(
        action.title,
        tone: action.isProminent ? .prominent : .normal
      ) {
        _ = store.send(.perform(action.action))
      }
    }
  }

  private func trailingActionRow<Content: View>(
    @ViewBuilder content: () -> Content
  ) -> some View {
    HStack(spacing: 8) {
      Spacer(minLength: 0)
      content()
    }
  }

  private func buttonBackground(
    tone: TerminalSidebarUpdateButtonTone
  ) -> Color {
    switch tone {
    case .normal:
      return style.buttonFill
    case .prominent:
      return style.prominentFill
    case .destructive:
      return style.warning.opacity(style.usesSelectedRowStyle ? 0.22 : 0.16)
    }
  }

  private func buttonForeground(
    tone: TerminalSidebarUpdateButtonTone
  ) -> Color {
    switch tone {
    case .normal:
      return style.primaryText
    case .prominent:
      return style.prominentForeground
    case .destructive:
      return style.warning
    }
  }

  private func handlePhaseChange(to newPhase: UpdatePhase) {
    resetTask?.cancel()
    resetTask = nil

    if case .notFound = newPhase {
      resetTask = Task { @MainActor in
        try? await Task.sleep(for: .seconds(5))
        guard !Task.isCancelled else { return }
        _ = store.send(.perform(.dismiss))
      }
    }
  }

  private func metadataRow(
    _ title: String,
    value: String
  ) -> some View {
    HStack(spacing: 6) {
      Text("\(title):")
        .foregroundStyle(style.secondaryText)
        .frame(width: 56, alignment: .trailing)

      Text(value)
        .foregroundStyle(style.primaryText)
        .textSelection(.enabled)
    }
    .font(.system(size: 11, weight: .medium))
  }

  private static func byteCountString(_ value: UInt64) -> String {
    ByteCountFormatter.string(
      fromByteCount: Int64(value),
      countStyle: .file
    )
  }
}

private enum TerminalSidebarUpdateButtonTone {
  case normal
  case prominent
  case destructive
}

private struct TerminalSidebarUpdateStyle {
  let phase: UpdatePhase
  let palette: Palette

  var usesSelectedRowStyle: Bool {
    TerminalSidebarUpdatePresentation.usesSelectedRowStyle(for: phase)
  }

  var primaryText: Color {
    usesSelectedRowStyle ? palette.selectedText : palette.primaryText
  }

  var secondaryText: Color {
    usesSelectedRowStyle ? palette.selectedSecondaryText : palette.secondaryText
  }

  var progress: Color {
    switch phase {
    case .notFound:
      success
    case .error:
      warning
    default:
      primaryText
    }
  }

  var prominentFill: Color {
    usesSelectedRowStyle ? primaryText.opacity(0.12) : palette.selectedFill
  }

  var prominentForeground: Color {
    usesSelectedRowStyle ? primaryText : palette.selectedText
  }

  var buttonFill: Color {
    usesSelectedRowStyle ? primaryText.opacity(0.08) : palette.unselectedFill
  }

  var warning: Color {
    palette.attention
  }

  var indicator: Color {
    switch phase {
    case .notFound:
      success
    case .error:
      warning
    default:
      usesSelectedRowStyle ? primaryText : secondaryText
    }
  }

  private var success: Color {
    palette.success
  }
}

private struct TerminalSidebarUpdateIndicator: View {
  let phase: UpdatePhase
  let palette: Palette

  private var style: TerminalSidebarUpdateStyle {
    TerminalSidebarUpdateStyle(
      phase: phase,
      palette: palette
    )
  }

  var body: some View {
    Group {
      if let progressValue = phase.progressValue {
        TerminalSidebarUpdateProgressRing(
          progress: progressValue,
          tint: style.progress
        )
      } else {
        Image(systemName: phase.iconName)
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(style.indicator)
          .accessibilityHidden(true)
      }
    }
    .frame(width: 18, height: 18)
  }
}

private struct TerminalSidebarUpdateProgressRing: View {
  let progress: Double
  let tint: Color

  var body: some View {
    ZStack {
      Circle()
        .stroke(tint.opacity(0.18), lineWidth: 2)

      Circle()
        .trim(from: 0, to: progress)
        .stroke(
          tint,
          style: StrokeStyle(lineWidth: 2, lineCap: .round)
        )
        .rotationEffect(.degrees(-90))
    }
    .padding(1)
  }
}
