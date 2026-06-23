import AppKit

extension SplitTree.Spatial {
  public func slots(
    in direction: SplitTree.SpatialDirection,
    from referenceNode: SplitTree.Node
  ) -> [SplitTree.SpatialSlot] {
    guard let refSlot = slots.first(where: { $0.node == referenceNode }) else { return [] }

    func distance(from rect1: CGRect, to rect2: CGRect) -> Double {
      let deltaX = rect2.minX - rect1.minX
      let deltaY = rect2.minY - rect1.minY
      return sqrt(deltaX * deltaX + deltaY * deltaY)
    }

    return switch direction {
    case .left:
      slots.filter {
        $0.node != referenceNode && $0.bounds.maxX <= refSlot.bounds.minX
      }.sorted {
        distance(from: refSlot.bounds, to: $0.bounds)
          < distance(from: refSlot.bounds, to: $1.bounds)
      }
    case .right:
      slots.filter {
        $0.node != referenceNode && $0.bounds.minX >= refSlot.bounds.maxX
      }.sorted {
        distance(from: refSlot.bounds, to: $0.bounds)
          < distance(from: refSlot.bounds, to: $1.bounds)
      }
    case .up:
      slots.filter {
        $0.node != referenceNode && $0.bounds.maxY <= refSlot.bounds.minY
      }.sorted {
        distance(from: refSlot.bounds, to: $0.bounds)
          < distance(from: refSlot.bounds, to: $1.bounds)
      }
    case .down:
      slots.filter {
        $0.node != referenceNode && $0.bounds.minY >= refSlot.bounds.maxY
      }.sorted {
        distance(from: refSlot.bounds, to: $0.bounds)
          < distance(from: refSlot.bounds, to: $1.bounds)
      }
    }
  }
}

extension BidirectionalCollection {
  func indexWrapping(before index: Index) -> Index {
    let previousIndex = self.index(before: index)
    if previousIndex < startIndex {
      return self.index(before: endIndex)
    }
    return previousIndex
  }

  func indexWrapping(after index: Index) -> Index {
    let nextIndex = self.index(after: index)
    if nextIndex == endIndex {
      return startIndex
    }
    return nextIndex
  }
}
