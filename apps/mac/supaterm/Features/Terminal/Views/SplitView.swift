import SwiftUI

struct SplitView<L: View, R: View>: View {
  let direction: Direction
  let dividerColor: Color
  let minimumLeftSize: CGSize
  let minimumRightSize: CGSize
  let resizeIncrements: CGSize
  let left: L
  let right: R
  let onEqualize: () -> Void
  @Binding var split: CGFloat

  var body: some View {
    GeometryReader { geo in
      let leftRect = leftRect(for: geo.size)
      let rightRect = rightRect(for: geo.size, leftRect: leftRect)
      let splitterPoint = splitterPoint(for: geo.size, leftRect: leftRect)

      ZStack(alignment: .topLeading) {
        left
          .frame(width: leftRect.size.width, height: leftRect.size.height)
          .offset(x: leftRect.origin.x, y: leftRect.origin.y)
        right
          .frame(width: rightRect.size.width, height: rightRect.size.height)
          .offset(x: rightRect.origin.x, y: rightRect.origin.y)
        SplitDivider(
          direction: direction,
          hitboxSize: TerminalSplitMetrics.dividerHitboxSize,
          handleThickness: TerminalSplitMetrics.dividerHandleThickness,
          handleLength: TerminalSplitMetrics.dividerHandleLength,
          color: dividerColor
        )
        .position(splitterPoint)
        .gesture(dragGesture(geo.size))
        .onTapGesture(count: 2) {
          onEqualize()
        }
      }
    }
  }

  init(
    _ direction: Direction,
    _ split: Binding<CGFloat>,
    dividerColor: Color,
    minimumLeftSize: CGSize,
    minimumRightSize: CGSize,
    resizeIncrements: CGSize = CGSize(width: 1, height: 1),
    @ViewBuilder left: (() -> L),
    @ViewBuilder right: (() -> R),
    onEqualize: @escaping () -> Void
  ) {
    self.direction = direction
    self._split = split
    self.dividerColor = dividerColor
    self.minimumLeftSize = minimumLeftSize
    self.minimumRightSize = minimumRightSize
    self.resizeIncrements = resizeIncrements
    self.left = left()
    self.right = right()
    self.onEqualize = onEqualize
  }

  private func dragGesture(_ size: CGSize) -> some Gesture {
    DragGesture()
      .onChanged { gesture in
        let (splitDimension, location) =
          switch direction {
          case .horizontal: (size.width, gesture.location.x)
          case .vertical: (size.height, gesture.location.y)
          }
        guard splitDimension > 0 else { return }
        let minimumLeadingSize = direction == .horizontal ? minimumLeftSize.width : minimumLeftSize.height
        let minimumTrailingSize = direction == .horizontal ? minimumRightSize.width : minimumRightSize.height
        let clampedLocation = TerminalSplitLayout.clampedLocation(
          location,
          dimension: splitDimension,
          minimumLeadingSize: minimumLeadingSize,
          minimumTrailingSize: minimumTrailingSize
        )
        split = clampedLocation / splitDimension
      }
  }

  private func leftRect(for size: CGSize) -> CGRect {
    var result = CGRect(x: 0, y: 0, width: size.width, height: size.height)
    switch direction {
    case .horizontal:
      result.size.width *= split
      result.size.width -= result.size.width.truncatingRemainder(dividingBy: resizeIncrements.width)
    case .vertical:
      result.size.height *= split
      result.size.height -= result.size.height.truncatingRemainder(
        dividingBy: resizeIncrements.height)
    }
    return result
  }

  private func rightRect(for size: CGSize, leftRect: CGRect) -> CGRect {
    var result = CGRect(x: 0, y: 0, width: size.width, height: size.height)
    switch direction {
    case .horizontal:
      result.origin.x += leftRect.size.width
      result.size.width -= result.origin.x
    case .vertical:
      result.origin.y += leftRect.size.height
      result.size.height -= result.origin.y
    }
    return result
  }

  private func splitterPoint(for size: CGSize, leftRect: CGRect) -> CGPoint {
    switch direction {
    case .horizontal:
      return CGPoint(x: leftRect.size.width, y: size.height / 2)
    case .vertical:
      return CGPoint(x: size.width / 2, y: leftRect.size.height)
    }
  }

  enum Direction: Codable {
    case horizontal
    case vertical
  }

  private struct SplitDivider: View {
    let direction: Direction
    let hitboxSize: CGFloat
    let handleThickness: CGFloat
    let handleLength: CGFloat
    let color: Color

    @State private var isHovering = false

    var body: some View {
      ZStack {
        Color.clear
          .frame(width: hitboxWidth, height: hitboxHeight)
          .contentShape(.rect)
        RoundedRectangle(cornerRadius: handleThickness / 2, style: .continuous)
          .fill(color)
          .frame(width: handleWidth, height: handleHeight)
          .opacity(isHovering ? 1 : 0)
      }
      .pointerStyle(pointerStyle)
      .onHover { isHovering = $0 }
    }

    private var pointerStyle: PointerStyle {
      switch direction {
      case .horizontal:
        return .columnResize
      case .vertical:
        return .rowResize
      }
    }

    private var handleWidth: CGFloat? {
      switch direction {
      case .horizontal:
        return handleThickness
      case .vertical:
        return handleLength
      }
    }

    private var handleHeight: CGFloat? {
      switch direction {
      case .horizontal:
        return handleLength
      case .vertical:
        return handleThickness
      }
    }

    private var hitboxWidth: CGFloat? {
      switch direction {
      case .horizontal:
        return hitboxSize
      case .vertical:
        return nil
      }
    }

    private var hitboxHeight: CGFloat? {
      switch direction {
      case .horizontal:
        return nil
      case .vertical:
        return hitboxSize
      }
    }
  }
}

nonisolated enum TerminalSplitLayout {
  static func minimumSize<ViewType: NSView & Identifiable>(
    for node: SplitTree<ViewType>.Node
  ) -> CGSize {
    switch node {
    case .leaf:
      return CGSize(
        width: TerminalSplitMetrics.minimumPaneWidth,
        height: TerminalSplitMetrics.minimumPaneHeight
      )
    case .split(let split):
      let left = minimumSize(for: split.left)
      let right = minimumSize(for: split.right)
      switch split.direction {
      case .horizontal:
        return CGSize(width: left.width + right.width, height: max(left.height, right.height))
      case .vertical:
        return CGSize(width: max(left.width, right.width), height: left.height + right.height)
      }
    }
  }

  static func clampedLocation(
    _ location: CGFloat,
    dimension: CGFloat,
    minimumLeadingSize: CGFloat,
    minimumTrailingSize: CGFloat
  ) -> CGFloat {
    guard dimension > 0 else { return 0 }
    let minimumTotal = minimumLeadingSize + minimumTrailingSize
    let scale = minimumTotal > 0 ? min(1, dimension / minimumTotal) : 1
    let lowerBound = minimumLeadingSize * scale
    let upperBound = dimension - minimumTrailingSize * scale
    return min(max(lowerBound, location), upperBound)
  }
}
