import SwiftUI

public struct SelectableRowButtonStyle: ButtonStyle {
  public let palette: Palette
  public let isSelected: Bool
  public let isHovering: Bool
  public let cornerRadius: CGFloat
  public let showsSelectionEdge: Bool
  public let restFill: Color

  public init(
    palette: Palette,
    isSelected: Bool,
    isHovering: Bool,
    cornerRadius: CGFloat,
    showsSelectionEdge: Bool = true,
    restFill: Color = .clear
  ) {
    self.palette = palette
    self.isSelected = isSelected
    self.isHovering = isHovering
    self.cornerRadius = cornerRadius
    self.showsSelectionEdge = showsSelectionEdge
    self.restFill = restFill
  }

  public func makeBody(configuration: Configuration) -> some View {
    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    let hasEdge = isSelected && showsSelectionEdge
    configuration.label
      .background(fill(isPressed: configuration.isPressed))
      .clipShape(shape)
      .overlay(shape.strokeBorder(palette.selectedStroke.opacity(hasEdge ? 1 : 0), lineWidth: 1))
      .shadow(
        color: hasEdge ? palette.selectedShadow : .clear,
        radius: hasEdge ? 5 : 0
      )
      .contentShape(shape)
  }

  private func fill(isPressed: Bool) -> Color {
    if isSelected {
      return palette.selectedFill
    }
    if isPressed {
      return palette.pressedFill
    }
    if isHovering {
      return palette.hoverFill
    }
    return restFill
  }
}
