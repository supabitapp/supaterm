import CoreGraphics
import SupaTheme
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
    let viewportHeight: CGFloat = 300
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
      draggingItemIDs: [.tab(source)],
      viewportHeight: viewportHeight
    )

    #expect(
      plan.semanticTargets.map(\.path) == [
        .rootBoundary(index: 0, affinity: .before),
        .rootBoundary(index: 1, affinity: .before),
        .rootItem(index: 1),
        .group(groupID, index: 0),
        .group(groupID, index: 1),
        .group(groupID, index: 2),
        .trailingRoot,
      ]
    )
    let leading = try #require(plan.semanticTargets.first)
    let rootTarget = try #require(plan.semanticTargets[safe: 0])
    let headerTarget = try #require(plan.semanticTargets[safe: 2])
    let endTarget = try #require(plan.semanticTargets[safe: 5])
    let trailingTarget = try #require(plan.semanticTargets[safe: 6])
    #expect(
      leading.frame
        == CGRect(x: 0, y: TerminalSidebarLayoutPlan.initialY, width: 220, height: 37)
    )
    #expect(rootTarget.frame.height == 37)
    #expect(headerTarget.frame.minX == 3)
    #expect(headerTarget.frame.height == 34)
    #expect(endTarget.frame.minY < endTarget.frame.maxY)
    #expect(trailingTarget.frame.minY == endTarget.frame.maxY)
    #expect(trailingTarget.frame.height == viewportHeight)
    #expect(plan.semanticTarget(at: leading.frame.midY)?.path == leading.path)
  }

  @Test
  func expandedGroupLastChildLowerHalfTargetsGroupEnd() throws {
    let first = TerminalTabID()
    let last = TerminalTabID()
    let source = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [first, last]),
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
    let lastFrame = try #require(plan.items.first { $0.id == .tab(last) }?.frame)
    let endTarget = try #require(
      plan.semanticTargets.first { $0.path == .group(groupID, index: 2) }
    )

    #expect(plan.semanticTarget(at: lastFrame.midY - 1)?.path == .group(groupID, index: 1))
    #expect(plan.semanticTarget(at: lastFrame.midY + 1)?.path == .group(groupID, index: 2))
    #expect(endTarget.frame.maxY == lastFrame.maxY + TerminalSidebarLayoutPlan.expandedGroupTrailingSpacing)
  }

  @Test
  func groupEndDropProjectsPlaceholderIntoGroupSurface() throws {
    let first = TerminalTabID()
    let last = TerminalTabID()
    let source = TerminalTabID()
    let tail = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [first, last]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let target = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .group(groupID, index: 2),
        outline: outline
      )
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      target: target
    )
    let placeholder = try #require(plan.dropPlaceholderFrame)
    let group = try #require(plan.groups.first { $0.id == groupID })
    let tailFrame = try #require(plan.items.first { $0.id == .tab(tail) }?.frame)

    #expect(group.frame.maxY == placeholder.maxY + TerminalSidebarLayout.groupSurfaceOverflow)
    #expect(group.frame.contains(CGPoint(x: placeholder.midX, y: placeholder.midY)))
    #expect(tailFrame.minY > group.frame.maxY)
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
    let childEndTarget = try #require(
      plan.semanticTargets.first { $0.path == .group(groupID, index: 1) }
    )

    #expect(rootTarget.frame.minY == rootFrame.minY)
    #expect(rootTarget.frame.height == rootFrame.height)
    #expect(childTarget.frame == CGRect(x: 0, y: childFrame.minY, width: 220, height: 36.5))
    #expect(childEndTarget.frame.minY == childFrame.midY)
    #expect(childEndTarget.frame.maxY == childFrame.maxY + TerminalSidebarLayoutPlan.expandedGroupTrailingSpacing)
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
  func groupedTabRevealIncludesItsGroupSurface() throws {
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .yellow, .automatic, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let childEntry = try #require(outline.visibleEntries.first { $0.id == .tab(child) })
    let groupFrame = try #require(plan.groups.first?.frame)

    #expect(plan.revealFrame(for: childEntry) == groupFrame)
  }

  @Test
  func collapsedGroupSurfaceKeepsCompactOverflow() throws {
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .yellow, .automatic, [child]),
          isPinned: false
        )
      ],
      revision: 1,
      collapsedGroupIDs: [groupID]
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let headerFrame = try #require(plan.items.first { $0.id == .group(groupID) }?.frame)
    let groupFrame = try #require(plan.groups.first?.frame)

    #expect(groupFrame.maxY - headerFrame.maxY == TerminalSidebarLayout.groupSurfaceOverflow)
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
  func pinDividerWinsBeforeExpandedExitAndTrailingOwnsTheSpaceAboveThePinnedControl() throws {
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
    let trailingTarget = try #require(
      plan.semanticTargets.first { $0.path == .trailingRoot }
    )

    #expect(
      divider.minY - childFrame.maxY == TerminalSidebarLayoutPlan.pinDividerTopSpacing
    )
    #expect(
      regularGroupFrame.minY - divider.maxY == TerminalSidebarLayout.tabRowSpacing
    )
    #expect(plan.semanticTarget(at: divider.midY)?.path == .pinnedEnd)
    #expect(plan.semanticTarget(at: trailingTarget.frame.minY + 1)?.path == .trailingRoot)
    #expect(
      !plan.semanticTargets.contains {
        $0.path == .rootBoundary(index: 0, affinity: .after)
      }
    )
  }

  @Test
  func longScrollableListsKeepTheTrailingDropTargetAfterTheLastRow() throws {
    let tabs = (0..<12).map { _ in TerminalTabID() }
    let outline = TerminalSidebarTestFixture.outline(
      roots: tabs.map { TerminalSidebarOutline.Root(content: .tab($0), isPinned: false) },
      revision: 1
    )
    let viewportHeight: CGFloat = 180
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      viewportHeight: viewportHeight
    )
    let lastTab = try #require(tabs.last)
    let lastFrame = try #require(plan.items.first { $0.id == .tab(lastTab) }?.frame)
    let newTabFrame = try #require(plan.items.first { $0.id == .newTab }?.frame)
    let trailingTarget = try #require(
      plan.semanticTargets.first { $0.path == .trailingRoot }
    )
    let payload = try #require(outline.dragPayload(for: .tab(tabs[0])))
    let dropPlan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: .trailingRoot,
      outline: outline
    )

    #expect(plan.contentSize.height > viewportHeight)
    #expect(plan.items.map(\.id) == tabs.map(TerminalSidebarEntryID.tab) + [.newTab])
    #expect(trailingTarget.frame.minY == lastFrame.maxY)
    #expect(newTabFrame.minY > trailingTarget.frame.minY)
    #expect(plan.semanticTarget(at: trailingTarget.frame.minY + 1)?.path == .trailingRoot)
    #expect(dropPlan?.destination == .root(isPinned: false, index: tabs.count - 1))
    #expect(dropPlan?.placeholder == .beforeFooter)
  }

  @Test
  func separatorsAndNewTabSpanTheSidebarWidth() throws {
    let pinned = TerminalTabID()
    let regular = TerminalTabID()
    let width: CGFloat = 220
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: TerminalSidebarTestFixture.outline(
        roots: [
          TerminalSidebarOutline.Root(content: .tab(pinned), isPinned: true),
          TerminalSidebarOutline.Root(content: .tab(regular), isPinned: false),
        ],
        revision: 1
      ),
      width: width
    )
    let pinnedFrame = try #require(plan.items.first { $0.id == .tab(pinned) }?.frame)
    let dividerFrame = try #require(plan.items.first { $0.id == .pinDivider }?.frame)
    let newTabFrame = try #require(plan.items.first { $0.id == .newTab }?.frame)

    #expect(pinnedFrame.minX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(width - pinnedFrame.maxX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(dividerFrame.minX == 0)
    #expect(dividerFrame.width == width)
    #expect(newTabFrame.minX == 0)
    #expect(newTabFrame.width == width)
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
  func groupedTabsIndentTheirContentWithoutShiftingTrailingAccessories() throws {
    let root = TerminalTabID()
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let width: CGFloat = 220
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [child]),
          isPinned: false
        ),
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline, width: width)
    let rootFrame = try #require(plan.items.first { $0.id == .tab(root) }?.frame)
    let groupFrame = try #require(plan.groups.first?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)

    #expect(rootFrame.minX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(width - rootFrame.maxX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(groupFrame.minX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(width - groupFrame.maxX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(childFrame.minX == rootFrame.minX)
    #expect(childFrame.maxX == rootFrame.maxX)
    #expect(childFrame.minX == width - childFrame.maxX)

    let rootContentInsets = TerminalSidebarLayout.tabContentHorizontalInsets(isGrouped: false)
    let childContentInsets = TerminalSidebarLayout.tabContentHorizontalInsets(isGrouped: true)
    #expect(
      childContentInsets.leading - rootContentInsets.leading
        == TerminalSidebarLayout.groupedTabIndent
    )
    #expect(childContentInsets.trailing == rootContentInsets.trailing)

    let childSurfaceFrame = TerminalSidebarLayout.tabSurfaceFrame(
      in: childFrame,
      isGrouped: true
    )
    #expect(childSurfaceFrame.minX - groupFrame.minX == TerminalSidebarLayout.groupedTabIndent)
    #expect(groupFrame.maxX - childSurfaceFrame.maxX == TerminalSidebarLayout.groupSurfaceOverflow)
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
