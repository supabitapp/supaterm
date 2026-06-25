import AppKit

extension SplitTree.Node {
  public typealias Node = SplitTree.Node
  public typealias NewDirection = SplitTree.NewDirection
  public typealias SplitError = SplitTree.SplitError
  public typealias Path = SplitTree.Path
  public typealias PathComponent = SplitTree.PathComponent
  public typealias Split = SplitTree.Split

  public static func == (lhs: Self, rhs: Self) -> Bool {
    switch (lhs, rhs) {
    case (.leaf(let leftView), .leaf(let rightView)):
      return leftView === rightView

    case (.split(let split1), .split(let split2)):
      return split1 == split2

    default:
      return false
    }
  }

  public func find(id: ViewType.ID) -> Node? {
    switch self {
    case .leaf(let view):
      return view.id == id ? self : nil
    case .split(let split):
      if let found = split.left.find(id: id) { return found }
      return split.right.find(id: id)
    }
  }

  public func node(view: ViewType) -> Node? {
    switch self {
    case .leaf(let leafView):
      return leafView === view ? self : nil
    case .split(let split):
      if let result = split.left.node(view: view) { return result }
      if let result = split.right.node(view: view) { return result }
      return nil
    }
  }

  public func path(to node: Self) -> Path? {
    var components: [PathComponent] = []
    func search(_ current: Self) -> Bool {
      if current == node { return true }
      switch current {
      case .leaf:
        return false
      case .split(let split):
        components.append(.left)
        if search(split.left) { return true }
        components.removeLast()
        components.append(.right)
        if search(split.right) { return true }
        components.removeLast()
        return false
      }
    }
    return search(self) ? Path(path: components) : nil
  }

  public func node(at path: Path) -> Node? {
    if path.isEmpty { return self }
    guard case .split(let split) = self else { return nil }
    let component = path.path[0]
    let remainingPath = Path(path: Array(path.path.dropFirst()))
    switch component {
    case .left:
      return split.left.node(at: remainingPath)
    case .right:
      return split.right.node(at: remainingPath)
    }
  }

  public func inserting(view: ViewType, at anchor: ViewType, direction: NewDirection) throws -> Self {
    guard let path = path(to: .leaf(view: anchor)) else {
      throw SplitError.viewNotFound
    }

    let splitDirection: SplitTree.Direction
    let newViewOnLeft: Bool
    switch direction {
    case .left:
      splitDirection = .horizontal
      newViewOnLeft = true
    case .right:
      splitDirection = .horizontal
      newViewOnLeft = false
    case .up:
      splitDirection = .vertical
      newViewOnLeft = true
    case .down:
      splitDirection = .vertical
      newViewOnLeft = false
    }

    let newNode: Node = .leaf(view: view)
    let existingNode: Node = .leaf(view: anchor)
    let newSplit: Node = .split(
      Split(
        direction: splitDirection,
        ratio: 0.5,
        left: newViewOnLeft ? newNode : existingNode,
        right: newViewOnLeft ? existingNode : newNode
      ))

    return try replacingNode(at: path, with: newSplit)
  }

  public func replacingNode(at path: Path, with newNode: Self) throws -> Self {
    if path.isEmpty { return newNode }

    func replaceInner(current: Node, pathOffset: Int) throws -> Node {
      if pathOffset >= path.path.count { return newNode }
      guard case .split(let split) = current else {
        throw SplitError.viewNotFound
      }
      let component = path.path[pathOffset]
      switch component {
      case .left:
        return .split(
          Split(
            direction: split.direction,
            ratio: split.ratio,
            left: try replaceInner(current: split.left, pathOffset: pathOffset + 1),
            right: split.right
          ))
      case .right:
        return .split(
          Split(
            direction: split.direction,
            ratio: split.ratio,
            left: split.left,
            right: try replaceInner(current: split.right, pathOffset: pathOffset + 1)
          ))
      }
    }

    return try replaceInner(current: self, pathOffset: 0)
  }

  public func remove(_ target: Node) -> Node? {
    if self == target { return nil }
    switch self {
    case .leaf:
      return self
    case .split(let split):
      let newLeft = split.left.remove(target)
      let newRight = split.right.remove(target)
      if newLeft == nil && newRight == nil {
        return nil
      }
      if newLeft == nil {
        return newRight
      }
      if newRight == nil {
        return newLeft
      }
      return .split(
        Split(
          direction: split.direction,
          ratio: split.ratio,
          left: newLeft!,
          right: newRight!
        ))
    }
  }

  public func resizing(to ratio: Double) -> Self {
    switch self {
    case .leaf:
      return self
    case .split(let split):
      return .split(
        Split(
          direction: split.direction,
          ratio: ratio,
          left: split.left,
          right: split.right
        ))
    }
  }

  public func leftmostLeaf() -> ViewType {
    switch self {
    case .leaf(let view):
      return view
    case .split(let split):
      return split.left.leftmostLeaf()
    }
  }

  public func rightmostLeaf() -> ViewType {
    switch self {
    case .leaf(let view):
      return view
    case .split(let split):
      return split.right.rightmostLeaf()
    }
  }

  public func leaves() -> [ViewType] {
    switch self {
    case .leaf(let view):
      return [view]
    case .split(let split):
      return split.left.leaves() + split.right.leaves()
    }
  }

  public func equalize() -> Node {
    let (equalizedNode, _) = equalizeWithWeight()
    return equalizedNode
  }

