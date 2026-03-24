import AppKit
import ComposableArchitecture
import Foundation
import SwiftUI

enum TerminalSidebarUpdatePresentation {
  static func shouldAutoExpand(
    from oldPhase: UpdatePhase,
    to newPhase: UpdatePhase
  ) -> Bool {
    guard !newPhase.isIdle else { return false }
    if case .error = newPhase {
      return true
    }
    return oldPhase.isIdle
  }
}

struct TerminalSidebarUpdateSection: View {
  let store: StoreOf<UpdateFeature>
  let palette: TerminalPalette

  @State private var isExpanded = false
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
    VStack(spacing: 0) {
      Button(action: toggleExpansion) {
        HStack(spacing: 8) {
          TerminalSidebarUpdateIndicator(
            phase: phase,
            palette: palette
          )

          Text(phase.summaryText)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(palette.primaryText)
            .lineLimit(1)
            .truncationMode(.tail)

          Spacer(minLength: 0)

          if let badgeText = phase.badgeText {
            TerminalSidebarUpdateBadge(
              text: badgeText,
              phase: phase,
              palette: palette
            )
          }

          Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(palette.secondaryText)
            .accessibilityHidden(true)
        }
        .padding(.horizontal, TerminalSidebarLayout.tabRowHorizontalPadding)
        .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
        .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
        .frame(maxWidth: .infinity)
        .contentShape(
          RoundedRectangle(
            cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
            style: .continuous
          )
        )
      }
      .buttonStyle(.plain)

      if isExpanded {
        Rectangle()
          .fill(borderColor)
          .frame(height: 1)
          .padding(.horizontal, 10)

        expandedContent
          .padding(.horizontal, 12)
          .padding(.vertical, 12)
      }
    }
    .background(
      RoundedRectangle(
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        style: .continuous
      )
      .fill(backgroundColor)
    )
    .overlay {
      RoundedRectangle(
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        style: .continuous
      )
      .stroke(borderColor, lineWidth: 1)
    }
    .shadow(
      color: isExpanded ? palette.shadow.opacity(0.35) : .clear,
      radius: isExpanded ? 5 : 0,
      y: 1.5
    )
    .onHover { isHovering = $0 }
    .onAppear {
      handlePhaseChange(from: .idle, to: phase)
    }
    .onChange(of: phase) { oldPhase, newPhase in
      handlePhaseChange(from: oldPhase, to: newPhase)
    }
    .onDisappear {
      resetTask?.cancel()
    }
  }

  @ViewBuilder
  private var expandedContent: some View {
    switch phase {
    case .idle:
      EmptyView()

    case .permissionRequest:
      VStack(alignment: .leading, spacing: 12) {
        detailText(phase.detailMessage)
        HStack(spacing: 8) {
          actionButton("Not Now") {
            _ = store.send(.perform(.declineAutomaticChecks))
          }

          Spacer(minLength: 0)

          actionButton("Allow", tone: .prominent) {
            _ = store.send(.perform(.allowAutomaticChecks))
          }
        }
      }

    case .checking:
      VStack(alignment: .leading, spacing: 12) {
        detailText(phase.detailMessage)
        HStack {
          Spacer(minLength: 0)
          actionButton("Cancel") {
            _ = store.send(.perform(.cancel))
          }
        }
      }

    case .updateAvailable(let available):
      VStack(alignment: .leading, spacing: 12) {
        detailText(phase.detailMessage)
        VStack(alignment: .leading, spacing: 6) {
          metadataRow("Version", value: available.version)

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
      VStack(alignment: .leading, spacing: 12) {
        detailText(phase.detailMessage)
        progressContent
        HStack {
          Spacer(minLength: 0)
          actionButton("Cancel") {
            _ = store.send(.perform(.cancel))
          }
        }
      }

    case .extracting:
      VStack(alignment: .leading, spacing: 12) {
        detailText(phase.detailMessage)
        progressContent
      }

    case .installing(let installing):
      VStack(alignment: .leading, spacing: 12) {
        detailText(
          installing.isAutoUpdate
            ? phase.detailMessage
            : "The update is ready. Restart Supaterm to complete installation.")
        VStack(alignment: .leading, spacing: 8) {
          actionButton("Restart Later") {
            _ = store.send(.perform(.restartLater))
          }

          actionButton("Restart Now", tone: .prominent) {
            _ = store.send(.perform(.restartNow))
          }
        }
      }

    case .notFound:
      VStack(alignment: .leading, spacing: 12) {
        detailText(phase.detailMessage)
        HStack {
          Spacer(minLength: 0)
          actionButton("OK") {
            _ = store.send(.perform(.dismiss))
          }
        }
      }

    case .error(let failure):
      VStack(alignment: .leading, spacing: 12) {
        detailText(failure.message)
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
            .foregroundStyle(palette.secondaryText)
        }
      }
    } else {
      ProgressView()
        .controlSize(.small)
        .tint(progressTint)
    }
  }

  private var backgroundColor: Color {
    if isExpanded {
      return palette.pillFill
    }
    if isHovering {
      return palette.pillFill.opacity(0.94)
    }
    return palette.pillFill.opacity(0.82)
  }

  private var borderColor: Color {
    style.border
  }

  private var progressTint: Color {
    style.progress
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
      return palette.clearFill
    case .prominent:
      return style.prominentFill
    case .destructive:
      return style.warning.opacity(0.16)
    }
  }

  private func buttonForeground(
    tone: TerminalSidebarUpdateButtonTone
  ) -> Color {
    switch tone {
    case .normal:
      return palette.primaryText
    case .prominent:
      return style.prominentForeground
    case .destructive:
      return style.warning
    }
  }

  private func detailText(_ text: String) -> some View {
    Text(text)
      .font(.system(size: 11, weight: .medium))
      .foregroundStyle(palette.secondaryText)
      .fixedSize(horizontal: false, vertical: true)
  }

  private func handlePhaseChange(
    from oldPhase: UpdatePhase,
    to newPhase: UpdatePhase
  ) {
    resetTask?.cancel()
    resetTask = nil

    if newPhase.isIdle {
      isExpanded = false
      return
    }

    if TerminalSidebarUpdatePresentation.shouldAutoExpand(
      from: oldPhase,
      to: newPhase
    ) {
      withAnimation(.spring(response: 0.24, dampingFraction: 0.86)) {
        isExpanded = true
      }
    }

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
        .foregroundStyle(palette.secondaryText)
        .frame(width: 56, alignment: .trailing)

      Text(value)
        .foregroundStyle(palette.primaryText)
        .textSelection(.enabled)
    }
    .font(.system(size: 11, weight: .medium))
  }

  private func toggleExpansion() {
    withAnimation(.spring(response: 0.24, dampingFraction: 0.86)) {
      isExpanded.toggle()
    }
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

  var border: Color {
    switch phase {
    case .notFound:
      success.opacity(0.28)
    case .error:
      warning.opacity(0.3)
    default:
      separator
    }
  }

  var progress: Color {
    switch phase {
    case .updateAvailable, .installing:
      prominentFill
    case .notFound:
      success
    case .error:
      warning
    default:
      palette.primaryText
    }
  }

  var prominentFill: Color {
    palette.selectedFill
  }

  var prominentForeground: Color {
    palette.selectedText
  }

  var warning: Color {
    Color(nsColor: .systemOrange)
  }

  var indicator: Color {
    switch phase {
    case .updateAvailable, .installing:
      prominentFill
    case .notFound:
      success
    case .error:
      warning
    default:
      palette.secondaryText
    }
  }

  var badgeBackground: Color {
    switch phase {
    case .updateAvailable:
      prominentFill
    case .notFound:
      success.opacity(0.16)
    case .error:
      warning.opacity(0.16)
    default:
      palette.clearFill
    }
  }

  var badgeForeground: Color {
    switch phase {
    case .updateAvailable:
      prominentForeground
    case .error:
      warning
    default:
      palette.primaryText
    }
  }

  private var separator: Color {
    Color(nsColor: .separatorColor)
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
