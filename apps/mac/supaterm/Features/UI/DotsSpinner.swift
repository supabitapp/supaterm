import SwiftUI

public struct DotsSpinner: View {
  private static let frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  private static let interval = Duration.milliseconds(80)

  private let size: CGFloat
  private let color: Color

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var frameIndex = 0

  public init(size: CGFloat = 24, color: Color = .primary) {
    self.size = size
    self.color = color
  }

  public var body: some View {
    Text(Self.frames[frameIndex])
      .font(.system(size: size))
      .foregroundStyle(color)
      .accessibilityLabel("Loading")
      .task(id: reduceMotion) {
        await animate(reduceMotion: reduceMotion)
      }
  }

  private func animate(reduceMotion: Bool) async {
    frameIndex = 0
    guard !reduceMotion else { return }

    while !Task.isCancelled {
      do {
        try await ContinuousClock().sleep(for: Self.interval)
      } catch {
        return
      }
      frameIndex = (frameIndex + 1) % Self.frames.count
    }
  }
}
