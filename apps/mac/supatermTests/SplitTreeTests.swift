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

  @Test
  func mainVerticalKeepsLeaderOnLeftAndStacksTeammatesOnRight() throws {
    let first = SplitTreeTestView()
    let second = SplitTreeTestView()
    let third = SplitTreeTestView()
    let fourth = SplitTreeTestView()
    let fifth = SplitTreeTestView()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .inserting(view: third, at: second, direction: .down)
      .inserting(view: fourth, at: second, direction: .right)
      .inserting(view: fifth, at: second, direction: .down)
    let mainVerticalTree = tree.mainVertical()

    let root = try #require(mainVerticalTree.root)
    guard case .split(let rootSplit) = root else {
      Issue.record("Expected main vertical tree root to be a split")
      return
    }

    #expect(rootSplit.direction == .horizontal)
    guard case .leaf(let leader) = rootSplit.left else {
      Issue.record("Expected leader pane on the left")
      return
    }
    #expect(leader === first)

    guard case .split(let teammateSplit) = rootSplit.right else {
      Issue.record("Expected teammate panes on the right")
      return
    }
    #expect(teammateSplit.direction == .vertical)
    #expect(rootSplit.right.leaves().map(\.id) == Array(tree.leaves().dropFirst()).map(\.id))
  }

  @Test
  func sizingPercentSetsLeaderWidthRelativeToWindowBounds() throws {
    let first = SplitTreeTestView()
    let second = SplitTreeTestView()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .mainVertical()
    let leaderNode = try #require(tree.find(id: first.id))
    let resized = try tree.sizing(
      node: leaderNode,
      to: 30,
      along: .horizontal,
      unit: .percent,
      with: CGRect(x: 0, y: 0, width: 180, height: 60)
    )

    let root = try #require(resized.root)
    guard case .split(let rootSplit) = root else {
      Issue.record("Expected resized tree root to be a split")
      return
    }
    #expect(abs(rootSplit.ratio - 0.3) < 0.0001)
  }
}

private final class SplitTreeTestView: NSView, Identifiable {
  let id = UUID()
}
