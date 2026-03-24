import AppKit
import ComposableArchitecture
import Foundation
import SwiftUI

enum TerminalSidebarUpdatePresentation {
  static func usesSelectedRowStyle(
    for phase: UpdatePhase
  ) -> Bool {
    switch phase {
    case .permissionRequest, .updateAvailable, .installing:
      true
    default:
      false
    }
  }
}

struct TerminalSidebarUpdateSection: View {
  let store: StoreOf<UpdateFeature>
  let palette: TerminalPalette

  @State private var isHovering = false
  @State private var resetTask: Task<Void, Never>?

  private var phase: UpdatePhase {
    store.phase
  }

  private var style: TerminalSidebarUpdateStyle {
    .init(
      phase: phase,
      palette: palette
    )
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        TerminalSidebarUpdateIndicator(
          phase: phase,
          palette: palette
        )

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

        if let badgeText = phase.badgeText {
          TerminalSidebarUpdateBadge(
            text: badgeText,
            phase: phase,
            palette: palette
          )
        }
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
    .shadow(
      color: style.usesSelectedRowStyle ? palette.shadow : .clear,
      radius: style.usesSelectedRowStyle ? 2 : 0,
      y: 1.5
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
      HStack(spacing: 8) {
        actionButton("Not Now") {
          _ = store.send(.perform(.declineAutomaticChecks))
        }

        Spacer(minLength: 0)

        actionButton("Allow", tone: .prominent) {
          _ = store.send(.perform(.allowAutomaticChecks))
        }
      }

    case .checking:
      HStack {
        Spacer(minLength: 0)
        actionButton("Cancel") {
          _ = store.send(.perform(.cancel))
        }
      }

    case .updateAvailable(let available):
      let version = available.version.trimmingCharacters(in: .whitespacesAndNewlines)
      VStack(alignment: .leading, spacing: 10) {
        VStack(alignment: .leading, spacing: 6) {
          if phase.badgeText == nil, !version.isEmpty {
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

        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            actionButton("Skip") {
              _ = store.send(.perform(.skipVersion))
            }

            actionButton("Later") {
              _ = store.send(.perform(.dismiss))
            }

            Spacer(minLength: 0)
          }

          actionButton("Install and Relaunch", tone: .prominent) {
            _ = store.send(.perform(.install))
          }
        }
      }

    case .downloading:
      VStack(alignment: .leading, spacing: 10) {
        progressContent
        HStack {
          Spacer(minLength: 0)
          actionButton("Cancel") {
            _ = store.send(.perform(.cancel))
          }
        }
      }

    case .extracting:
      VStack(alignment: .leading, spacing: 10) {
        progressContent
      }

    case .installing:
      VStack(alignment: .leading, spacing: 8) {
        actionButton("Restart Later") {
          _ = store.send(.perform(.restartLater))
        }

        actionButton("Restart Now", tone: .prominent) {
          _ = store.send(.perform(.restartNow))
        }
      }

    case .notFound:
      HStack {
        Spacer(minLength: 0)
        actionButton("OK") {
          _ = store.send(.perform(.dismiss))
        }
      }

    case .error:
      HStack(spacing: 8) {
        actionButton("OK") {
          _ = store.send(.perform(.dismiss))
        }

        Spacer(minLength: 0)

        actionButton("Retry", tone: .prominent) {
          _ = store.send(.perform(.retry))
        }
      }
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
      return palette.rowFill
    }
    return palette.rowFill.opacity(0.84)
  }

  private var progressTint: Color {
    style.progress
  }

  private var summaryDetailText: String {
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

  private func actionButton(
    _ title: String,
    tone: TerminalSidebarUpdateButtonTone = .normal,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      Text(title)
        .font(.system(size: 11, weight: .semibold))
        .foregroundStyle(buttonForeground(tone: tone))
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
  let palette: TerminalPalette

  var usesSelectedRowStyle: Bool {
    TerminalSidebarUpdatePresentation.usesSelectedRowStyle(for: phase)
  }

  var primaryText: Color {
    usesSelectedRowStyle ? palette.selectedText : palette.primaryText
  }

  var secondaryText: Color {
    usesSelectedRowStyle ? palette.selectedText.opacity(0.72) : palette.secondaryText
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
    usesSelectedRowStyle ? primaryText.opacity(0.08) : palette.clearFill
  }

  var warning: Color {
    Color(nsColor: .systemOrange)
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

  var badgeBackground: Color {
    switch phase {
    case .updateAvailable where usesSelectedRowStyle:
      primaryText.opacity(0.12)
    case .notFound:
      success.opacity(0.16)
    case .error:
      warning.opacity(0.16)
    default:
      buttonFill
    }
  }

  var badgeForeground: Color {
    switch phase {
    case .error:
      warning
    default:
      primaryText
    }
  }

  private var success: Color {
    Color(nsColor: .systemGreen)
  }
}

private struct TerminalSidebarUpdateBadge: View {
  let text: String
  let phase: UpdatePhase
  let palette: TerminalPalette

  private var style: TerminalSidebarUpdateStyle {
    .init(
      phase: phase,
      palette: palette
    )
  }

  var body: some View {
    Text(text)
      .font(.system(size: 10, weight: .semibold))
      .foregroundStyle(style.badgeForeground)
      .padding(.horizontal, 7)
      .padding(.vertical, 4)
      .background(style.badgeBackground, in: Capsule(style: .continuous))
  }
}

private struct TerminalSidebarUpdateIndicator: View {
  let phase: UpdatePhase
  let palette: TerminalPalette

  private var style: TerminalSidebarUpdateStyle {
    .init(
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
