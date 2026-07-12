import SupaTheme
import SwiftUI

struct SelectableRowButtonStyle: ButtonStyle {
  enum Appearance {
    case standard(restFill: Color)
    case sidebar
  }

  let palette: Palette
  let isSelected: Bool
  let isHovering: Bool
  let cornerRadius: CGFloat
  let appearance: Appearance
  let showsSelectionEdge: Bool

  init(
    palette: Palette,
    isSelected: Bool,
    isHovering: Bool,
    cornerRadius: CGFloat,
    appearance: Appearance = .standard(restFill: .clear),
    showsSelectionEdge: Bool = true
  ) {
    self.palette = palette
    self.isSelected = isSelected
    self.isHovering = isHovering
    self.cornerRadius = cornerRadius
    self.appearance = appearance
    self.showsSelectionEdge = showsSelectionEdge
  }

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(fill(isPressed: configuration.isPressed))
      .modifier(
        SelectableRowChrome(
          palette: palette,
          isSelected: isSelected,
          cornerRadius: cornerRadius,
          appearance: appearance,
          showsSelectionEdge: showsSelectionEdge
        )
      )
  }

  private func fill(isPressed: Bool) -> Color {
    let fills = fills
    if isSelected {
      return fills.selected
    }
    if isPressed {
      return fills.pressed
    }
    if isHovering {
      return fills.hover
    }
    return fills.rest
  }

  private var fills: Fills {
    switch appearance {
    case .standard(let restFill):
      Fills(
        selected: palette.selectedFill,
        pressed: palette.pressedFill,
        hover: palette.hoverFill,
        rest: restFill
      )
    case .sidebar:
      Fills(
        selected: palette.sidebarSelectedFill,
        pressed: palette.sidebarItemPressedFill,
        hover: palette.sidebarItemHoverFill,
        rest: .clear
      )
    }
  }

  private struct Fills {
    let selected: Color
    let pressed: Color
    let hover: Color
    let rest: Color
  }
}

struct SelectableRowChrome: ViewModifier {
  let palette: Palette
  let isSelected: Bool
  let cornerRadius: CGFloat
  let appearance: SelectableRowButtonStyle.Appearance
  let showsSelectionEdge: Bool

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    let hasEdge = isSelected && showsSelectionEdge
    content
      .compositingGroup()
      .clipShape(shape)
      .overlay { selectionEdge(shape: shape, isVisible: hasEdge) }
      .shadow(
        color: hasEdge ? palette.selectedShadow : .clear,
        radius: hasEdge ? 4 : 0,
        y: hasEdge ? 1 : 0
      )
      .contentShape(shape)
  }

  @ViewBuilder
  private func selectionEdge(shape: RoundedRectangle, isVisible: Bool) -> some View {
    if isVisible {
      switch appearance {
      case .standard:
        shape.strokeBorder(palette.selectedStroke, lineWidth: 1)
      case .sidebar:
        shape.strokeBorder(palette.sidebarSelectedStroke, lineWidth: 1)
      }
    }
  }
}
