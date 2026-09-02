import SupaTheme
import SwiftUI

struct TerminalSidebarButtonStyle: ButtonStyle {
  enum Layout {
    case rect
    case icon
  }

  let palette: Palette
  let layout: Layout
  var emphasizesForegroundOnHover = false

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
      label(configuration)
        .background { fill(isPressed: configuration.isPressed) }
    case .icon:
      ZStack {
        fill(isPressed: configuration.isPressed)
        label(configuration)
      }
      .frame(width: size, height: size)
    }
  }

  @ViewBuilder
  private func label(_ configuration: Configuration) -> some View {
    if emphasizesForegroundOnHover {
      configuration.label
        .foregroundStyle(isHovering ? palette.primaryText : palette.secondaryText)
    } else {
      configuration.label
    }
  }

  private func fill(isPressed: Bool) -> some View {
    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
      .fill(background(isPressed: isPressed))
  }

  private var cornerRadius: CGFloat {
    switch layout {
    case .rect: TerminalSidebarLayout.tabRowCornerRadius
    case .icon: 8
    }
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
      return palette.sidebarControlPressedFill
    }
    if isHovering && isEnabled {
      return palette.sidebarControlHoverFill
    }
    return .clear
  }
}
