import SwiftUI

struct TerminalProgressRingIndicatorView: View {
  let fraction: Double
  let color: Color
  let trackColor: Color

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack {
      Circle()
        .stroke(trackColor, lineWidth: 2)

      Circle()
        .trim(from: 0, to: fraction)
        .stroke(
          color,
          style: StrokeStyle(lineWidth: 2, lineCap: .round)
        )
        .rotationEffect(.degrees(-90))
        .terminalAnimation(
          .easeInOut(duration: 0.2),
          value: fraction,
          reduceMotion: reduceMotion
        )
    }
    .frame(width: 14, height: 14)
    .frame(width: 16, height: 16)
    .accessibilityHidden(true)
  }
}
