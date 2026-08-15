import CoreGraphics
import SupatermTerminalCore
import Testing

@testable import supaterm

struct SplitTreeTests {
  @Test
  func focusTargetAfterClosingUsesNextForLeftmostLeaf() throws {
    let first = SplitTreeTestLeaf()
    let second = SplitTreeTestLeaf()
    let third = SplitTreeTestLeaf()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .inserting(view: third, at: second, direction: .right)

    let node = try #require(tree.find(id: first.id))
    #expect(tree.focusTargetAfterClosing(node) == second)
  }

  @Test
  func focusTargetAfterClosingUsesPreviousForNonLeftmostLeaf() throws {
    let first = SplitTreeTestLeaf()
    let second = SplitTreeTestLeaf()
    let third = SplitTreeTestLeaf()

    let tree = try SplitTree(view: first)
      .inserting(view: second, at: first, direction: .right)
      .inserting(view: third, at: second, direction: .right)

    let node = try #require(tree.find(id: third.id))
    #expect(tree.focusTargetAfterClosing(node) == second)
  }

  @Test
  func tiledArrangesLeavesIntoBalancedRows() throws {
    let first = SplitTreeTestLeaf()
    let second = SplitTreeTestLeaf()
    let third = SplitTreeTestLeaf()
    let fourth = SplitTreeTestLeaf()
    let fifth = SplitTreeTestLeaf()

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
    let first = SplitTreeTestLeaf()
    let second = SplitTreeTestLeaf()
    let third = SplitTreeTestLeaf()
    let fourth = SplitTreeTestLeaf()
    let fifth = SplitTreeTestLeaf()

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
    #expect(leader == first)

    guard case .split(let teammateSplit) = rootSplit.right else {
      Issue.record("Expected teammate panes on the right")
      return
    }
    #expect(teammateSplit.direction == .vertical)
    #expect(rootSplit.right.leaves().map(\.id) == Array(tree.leaves().dropFirst()).map(\.id))
  }

  @Test
  func sizingPercentSetsLeaderWidthRelativeToWindowBounds() throws {
    let first = SplitTreeTestLeaf()
    let second = SplitTreeTestLeaf()

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

  @Test
  func stableIdentityFindsValueLeafAcrossPayloadChanges() throws {
    let paneID = PaneID()
    let original = SplitTreeTestLeaf(id: paneID, value: 1)
    let updated = SplitTreeTestLeaf(id: paneID, value: 2)
    let second = SplitTreeTestLeaf()

    let tree = try SplitTree(view: original)
      .inserting(view: second, at: updated, direction: .right)

    let found = try #require(tree.root?.node(view: updated))
    guard case .leaf(let stored) = found else {
      Issue.record("Expected the original leaf")
      return
    }
    #expect(stored == original)
  }

  @Test
  func insertingDuplicateLeafIdentityFails() {
    let paneID = PaneID()
    let first = SplitTreeTestLeaf(id: paneID, value: 1)
    let duplicate = SplitTreeTestLeaf(id: paneID, value: 2)
    let tree = SplitTree(view: first)

    #expect(throws: SplitTree<SplitTreeTestLeaf>.SplitError.duplicateLeafID) {
      try tree.inserting(view: duplicate, at: first, direction: .right)
    }
  }

  @Test
  func joiningTreesWithDuplicateLeafIdentityFails() {
    let paneID = PaneID()
    let first = SplitTree(view: SplitTreeTestLeaf(id: paneID, value: 1))
    let second = SplitTree(view: SplitTreeTestLeaf(id: paneID, value: 2))

    #expect(first.joining(second, direction: .horizontal, placingOtherAfter: true) == nil)
  }

  @Test
  func referenceLeafReplacementChangesRenderIdentity() throws {
    let paneID = PaneID()
    let original = SplitTreeReferenceLeaf(id: paneID)
    let replacement = SplitTreeReferenceLeaf(id: paneID)
    let originalNode = SplitTree(view: original).root
    let replacementNode = SplitTree(view: replacement).root
    let originalIdentity = try #require(originalNode).structuralIdentity
    let replacementIdentity = try #require(replacementNode).structuralIdentity

    #expect(originalNode == replacementNode)
    #expect(originalIdentity != replacementIdentity)
  }
}

private nonisolated struct SplitTreeTestLeaf: Identifiable, Equatable, Sendable {
  let id: PaneID
  let value: Int

  init(id: PaneID = PaneID(), value: Int = 0) {
    self.id = id
    self.value = value
  }
}

private final class SplitTreeReferenceLeaf: Identifiable {
  let id: PaneID

  init(id: PaneID) {
    self.id = id
  }
}
