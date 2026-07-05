import SwiftUI

public struct ThemeSwatchPicker: View {
  public let themes: [Theme]
  @Binding public var selection: Theme.ID
  public let palette: Palette

  public init(themes: [Theme] = Theme.curated, selection: Binding<Theme.ID>, palette: Palette) {
    self.themes = themes
    self._selection = selection
    self.palette = palette
  }

  public var body: some View {
    HStack(spacing: 10) {
      ForEach(themes) { theme in
        ThemeSwatchButton(
          theme: theme,
          isSelected: selection == theme.id,
          palette: palette,
          action: { selection = theme.id }
        )
      }
    }
  }
}

private struct ThemeSwatchButton: View {
  let theme: Theme
  let isSelected: Bool
  let palette: Palette
  let action: () -> Void

  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      ZStack {
        Circle()
          .fill(theme.lightPrimary)
        DiagonalHalf()
          .fill(theme.darkPrimary)
          .clipShape(Circle())
      }
      .frame(width: 24, height: 24)
      .overlay {
        Circle()
          .strokeBorder(palette.detailStroke, lineWidth: 1)
      }
      .background {
        Circle()
          .fill(isHovering && !isSelected ? palette.hoverFill : .clear)
          .padding(-4)
      }
      .overlay {
        if isSelected {
          Circle()
            .strokeBorder(palette.selectedText.opacity(0.85), lineWidth: 2)
            .padding(-4)
        }
      }
      .padding(5)
      .contentShape(Circle().inset(by: -4))
    }
    .buttonStyle(.plain)
    .accessibilityLabel(theme.name)
    .onHover { isHovering = $0 }
  }
}

private struct DiagonalHalf: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
    path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.closeSubpath()
    return path
  }
}
