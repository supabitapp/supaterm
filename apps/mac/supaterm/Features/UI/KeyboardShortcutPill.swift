import SwiftUI

public struct KeyboardShortcutPill: View {
  private let shortcut: String
  private let color: Color
  private let textOpacity: Double

  public init(
    _ shortcut: String,
    color: Color = .secondary,
    textOpacity: Double = 1
  ) {
    self.shortcut = shortcut
    self.color = color
    self.textOpacity = textOpacity
  }

  public var body: some View {
    Text(shortcut)
      .font(.system(size: 11, weight: .semibold))
      .monospacedDigit()
      .lineLimit(1)
      .padding(.horizontal, 7)
      .frame(minHeight: 20)
      .foregroundStyle(color.opacity(textOpacity))
      .background(color.opacity(0.12), in: .capsule)
      .fixedSize()
  }
}
