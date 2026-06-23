import AppKit

public struct SplitTree<ViewType: NSView & Identifiable> {
  public let root: Node?
  public let zoomed: Node?

  public struct Split: Equatable {
    public let direction: Direction
    public let ratio: Double
    public let left: Node
    public let right: Node

    public init(direction: Direction, ratio: Double, left: Node, right: Node) {
      self.direction = direction
      self.ratio = ratio
      self.left = left
      self.right = right
    }

    public static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.direction == rhs.direction
        && lhs.ratio == rhs.ratio
        && lhs.left == rhs.left
        && lhs.right == rhs.right
    }
  }

  public indirect enum Node: Equatable {
    case leaf(view: ViewType)
    case split(Split)
  }

  public enum Direction: Equatable {
    case horizontal
    case vertical
  }

  public enum PathComponent: Equatable {
    case left
    case right
  }

  public struct Path: Equatable {
    public let path: [PathComponent]

    public var isEmpty: Bool { path.isEmpty }

    public init(path: [PathComponent]) {
      self.path = path
    }
  }

  public struct SpatialSlot {
    public let node: Node
    public let bounds: CGRect
  }

  public enum SpatialDirection {
    case left
    case right
    case up
    case down
  }

  public struct Spatial {
    public let slots: [SpatialSlot]
  }

  public enum SplitError: Error {
    case viewNotFound
  }

  public enum NewDirection {
    case left
    case right
    case down
    case up
  }

  public enum FocusDirection {
    case previous
    case next
    case spatial(SpatialDirection)
  }

  public enum SizeUnit {
    case cells
    case percent
  }

  public var isEmpty: Bool {
    root == nil
  }

  public var isSplit: Bool {
    if case .split = root { true } else { false }
  }

  public init() {
    self.init(root: nil, zoomed: nil)
  }

  public init(view: ViewType) {
    self.init(root: .leaf(view: view), zoomed: nil)
  }

  public func find(id: ViewType.ID) -> Node? {
    root?.find(id: id)
  }

  public func inserting(view: ViewType, at anchor: ViewType, direction: NewDirection) throws -> Self {
    guard let root else { throw SplitError.viewNotFound }
    return Self(
      root: try root.inserting(view: view, at: anchor, direction: direction),
      zoomed: nil
    )
  }

  public func removing(_ target: Node) -> Self {
    guard let root else { return self }
    if root == target {
      return Self(root: nil, zoomed: nil)
    }
    let newRoot = root.remove(target)
    let newZoomed = (zoomed == target) ? nil : zoomed
    return Self(root: newRoot, zoomed: newZoomed)
  }

  public func replacing(node: Node, with newNode: Node) throws -> Self {
    guard let root else { throw SplitError.viewNotFound }
    guard let path = root.path(to: node) else { throw SplitError.viewNotFound }
    let newRoot = try root.replacingNode(at: path, with: newNode)
    let newZoomed = (zoomed == node) ? newNode : zoomed
    return Self(root: newRoot, zoomed: newZoomed)
  }

  public func focusTarget(for direction: FocusDirection, from currentNode: Node) -> ViewType? {
    guard let root else { return nil }

    switch direction {
    case .previous:
      let allLeaves = root.leaves()
      let currentView = currentNode.leftmostLeaf()
      guard let currentIndex = allLeaves.firstIndex(where: { $0 === currentView }) else {
        return nil
      }
      let index = allLeaves.indexWrapping(before: currentIndex)
      return allLeaves[index]

    case .next:
      let allLeaves = root.leaves()
      let currentView = currentNode.rightmostLeaf()
      guard let currentIndex = allLeaves.firstIndex(where: { $0 === currentView }) else {
        return nil
      }
      let index = allLeaves.indexWrapping(after: currentIndex)
      return allLeaves[index]

    case .spatial(let spatialDirection):
      let spatial = root.spatial()
      let nodes = spatial.slots(in: spatialDirection, from: currentNode)
      if nodes.isEmpty { return nil }
      let bestNode =
        nodes.first(where: {
          if case .leaf = $0.node { return true }
          return false
        }) ?? nodes[0]
      switch bestNode.node {
      case .leaf(let view):
        return view

      case .split:
        return switch spatialDirection {
        case .up, .left: bestNode.node.leftmostLeaf()
        case .down, .right: bestNode.node.rightmostLeaf()
        }
      }
    }
  }

  public func focusTargetAfterClosing(_ node: Node) -> ViewType? {
    guard let root else { return nil }

    // Match Ghostty's macOS controller: closing the leftmost leaf moves to the next
    // surface, otherwise we move to the previous one.
    if root.leftmostLeaf() === node.leftmostLeaf() {
      return focusTarget(for: .next, from: node)
    }
    return focusTarget(for: .previous, from: node)
  }

  public func equalized() -> Self {
    guard let root else { return self }
    let newRoot = root.equalize()
    return Self(root: newRoot, zoomed: zoomed)
  }

  public func tiled() -> Self {
    guard let root else { return self }
    let leaves = root.leaves()
    guard !leaves.isEmpty else { return self }
    let rowCount = min(
      leaves.count,
      max(1, Int(Double(leaves.count).squareRoot().rounded()))
    )
    let rowSizes = bucketSizes(total: leaves.count, bucketCount: rowCount)
    var offset = 0
    let rowNodes = rowSizes.map { rowSize in
      defer { offset += rowSize }
      let rowViews = Array(leaves[offset..<(offset + rowSize)])
      return Node.arranged(rowViews.map(Self.leafNode), direction: .horizontal)
    }
    return Self(root: Node.arranged(rowNodes, direction: .vertical), zoomed: nil)
  }

  public func mainVertical() -> Self {
    guard let root else { return self }
    let leaves = root.leaves()
    guard leaves.count > 1 else { return self }
    let leader = Self.leafNode(leaves[0])
    let teammateNodes = Array(leaves.dropFirst()).map(Self.leafNode)
    let teammates = Node.arranged(teammateNodes, direction: .vertical)
    return Self(
      root: .split(
        Split(
          direction: .horizontal,
          ratio: 0.5,
          left: leader,
          right: teammates
        )),
      zoomed: nil
    )
  }

  public func settingZoomed(_ node: Node?) -> Self {
    Self(root: root, zoomed: node)
  }

  public func resizing(
    node: Node,
    by pixels: UInt16,
    in direction: SpatialDirection,
    with bounds: CGRect
  ) throws -> Self {
    let targetSplitDirection: Direction =
      switch direction {
      case .up, .down: .vertical
      case .left, .right: .horizontal
      }
    guard let root else { throw SplitError.viewNotFound }
    let splitLocation = try nearestSplit(for: node, along: targetSplitDirection)
    let splitPath = splitLocation.splitPath
    let splitNode = splitLocation.splitNode
    guard case .split(let split) = splitNode else { throw SplitError.viewNotFound }

    let spatial = root.spatial(within: bounds.size)
    guard let splitSlot = spatial.slots.first(where: { $0.node == splitNode }) else {
      throw SplitError.viewNotFound
    }

    let pixelOffset = Double(pixels)
    let width = max(splitSlot.bounds.width, 1)
    let height = max(splitSlot.bounds.height, 1)
    let newRatio: Double

    switch (split.direction, direction) {
    case (.horizontal, .left):
      newRatio = split.ratio - (pixelOffset / width)
    case (.horizontal, .right):
      newRatio = split.ratio + (pixelOffset / width)
    case (.vertical, .up):
      newRatio = split.ratio - (pixelOffset / height)
    case (.vertical, .down):
      newRatio = split.ratio + (pixelOffset / height)
    default:
      throw SplitError.viewNotFound
    }

    let clamped = max(0.1, min(0.9, newRatio))
    let newSplit = Split(
      direction: split.direction,
      ratio: clamped,
      left: split.left,
      right: split.right
    )

    let newRoot = try root.replacingNode(at: splitPath, with: .split(newSplit))
    return Self(root: newRoot, zoomed: nil)
  }

  public func sizing(
    node: Node,
    to amount: Double,
    along axis: Direction,
    unit: SizeUnit,
    with bounds: CGRect
  ) throws -> Self {
    guard let root else { throw SplitError.viewNotFound }
    let splitLocation = try nearestSplit(for: node, along: axis)
    let splitPath = splitLocation.splitPath
    let splitNode = splitLocation.splitNode
    let pathToNode = splitLocation.pathToNode
    guard case .split(let split) = splitNode else { throw SplitError.viewNotFound }
    let componentIndex = splitPath.path.count
    guard pathToNode.path.indices.contains(componentIndex) else {
      throw SplitError.viewNotFound
    }
    let targetSide = pathToNode.path[componentIndex]
    let spatial = root.spatial(within: bounds.size)
    guard let splitSlot = spatial.slots.first(where: { $0.node == splitNode }) else {
      throw SplitError.viewNotFound
    }

    let totalDimension =
      axis == .horizontal
      ? max(bounds.width, 1)
      : max(bounds.height, 1)
    let splitDimension =
      axis == .horizontal
      ? max(splitSlot.bounds.width, 1)
      : max(splitSlot.bounds.height, 1)
    let desiredDimension =
      switch unit {
      case .cells:
        amount
      case .percent:
        totalDimension * (amount / 100)
      }
    let rawRatio =
      switch targetSide {
      case .left:
        desiredDimension / splitDimension
      case .right:
        1 - (desiredDimension / splitDimension)
      }
    let clampedRatio = max(0.1, min(0.9, rawRatio))
    let newRoot = try root.replacingNode(
      at: splitPath,
      with: .split(
        Split(
          direction: split.direction,
          ratio: clampedRatio,
          left: split.left,
          right: split.right
        ))
    )
    return Self(root: newRoot, zoomed: nil)
  }

  public func viewBounds() -> CGSize {
    root?.viewBounds() ?? .zero
  }

  public func leaves() -> [ViewType] {
    root?.leaves() ?? []
  }

  private static func leafNode(_ view: ViewType) -> Node {
    .leaf(view: view)
  }

  private func bucketSizes(total: Int, bucketCount: Int) -> [Int] {
    let base = total / bucketCount
    let remainder = total % bucketCount
    return (0..<bucketCount).map { index in
      base + (index < remainder ? 1 : 0)
    }
  }

  private struct SplitLocation {
    let pathToNode: Path
    let splitNode: Node
    let splitPath: Path
  }

  private func nearestSplit(
    for node: Node,
    along direction: Direction
  ) throws -> SplitLocation {
    guard let root else { throw SplitError.viewNotFound }
    guard let pathToNode = root.path(to: node) else { throw SplitError.viewNotFound }
    guard !pathToNode.path.isEmpty else { throw SplitError.viewNotFound }

    for index in stride(from: pathToNode.path.count - 1, through: 0, by: -1) {
      let candidatePath = Path(path: Array(pathToNode.path.prefix(index)))
      guard let candidateNode = root.node(at: candidatePath) else { continue }
      guard case .split(let split) = candidateNode else { continue }
      if split.direction == direction {
        return SplitLocation(pathToNode: pathToNode, splitNode: candidateNode, splitPath: candidatePath)
      }
    }

    throw SplitError.viewNotFound
  }

  public init(root: Node?, zoomed: Node?) {
    self.root = root
    self.zoomed = zoomed
  }
}
