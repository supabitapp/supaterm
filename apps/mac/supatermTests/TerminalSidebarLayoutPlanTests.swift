import CoreGraphics
import Testing

@testable import supaterm

struct TerminalSidebarLayoutPlanTests {
  @Test
  func visibleEntriesPreserveDepthFirstOrderAndDurableEmptyGroups() {
    let pinned = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let populatedGroup = TerminalTabGroupID()
    let emptyGroup = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(pinned), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .group(populatedGroup, .blue, .automatic, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .group(emptyGroup, .neutral, .durable, []),
          isPinned: false
        ),
      ],
      revision: 4
    )

    #expect(
      outline.visibleEntries.map(\.id) == [
        .tab(pinned),
        .pinDivider,
        .group(populatedGroup),
        .tab(first),
        .tab(second),
        .group(emptyGroup),
        .newTab,
      ]
    )
  }

  @Test
  func ordinaryAndExpandedTargetsKeepExactOrderedBoundaries() throws {
    let root = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let source = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 3
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )

    #expect(
      plan.semanticTargets.map(\.path) == [
        .rootBoundary(index: 0, affinity: .before),
        .rootBoundary(index: 1, affinity: .before),
        .rootItem(index: 1),
        .group(groupID, index: 0),
        .group(groupID, index: 1),
        .rootBoundary(index: 1, affinity: .after),
        .trailingRoot,
      ]
    )
    let leading = try #require(plan.semanticTargets.first)
    let rootTarget = try #require(plan.semanticTargets[safe: 0])
    let headerTarget = try #require(plan.semanticTargets[safe: 2])
    let exitTarget = try #require(plan.semanticTargets[safe: 5])
    #expect(leading.frame == CGRect(x: 0, y: -3, width: 220, height: 37))
    #expect(rootTarget.frame.height == 37)
    #expect(headerTarget.frame.minX == 3)
    #expect(headerTarget.frame.height == 34)
    #expect(exitTarget.frame.height == TerminalSidebarLayoutPlan.rootSpacing)
    #expect(plan.semanticTarget(at: leading.frame.midY)?.path == leading.path)
  }

  @Test
  func variableRowsDriveTargetsWithoutFrozenIndices() throws {
    let root = TerminalTabID()
    let child = TerminalTabID()
    let source = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .purple, .automatic, [child]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 7
    )
    var heights = Dictionary(
      uniqueKeysWithValues: outline.visibleEntries.map { ($0.id, CGFloat(37)) }
    )
    heights[.tab(root)] = 61
    heights[.tab(child)] = 73
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      preferredHeights: heights
    )
    let rootFrame = try #require(plan.items.first { $0.id == .tab(root) }?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)
    let rootTarget = try #require(
      plan.semanticTargets.first { $0.path == .rootBoundary(index: 0, affinity: .before) }
    )
    let childTarget = try #require(
      plan.semanticTargets.first { $0.path == .group(groupID, index: 0) }
    )

    #expect(rootTarget.frame.minY == rootFrame.minY)
    #expect(rootTarget.frame.height == rootFrame.height)
    #expect(childTarget.frame == CGRect(x: 0, y: childFrame.minY, width: 220, height: 73))
  }

  @Test
  func compactGroupHeaderKeepsTargetsWithinItsFrame() throws {
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      preferredHeights: [.group(groupID): TerminalSidebarLayout.tabRowMinHeight]
    )
    let header = try #require(plan.items.first { $0.id == .group(groupID) }?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)
    let target = try #require(plan.semanticTargets.first { $0.path == .rootItem(index: 0) })

    #expect(header.height == TerminalSidebarLayout.tabRowMinHeight)
    #expect(childFrame.minY - header.maxY == TerminalSidebarLayout.tabRowSpacing)
    #expect(target.frame.maxY <= header.maxY)
  }

  @Test
  func collapsedAndEmptyGroupsSplitOneHeaderIntoTopAndBottomTargets() {
    let collapsedChild = TerminalTabID()
    let source = TerminalTabID()
    let collapsedGroup = TerminalTabGroupID()
    let emptyGroup = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(collapsedGroup, .orange, .automatic, [collapsedChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .group(emptyGroup, .neutral, .durable, []),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 8,
      collapsedGroupIDs: [collapsedGroup]
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )

    for (groupID, insertionIndex) in [(collapsedGroup, 1), (emptyGroup, 0)] {
      let targets = plan.semanticTargets.filter {
        switch $0.path {
        case .rootBoundary, .group(groupID, _): true
        case .rootItem, .group, .pinnedEnd, .trailingRoot: false
        }
      }
      let groupTarget = targets.first {
        guard case .group(groupID, insertionIndex) = $0.path else { return false }
        return true
      }
      #expect(groupTarget?.frame.height == 19)
      let bottom = plan.semanticTargets.first {
        guard case .rootBoundary(let index, .after) = $0.path else { return false }
        return outline.roots[index].id == .group(groupID)
      }
      #expect(bottom?.frame.height == 18)
    }
  }

  @Test
  func pinDividerWinsBeforeExpandedExitAndTrailingOwnsFooter() throws {
    let child = TerminalTabID()
    let source = TerminalTabID()
    let regularChild = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let regularGroupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: true
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .group(regularGroupID, .green, .automatic, [regularChild]),
          isPinned: false
        ),
      ],
      revision: 3
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)
    let divider = try #require(plan.items.first { $0.id == .pinDivider }?.frame)
    let regularGroupFrame = try #require(plan.groups.first { $0.id == regularGroupID }?.frame)
    let footer = try #require(plan.items.first { $0.id == .newTab }?.frame)

    #expect(
      divider.minY - childFrame.maxY == TerminalSidebarLayoutPlan.pinDividerTopSpacing
    )
    #expect(
      regularGroupFrame.minY - divider.maxY == TerminalSidebarLayout.tabRowSpacing
    )
    #expect(plan.semanticTarget(at: divider.midY)?.path == .pinnedEnd)
    #expect(plan.semanticTarget(at: footer.midY)?.path == .trailingRoot)
    #expect(
      !plan.semanticTargets.contains {
        $0.path == .rootBoundary(index: 0, affinity: .after)
      }
    )
  }

  @Test
  func sourceTargetsAreExcludedAndGroupSurfacesDoNotOverlap() throws {
    let firstChild = TerminalTabID()
    let source = TerminalTabID()
    let secondChild = TerminalTabID()
    let firstGroup = TerminalTabGroupID()
    let secondGroup = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(firstGroup, .blue, .automatic, [firstChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(secondGroup, .green, .automatic, [secondChild]),
          isPinned: false
        ),
      ],
      revision: 2
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )
    let firstFrame = try #require(plan.groups.first { $0.id == firstGroup }?.frame)
    let secondFrame = try #require(plan.groups.first { $0.id == secondGroup }?.frame)

    #expect(!plan.semanticTargets.contains { $0.path == .rootItem(index: 1) })
    #expect(secondFrame.minY > firstFrame.maxY)
  }

  @Test
  func groupHoverFrameContainsHeaderAndChildren() throws {
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let groupFrame = try #require(plan.groups.first?.frame)
    let headerFrame = try #require(plan.items.first { $0.id == .group(groupID) }?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)

    #expect(plan.groupID(at: CGPoint(x: groupFrame.midX, y: headerFrame.midY)) == groupID)
    #expect(plan.groupID(at: CGPoint(x: groupFrame.midX, y: childFrame.midY)) == groupID)
    #expect(plan.groupID(at: CGPoint(x: groupFrame.maxX + 1, y: childFrame.midY)) == nil)
  }

  @Test
  func groupedRowsUseTheirHorizontalInsets() throws {
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let groupFrame = try #require(plan.groups.first?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)

    #expect(childFrame.minX - groupFrame.minX == TerminalSidebarLayoutPlan.childIndentation)
    #expect(groupFrame.maxX - childFrame.maxX == TerminalSidebarLayoutPlan.childTrailingInset)
  }

  @Test
  func orderedTargetMapUsesFirstMatch() {
    let first = TerminalSidebarSemanticTarget(
      path: .rootBoundary(index: 0, affinity: .before),
      frame: CGRect(x: 0, y: 0, width: 100, height: 10)
    )
    let second = TerminalSidebarSemanticTarget(
      path: .rootItem(index: 0),
      frame: CGRect(x: 0, y: 0, width: 100, height: 40)
    )
    let map = TerminalSidebarDropTargetMap(targets: [first, second])

    #expect(map.semanticTarget(at: 5)?.path == first.path)
    #expect(map.semanticTarget(at: 20)?.path == second.path)
    #expect(map.semanticTarget(at: 40) == nil)
  }
}

extension Array {
  fileprivate subscript(safe index: Index) -> Element? {
    indices.contains(index) ? self[index] : nil
  }
}
