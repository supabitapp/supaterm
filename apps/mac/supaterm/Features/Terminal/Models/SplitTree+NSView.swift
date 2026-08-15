import AppKit

extension SplitTree where ViewType: NSView {
  func viewBounds() -> CGSize {
    root?.viewBounds() ?? .zero
  }
}

extension SplitTree.Node where ViewType: NSView {
  func viewBounds() -> CGSize {
    switch self {
    case .leaf(let view):
      return view.bounds.size
    case .split(let split):
      let leftBounds = split.left.viewBounds()
      let rightBounds = split.right.viewBounds()
      switch split.direction {
      case .horizontal:
        return CGSize(
          width: leftBounds.width + rightBounds.width,
          height: max(leftBounds.height, rightBounds.height)
        )
      case .vertical:
        return CGSize(
          width: max(leftBounds.width, rightBounds.width),
          height: leftBounds.height + rightBounds.height
        )
      }
    }
  }
}
