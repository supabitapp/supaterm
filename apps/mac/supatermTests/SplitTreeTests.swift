import AppKit
import Testing

@testable import supaterm

struct SplitTreeTests {
  @Test
  func focusTargetAfterClosingUsesNextForLeftmostLeaf() throws {
    let first = SplitTreeTestView()
    let second = SplitTreeTestView()
    let third = SplitTreeTestView()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .inserting(view: third, at: second, direction: .right)

    let node = try #require(tree.find(id: first.id))
    #expect(tree.focusTargetAfterClosing(node) === second)
  }

  @Test
  func focusTargetAfterClosingUsesPreviousForNonLeftmostLeaf() throws {
    let first = SplitTreeTestView()
    let second = SplitTreeTestView()
    let third = SplitTreeTestView()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .inserting(view: third, at: second, direction: .right)

    let node = try #require(tree.find(id: third.id))
    #expect(tree.focusTargetAfterClosing(node) === second)
  }

  @Test
  func tiledArrangesLeavesIntoBalancedRows() throws {
    let first = SplitTreeTestView()
    let second = SplitTreeTestView()
    let third = SplitTreeTestView()
    let fourth = SplitTreeTestView()
    let fifth = SplitTreeTestView()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .inserting(view: third, at: second, direction: .right)
      .inserting(view: fourth, at: third, direction: .right)
      .inserting(view: fifth, at: fourth, direction: .right)
      .tiled()

    let root = try #require(tree.root)
    let leaves = root.leaves()
    #expect(leaves.map(\.id) == [first.id, second.id, third.id, fourth.id, fifth.id])

    guard case .split(let rootSplit) = root else {
      Issue.record("Expected tiled tree root to be a split")
      return
    }
    #expect(rootSplit.direction == .vertical)
    #expect(rootSplit.left.leaves().count == 3)
    #expect(rootSplit.right.leaves().count == 2)
  }
}

private final class SplitTreeTestView: NSView, Identifiable {
  let id = UUID()
}
