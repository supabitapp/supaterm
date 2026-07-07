import SupaTheme
import SwiftUI

struct TerminalAgentRunningSpinnerView: View {
  let isSelected: Bool
  let palette: Palette
  var diameter: CGFloat = 14

  var body: some View {
    TerminalProgressRingIndicatorView(
      fraction: nil,
      color: color,
      trackColor: trackColor,
      diameter: diameter
    )
  }

  private var color: Color {
    if isSelected {
      return palette.selectedText.opacity(0.56)
    }
    return palette.secondaryText.opacity(0.72)
  }

  private var trackColor: Color {
    if isSelected {
      return palette.selectedText.opacity(0.18)
    }
    return palette.secondaryText.opacity(0.22)
  }
}

struct TerminalProgressRingIndicatorView: View {
  let fraction: Double?
  let color: Color
  let trackColor: Color
  var diameter: CGFloat = 14

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var rotation = Angle.zero

  var body: some View {
    ZStack {
      if let fraction {
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
      } else {
        Circle()
          .stroke(
            AngularGradient(
              gradient: Gradient(colors: [color, color.opacity(0.3)]),
              center: .center,
              startAngle: .degrees(0),
              endAngle: .degrees(360)
            ),
            style: StrokeStyle(lineWidth: 2, lineCap: .round)
          )
          .rotationEffect(rotation)
      }
    }
    .frame(width: diameter, height: diameter)
    .frame(width: 16, height: 16)
    .onAppear {
      startRotation(reduceMotion: reduceMotion)
    }
    .onChange(of: fraction == nil) { _, _ in
      restartRotation(reduceMotion: reduceMotion)
    }
    .onChange(of: reduceMotion) { _, reduceMotion in
      restartRotation(reduceMotion: reduceMotion)
    }
    .accessibilityHidden(true)
  }

  private var rotationAnimation: Animation {
    .linear(duration: 1.6).repeatForever(autoreverses: false)
  }

  private func startRotation(reduceMotion: Bool) {
    guard fraction == nil, !reduceMotion else { return }
    TerminalMotion.animate(rotationAnimation, reduceMotion: reduceMotion) {
      rotation = .degrees(360)
    }
  }

  private func restartRotation(reduceMotion: Bool) {
    rotation = .zero
    startRotation(reduceMotion: reduceMotion)
  }
}
