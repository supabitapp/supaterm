import SwiftUI

struct TerminalSplitDropOverlay: View {
  let zone: TerminalSplitDropZone
  let color: Color

  var body: some View {
    GeometryReader { geometry in
      let frame = frame(in: geometry.size)
      Rectangle()
        .fill(color.opacity(0.3))
        .frame(width: frame.width, height: frame.height)
        .offset(x: frame.minX, y: frame.minY)
    }
    .accessibilityHidden(true)
  }

  private func frame(in size: CGSize) -> CGRect {
    switch zone {
    case .top:
      CGRect(x: 0, y: 0, width: size.width, height: size.height / 2)
    case .bottom:
      CGRect(x: 0, y: size.height / 2, width: size.width, height: size.height / 2)
    case .left:
      CGRect(x: 0, y: 0, width: size.width / 2, height: size.height)
    case .right:
      CGRect(x: size.width / 2, y: 0, width: size.width / 2, height: size.height)
    }
  }
}
