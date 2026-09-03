import SwiftUI

public struct KeyboardShortcutPill: View {
  private let shortcut: String
  private let color: Color
  private let textOpacity: Double

  @Environment(\.colorScheme) private var colorScheme

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
      .background(color.opacity(colorScheme == .dark ? 0.24 : 0.12), in: .capsule)
      .fixedSize()
  }
}

extension KeyboardShortcutPill {
  /// Draws the pill without contributing its size along the selected layout axes.
  public func layoutNeutral(
    in axes: Axis.Set = [.horizontal, .vertical],
    alignment: Alignment = .center
  ) -> some View {
    frame(
      width: axes.contains(.horizontal) ? 0 : nil,
      height: axes.contains(.vertical) ? 0 : nil,
      alignment: alignment
    )
  }
}
