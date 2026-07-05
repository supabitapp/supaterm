import SwiftUI

extension View {
  public func blurCard(_ palette: Palette, cornerRadius: CGFloat) -> some View {
    self
      .background(palette.windowBackgroundTint, in: .rect(cornerRadius: cornerRadius))
      .background {
        BlurEffectView(material: .popover, blendingMode: .withinWindow)
          .clipShape(.rect(cornerRadius: cornerRadius))
      }
      .compositingGroup()
      .clipShape(.rect(cornerRadius: cornerRadius))
      .overlay {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
          .stroke(palette.detailStroke, lineWidth: 0.5)
      }
  }
}