  public static func arranged(
    _ nodes: [Node],
    direction: SplitTree.Direction
  ) -> Node {
    precondition(!nodes.isEmpty)
    if nodes.count == 1 {
      return nodes[0]
    }

    let midpoint = (nodes.count + 1) / 2
    let leftNodes = Array(nodes[..<midpoint])
    let rightNodes = Array(nodes[midpoint...])
    let leftNode = arranged(leftNodes, direction: direction)
    let rightNode = arranged(rightNodes, direction: direction)
    let leftLeafCount = leftNode.leafCount()
    let rightLeafCount = rightNode.leafCount()
    let ratio = Double(leftLeafCount) / Double(leftLeafCount + rightLeafCount)

    return .split(
      Split(
        direction: direction,
        ratio: ratio,
        left: leftNode,
        right: rightNode
      )
    )
  }

  private func equalizeWithWeight() -> (node: Node, weight: Int) {
    switch self {
    case .leaf:
      return (self, 1)
    case .split(let split):
      let leftWeight = split.left.weightForDirection(split.direction)
      let rightWeight = split.right.weightForDirection(split.direction)
      let totalWeight = leftWeight + rightWeight
      let newRatio = Double(leftWeight) / Double(totalWeight)
      let (leftNode, _) = split.left.equalizeWithWeight()
      let (rightNode, _) = split.right.equalizeWithWeight()
      let newSplit = Split(
        direction: split.direction,
        ratio: newRatio,
        left: leftNode,
        right: rightNode
      )
      return (.split(newSplit), totalWeight)
    }
  }

  private func weightForDirection(_ direction: SplitTree.Direction) -> Int {
    switch self {
    case .leaf:
      return 1
    case .split(let split):
      if split.direction == direction {
        return split.left.weightForDirection(direction) + split.right.weightForDirection(direction)
      }
      return 1
    }
  }

  private func leafCount() -> Int {
    switch self {
    case .leaf:
      return 1
    case .split(let split):
      return split.left.leafCount() + split.right.leafCount()
    }
  }

  public func viewBounds() -> CGSize {
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

  public func spatial(within bounds: CGSize? = nil) -> SplitTree.Spatial {
    let width: Double
    let height: Double
    if let bounds {
      width = bounds.width
      height = bounds.height
    } else {
      let (dimensionWidth, dimensionHeight) = dimensions()
      width = Double(dimensionWidth)
      height = Double(dimensionHeight)
    }

    let slots = spatialSlots(in: CGRect(x: 0, y: 0, width: width, height: height))
    return SplitTree.Spatial(slots: slots)
  }

  private func dimensions() -> (width: UInt, height: UInt) {
    switch self {
    case .leaf:
      return (1, 1)
    case .split(let split):
      let leftDimensions = split.left.dimensions()
      let rightDimensions = split.right.dimensions()
      switch split.direction {
      case .horizontal:
        return (
          width: leftDimensions.width + rightDimensions.width,
          height: max(leftDimensions.height, rightDimensions.height)
        )
      case .vertical:
        return (
          width: max(leftDimensions.width, rightDimensions.width),
          height: leftDimensions.height + rightDimensions.height
        )
      }
    }
  }

  private func spatialSlots(in bounds: CGRect) -> [SplitTree.SpatialSlot] {
    switch self {
    case .leaf:
      return [SplitTree.SpatialSlot(node: self, bounds: bounds)]
    case .split(let split):
      let leftBounds: CGRect
      let rightBounds: CGRect
      switch split.direction {
      case .horizontal:
        let splitX = bounds.minX + bounds.width * split.ratio
        leftBounds = CGRect(
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.width * split.ratio,
          height: bounds.height
        )
        rightBounds = CGRect(
          x: splitX,
          y: bounds.minY,
          width: bounds.width * (1 - split.ratio),
          height: bounds.height
        )
      case .vertical:
        let splitY = bounds.minY + bounds.height * split.ratio
        leftBounds = CGRect(
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.width,
          height: bounds.height * split.ratio
        )
        rightBounds = CGRect(
          x: bounds.minX,
          y: splitY,
          width: bounds.width,
          height: bounds.height * (1 - split.ratio)
        )
      }
      var slots: [SplitTree.SpatialSlot] = [SplitTree.SpatialSlot(node: self, bounds: bounds)]
      slots += split.left.spatialSlots(in: leftBounds)
      slots += split.right.spatialSlots(in: rightBounds)
      return slots
    }
  }

  public var structuralIdentity: StructuralIdentity {
    StructuralIdentity(self)
  }

  public struct StructuralIdentity: Hashable {
    private let node: SplitTree.Node

    init(_ node: SplitTree.Node) {
      self.node = node
    }

    public static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.node.isStructurallyEqual(to: rhs.node)
    }

    public func hash(into hasher: inout Hasher) {
      node.hashStructure(into: &hasher)
    }
  }

  fileprivate func isStructurallyEqual(to other: Node) -> Bool {
    switch (self, other) {
    case (.leaf(let view1), .leaf(let view2)):
      return view1 === view2
    case (.split(let split1), .split(let split2)):
      return split1.direction == split2.direction
        && split1.left.isStructurallyEqual(to: split2.left)
        && split1.right.isStructurallyEqual(to: split2.right)
    default:
      return false
    }
  }

  fileprivate func hashStructure(into hasher: inout Hasher) {
    switch self {
    case .leaf(let view):
      hasher.combine(0)
      hasher.combine(ObjectIdentifier(view))
    case .split(let split):
      hasher.combine(1)
      hasher.combine(split.direction)
      split.left.hashStructure(into: &hasher)
      split.right.hashStructure(into: &hasher)
    }
  }
}
