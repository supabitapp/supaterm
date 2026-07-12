import SupaTheme
import SwiftUI

struct TerminalSidebarButtonStyle: ButtonStyle {
  enum Layout {
    case rect
    case icon
    case space
  }

  let palette: Palette
  let layout: Layout

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.isEnabled) private var isEnabled
  @Environment(\.controlSize) private var controlSize
  @State private var isHovering = false

  func makeBody(configuration: Configuration) -> some View {
    content(configuration)
      .opacity(isEnabled ? 1 : 0.3)
      .contentShape(.rect)
      .scaleEffect(configuration.isPressed && isEnabled ? 0.95 : 1)
      .terminalAnimation(
        .easeInOut(duration: 0.1),
        value: configuration.isPressed,
        reduceMotion: reduceMotion
      )
      .terminalAnimation(
        .easeInOut(duration: 0.15),
        value: isHovering,
        reduceMotion: reduceMotion
      )
      .onHover { isHovering = $0 }
  }

  @ViewBuilder
  private func content(_ configuration: Configuration) -> some View {
    switch layout {
    case .rect:
      configuration.label
        .background { fill(isPressed: configuration.isPressed) }
    case .icon:
      ZStack {
        fill(isPressed: configuration.isPressed)
        configuration.label
      }
      .frame(width: size, height: size)
    case .space:
      ZStack {
        fill(isPressed: configuration.isPressed)
        configuration.label
      }
      .frame(height: size)
      .frame(maxWidth: size)
    }
  }

  private func fill(isPressed: Bool) -> some View {
    RoundedRectangle(cornerRadius: 8, style: .continuous)
      .fill(background(isPressed: isPressed))
  }

  private var size: CGFloat {
    switch controlSize {
    case .mini: 24
    case .small: 28
    case .regular: 32
    case .large: 40
    case .extraLarge: 48
    @unknown default: 32
    }
  }

  private func background(isPressed: Bool) -> Color {
    if isPressed && isEnabled {
      return palette.sidebarItemPressedFill
    }
    if isHovering && isEnabled {
      return palette.sidebarItemHoverFill
    }
    return .clear
  }
}
