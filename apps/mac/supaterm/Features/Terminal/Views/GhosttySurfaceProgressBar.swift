import GhosttyKit
import SwiftUI

struct GhosttySurfaceProgressBar: View {
  let progressState: ghostty_action_progress_report_state_e
  let progressValue: Int?
  let themeColor: Color

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var position: CGFloat = 0

  var progressColor: Color {
    switch progressState {
    case GHOSTTY_PROGRESS_STATE_ERROR: .red
    case GHOSTTY_PROGRESS_STATE_PAUSE: .orange
    default: themeColor
    }
  }

  var body: some View {
    let progress: Int? =
      progressValue ?? (progressState == GHOSTTY_PROGRESS_STATE_PAUSE ? 100 : nil)
    let accessibilityLabel: String =
      switch progressState {
      case GHOSTTY_PROGRESS_STATE_ERROR: "Terminal progress - Error"
      case GHOSTTY_PROGRESS_STATE_PAUSE: "Terminal progress - Paused"
      case GHOSTTY_PROGRESS_STATE_INDETERMINATE: "Terminal progress - In progress"
      default: "Terminal progress"
      }
    let accessibilityValue: String =
      if let progress {
        "\(progress) percent complete"
      } else {
        switch progressState {
        case GHOSTTY_PROGRESS_STATE_ERROR: "Operation failed"
        case GHOSTTY_PROGRESS_STATE_PAUSE: "Operation paused at completion"
        case GHOSTTY_PROGRESS_STATE_INDETERMINATE: "Operation in progress"
        default: "Indeterminate progress"
        }
      }

    GeometryReader { geometry in
      ZStack(alignment: .leading) {
        if let progress {
          Rectangle()
            .fill(progressColor)
            .frame(
              width: geometry.size.width * CGFloat(progress) / 100,
              height: geometry.size.height
            )
            .terminalAnimation(.easeInOut(duration: 0.2), value: progress, reduceMotion: reduceMotion)
        } else {
          ZStack(alignment: .leading) {
            Rectangle()
              .fill(progressColor.opacity(0.3))
            Rectangle()
              .fill(progressColor)
              .frame(width: geometry.size.width * 0.25, height: geometry.size.height)
              .offset(x: position * (geometry.size.width * 0.75))
          }
          .onAppear {
            startIndeterminateAnimation(reduceMotion: reduceMotion)
          }
          .onDisappear {
            position = 0
          }
          .onChange(of: reduceMotion) { _, reduceMotion in
            restartIndeterminateAnimation(reduceMotion: reduceMotion)
          }
        }
      }
    }
    .frame(height: 2)
    .clipped()
    .allowsHitTesting(false)
    .accessibilityElement(children: .ignore)
    .accessibilityAddTraits(.updatesFrequently)
    .accessibilityLabel(accessibilityLabel)
    .accessibilityValue(accessibilityValue)
  }

  private var indeterminateAnimation: Animation {
    .easeInOut(duration: 1.2)
      .repeatForever(autoreverses: true)
  }

  private func startIndeterminateAnimation(reduceMotion: Bool) {
    guard !reduceMotion else { return }
    TerminalMotion.animate(indeterminateAnimation, reduceMotion: reduceMotion) {
      position = 1
    }
  }

  private func restartIndeterminateAnimation(reduceMotion: Bool) {
    position = 0
    startIndeterminateAnimation(reduceMotion: reduceMotion)
  }
}
