import CoreGraphics
import CustomDump
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
    let baseline = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      viewportHeight: viewportHeight
    )

    #expect(
      plan.semanticTargets.map(\.path) == [
        .rootItem(lane: .regular, index: 0, id: .tab(root)),
        .rootBoundary(lane: .regular, index: 1),
        .groupEntry(groupID),
        .groupItem(groupID, index: 0, id: first),
        .groupItem(groupID, index: 1, id: second),
        .groupBoundary(groupID, index: 2),
        .rootBoundary(lane: .regular, index: 3),
      ]
    )
    let leading = try #require(plan.semanticTargets.first)
    let rootTarget = try #require(plan.semanticTargets[safe: 0])
    let rootFrame = try #require(plan.items.first { $0.id == .tab(root) }?.frame)
    let headerTarget = try #require(plan.semanticTargets[safe: 2])
    let headerFrame = try #require(plan.items.first { $0.id == .group(groupID) }?.frame)
    let endTarget = try #require(plan.semanticTargets[safe: 5])
    let trailingTarget = try #require(plan.semanticTargets[safe: 6])
    let sourceFrame = try #require(plan.items.first { $0.id == .tab(source) }?.frame)
    let naturalSourceFrame = try #require(
      baseline.items.first { $0.id == .tab(source) }?.frame
    )
    #expect(leading.frame == rootFrame)
    #expect(rootTarget.frame.height == 37)
    #expect(headerTarget.frame == headerFrame)
    #expect(endTarget.frame.minY < endTarget.frame.maxY)
    #expect(sourceFrame.height == 37)
    #expect(trailingTarget.frame.minY == naturalSourceFrame.maxY)
    #expect(trailingTarget.frame.height == viewportHeight)
    #expect(plan.semanticTarget(at: leading.frame.midY)?.path == leading.path)
  }

  @Test
  func expandedGroupKeepsTheLastChildTargetWholeAndAddsAGroupEndBoundary() throws {
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
      plan.semanticTargets.first { $0.path == .groupBoundary(groupID, index: 2) }
    )

    let lastPath = TerminalSidebarSemanticPath.groupItem(groupID, index: 1, id: last)
    #expect(plan.semanticTarget(at: lastFrame.minY + 1)?.path == lastPath)
    #expect(plan.semanticTarget(at: lastFrame.midY)?.path == lastPath)
    #expect(plan.semanticTarget(at: lastFrame.maxY - 1)?.path == lastPath)
    #expect(endTarget.frame.minY == lastFrame.maxY)
    #expect(
      endTarget.frame.maxY
        == lastFrame.maxY + TerminalSidebarLayoutPlan.rootBoundaryTargetHeight
    )
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
        path: .groupBoundary(groupID, index: 2),
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
  func upwardRootDropKeepsNaturalTargetGeometry() throws {
    let first = TerminalTabID()
    let middle = TerminalTabID()
    let source = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [first, middle, source].map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let target = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .rootItem(lane: .regular, index: 1, id: .tab(middle)),
        outline: outline
      )
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      target: target
    )
    let placeholder = try #require(plan.dropPlaceholderFrame)
    let targetMap = TerminalSidebarDropTargetMap(targets: plan.semanticTargets)
    let activeTarget = try #require(
      plan.semanticTargets.first { $0.path == target.path }
    )

    expectNoDifference(targetMap.targets, plan.semanticTargets)
    #expect(placeholder.minY == activeTarget.frame.minY)
  }

  @Test
  func naturalDropTargetsAreIndependentOfPlaceholderAndInterpolation() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()
    let fourth = TerminalTabID()
    let source = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [first, second, third, fourth, source].map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 1
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let upwardPath = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 0,
      id: .tab(first)
    )
    let downwardPath = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 3,
      id: .tab(fourth)
    )
    let upwardTarget = try #require(
      TerminalSidebarDropPlanner.plan(payload: payload, path: upwardPath, outline: outline)
    )
    let downwardTarget = try #require(
      TerminalSidebarDropPlanner.plan(payload: payload, path: downwardPath, outline: outline)
    )
    let origin = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )
    let upward = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      target: upwardTarget
    )
    let downward = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      target: downwardTarget
    )

    #expect(upward.dropPlaceholderFrame != downward.dropPlaceholderFrame)
    expectNoDifference(origin.semanticTargets, upward.semanticTargets)
    expectNoDifference(upward.semanticTargets, downward.semanticTargets)

    let animated = downward.interpolated(from: upward, progress: 0.5)
    expectNoDifference(animated.semanticTargets, downward.semanticTargets)
  }

  @Test
  func liftedRowsCollapseProjectedGeometryAndKeepNaturalTargets() throws {
    let tabs = (0..<4).map { _ in TerminalTabID() }
    let outline = TerminalSidebarTestFixture.outline(
      roots: tabs.map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 1
    )
    let baseline = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let draggingTop = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(tabs[0])]
    )
    let draggingBottom = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(tabs[3])]
    )
    let baselineTop = try #require(baseline.items.first { $0.id == .tab(tabs[0]) })
    let liftedTop = try #require(draggingTop.items.first { $0.id == .tab(tabs[0]) })
    let baselineSecond = try #require(baseline.items.first { $0.id == .tab(tabs[1]) })
    let projectedSecond = try #require(
      draggingTop.items.first { $0.id == .tab(tabs[1]) }
    )
    let projectedMiddle = try #require(
      draggingTop.items.first { $0.id == .tab(tabs[2]) }
    )
    let middlePath = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 2,
      id: .tab(tabs[2])
    )
    let upperPath = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 1,
      id: .tab(tabs[1])
    )

    #expect(liftedTop.frame.origin == baselineTop.frame.origin)
    #expect(liftedTop.frame.height == baselineTop.frame.height)
    #expect(liftedTop.alpha == 0)
    #expect(
      projectedSecond.frame.minY - (liftedTop.frame.minY + 3)
        == TerminalSidebarLayout.tabRowSpacing
    )
    #expect(projectedSecond.frame.size == baselineTop.frame.size)
    #expect(projectedSecond.frame != baselineSecond.frame)
    #expect(
      draggingTop.semanticTargets.first { $0.path == middlePath }?.frame
        == baseline.items.first { $0.id == .tab(tabs[2]) }?.frame
    )
    #expect(
      draggingBottom.semanticTargets.first { $0.path == upperPath }?.frame
        == baseline.items.first { $0.id == .tab(tabs[1]) }?.frame
    )
    #expect(projectedMiddle.frame != baseline.items.first { $0.id == .tab(tabs[2]) }?.frame)
  }

  @Test
  func liftedOrdinaryTabsKeepFullAttributesAndReserveThreePointsEach() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let tail = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [first, second, tail].map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(first), .tab(second)],
      preferredHeights: [
        .tab(first): 30,
        .tab(second): 50,
        .tab(tail): 41,
      ]
    )
    let firstSource = try #require(plan.items.first { $0.id == .tab(first) })
    let secondSource = try #require(plan.items.first { $0.id == .tab(second) })
    let projectedTail = try #require(plan.items.first { $0.id == .tab(tail) })

    #expect(firstSource.frame.height == 30)
    #expect(secondSource.frame.height == 50)
    #expect(firstSource.alpha == 0)
    #expect(secondSource.alpha == 0)
    #expect(secondSource.frame.minY == firstSource.frame.minY + 3)
    #expect(
      projectedTail.frame.minY - (secondSource.frame.minY + 3)
        == TerminalSidebarLayout.tabRowSpacing
    )
    #expect(
      !plan.semanticTargets.contains { target in
        switch target.path {
        case .rootItem(_, _, let id): id == .tab(first) || id == .tab(second)
        case .rootBoundary, .groupEntry, .groupItem, .groupBoundary: false
        }
      }
    )
  }

  @Test
  func naturalRowTargetsUseTheWholeCandidateFrameInBothDirections() throws {
    let tabs = (0..<4).map { _ in TerminalTabID() }
    let outline = TerminalSidebarTestFixture.outline(
      roots: tabs.map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 1
    )
    let baseline = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let downward = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(tabs[0])]
    )
    let upward = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(tabs[3])]
    )
    let downwardPath = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 1,
      id: .tab(tabs[1])
    )
    let upwardPath = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 2,
      id: .tab(tabs[2])
    )
    let downwardFrame = try #require(baseline.items.first { $0.id == .tab(tabs[1]) }?.frame)
    let upwardFrame = try #require(baseline.items.first { $0.id == .tab(tabs[2]) }?.frame)

    #expect(downward.semanticTarget(at: downwardFrame.minY + 1)?.path == downwardPath)
    #expect(downward.semanticTarget(at: downwardFrame.midY)?.path == downwardPath)
    #expect(downward.semanticTarget(at: downwardFrame.maxY - 1)?.path == downwardPath)
    #expect(upward.semanticTarget(at: upwardFrame.minY + 1)?.path == upwardPath)
    #expect(upward.semanticTarget(at: upwardFrame.midY)?.path == upwardPath)
    #expect(upward.semanticTarget(at: upwardFrame.maxY - 1)?.path == upwardPath)
  }

  @Test
  func liftedWholeGroupCollapsesItsSurfaceAndKeepsTargetsOnDisplayedRows() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let tail = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .orange, .automatic, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
      ],
      revision: 1
    )
    let baseline = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let lifted = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.group(groupID), .tab(first), .tab(second)]
    )
    let sourceIDs: Set<TerminalSidebarEntryID> = [
      .group(groupID), .tab(first), .tab(second),
    ]
    let naturalGroupFrame = try #require(
      baseline.items.first { $0.id == .group(groupID) }?.frame
    )
    let projectedTail = try #require(lifted.items.first { $0.id == .tab(tail) })
    let tailPath = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 1,
      id: .tab(tail)
    )

    #expect(
      lifted.items.filter { sourceIDs.contains($0.id) }.allSatisfy {
        $0.frame.height == 0 && $0.alpha == 0
      }
    )
    #expect(projectedTail.frame == naturalGroupFrame)
    #expect(!lifted.groups.contains { $0.id == groupID })
    #expect(
      lifted.semanticTargets.first { $0.path == tailPath }?.frame
        == projectedTail.frame
    )
  }

  @Test
  func committedTabSettlementKeepsFinalGeometryHiddenUnderThePreview() throws {
    let first = TerminalTabID()
    let moved = TerminalTabID()
    let last = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [first, moved, last].map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 2
    )
    let baseline = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let settlement = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(moved)],
      dragPhase: .committedSettlement
    )
    let baselineItem = try #require(baseline.items.first { $0.id == .tab(moved) })
    let settlementItem = try #require(settlement.items.first { $0.id == .tab(moved) })
    let sourceFrame = CGRect(x: 12, y: 200, width: 180, height: 45)
    let targetFrame = try #require(
      TerminalSidebarDropSettlementGeometry.resolve(
        source: .tabs([moved]),
        liftedEntryIDs: [.tab(moved)],
        sourceFrame: sourceFrame,
        plan: settlement
      )?.frame
    )

    #expect(settlementItem.frame == baselineItem.frame)
    #expect(settlementItem.alpha == 0)
    #expect(settlement.dropPlaceholderFrame == nil)
    #expect(targetFrame.midY == baselineItem.frame.midY)
    #expect(targetFrame.size == sourceFrame.size)
  }

  @Test
  func committedGroupSettlementKeepsItsFinalSurfaceHiddenUnderThePreview() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let tail = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(tail), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .green, .automatic, [first, second]),
          isPinned: false
        ),
      ],
      revision: 2
    )
    let sourceIDs: [TerminalSidebarEntryID] = [
      .group(groupID), .tab(first), .tab(second),
    ]
    let baseline = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let settlement = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: sourceIDs,
      dragPhase: .committedSettlement
    )
    let baselineGroup = try #require(baseline.groups.first { $0.id == groupID })
    let settlementGroup = try #require(settlement.groups.first { $0.id == groupID })
    let sourceFrame = CGRect(x: 12, y: 200, width: 180, height: 130)
    let targetFrame = try #require(
      TerminalSidebarDropSettlementGeometry.resolve(
        source: .group(groupID),
        liftedEntryIDs: sourceIDs,
        sourceFrame: sourceFrame,
        plan: settlement
      )?.frame
    )

    #expect(settlementGroup.frame == baselineGroup.frame)
    #expect(settlementGroup.alpha == 0)
    #expect(
      settlement.items.filter { sourceIDs.contains($0.id) }.allSatisfy {
        $0.frame.height > 0 && $0.alpha == 0
      }
    )
    #expect(targetFrame.midY == baselineGroup.frame.midY)
    #expect(targetFrame.size == sourceFrame.size)
  }

  @Test
  func collapsedContentHeightStaysPinnedUntilItReentersTheScrollRange() {
    var state = TerminalSidebarContentHeightState()
    state.begin(at: 500)

    #expect(state.resolve(actualHeight: 300) == 500)

    state.finish()

    #expect(state.resolve(actualHeight: 300) == 500)
    let stayedPinned = !state.clearPin(
      actualHeight: 300,
      visibleRect: CGRect(x: 0, y: 200, width: 220, height: 200)
    )
    let clearedPin = state.clearPin(
      actualHeight: 300,
      visibleRect: CGRect(x: 0, y: 100, width: 220, height: 200)
    )

    #expect(stayedPinned)
    #expect(clearedPin)
    #expect(state.resolve(actualHeight: 300) == 300)

    state.begin(at: 500)
    state.finish()
    let stayedPinnedPastTheRealRange = !state.clearPin(
      actualHeight: 600,
      visibleRect: CGRect(x: 0, y: 450, width: 220, height: 200)
    )
    let clearedAtTheRealRange = state.clearPin(
      actualHeight: 600,
      visibleRect: CGRect(x: 0, y: 400, width: 220, height: 200)
    )

    #expect(stayedPinnedPastTheRealRange)
    #expect(clearedAtTheRealRange)
  }

  @Test
  func boundaryBetweenAdjacentGroupsKeepsNaturalTargetGeometry() throws {
    let firstChild = TerminalTabID()
    let secondChild = TerminalTabID()
    let source = TerminalTabID()
    let firstGroup = TerminalTabGroupID()
    let secondGroup = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(firstGroup, .blue, .automatic, [firstChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .group(secondGroup, .green, .automatic, [secondChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let path = TerminalSidebarSemanticPath.rootBoundary(lane: .regular, index: 1)
    let target = try #require(
      TerminalSidebarDropPlanner.plan(payload: payload, path: path, outline: outline)
    )
    let baseline = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )
    let projected = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      target: target
    )
    let placeholder = try #require(projected.dropPlaceholderFrame)
    let baselineMap = TerminalSidebarDropTargetMap(targets: baseline.semanticTargets)
    let projectedMap = TerminalSidebarDropTargetMap(targets: projected.semanticTargets)

    #expect(target.destination == .root(isPinned: false, index: 1))
    expectNoDifference(projectedMap.targets, baseline.semanticTargets)
    #expect(
      projectedMap.semanticTarget(at: placeholder.midY)
        == baselineMap.semanticTarget(at: placeholder.midY)
    )
    #expect(
      projectedMap.semanticTarget(at: placeholder.minY + 1)
        == baselineMap.semanticTarget(at: placeholder.minY + 1)
    )
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
      plan.semanticTargets.first {
        $0.path == .rootItem(lane: .regular, index: 0, id: .tab(root))
      }
    )
    let childTarget = try #require(
      plan.semanticTargets.first {
        $0.path == .groupItem(groupID, index: 0, id: child)
      }
    )
    let childEndTarget = try #require(
      plan.semanticTargets.first { $0.path == .groupBoundary(groupID, index: 1) }
    )

    #expect(rootTarget.frame.minY == rootFrame.minY)
    #expect(rootTarget.frame.height == rootFrame.height)
    #expect(childTarget.frame == childFrame)
    #expect(childEndTarget.frame.minY == childFrame.maxY)
    #expect(
      childEndTarget.frame.maxY
        == childFrame.maxY + TerminalSidebarLayoutPlan.rootBoundaryTargetHeight
    )
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
    let target = try #require(
      plan.semanticTargets.first {
        $0.path == .rootItem(lane: .regular, index: 0, id: .group(groupID))
      }
    )

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

    for (rootIndex, groupID) in [collapsedGroup, emptyGroup].enumerated() {
      let header = plan.items.first { $0.id == .group(groupID) }?.frame
      let groupTarget = plan.semanticTargets.first { $0.path == .groupEntry(groupID) }
      #expect(groupTarget?.frame.height == 19)
      let bottom = plan.semanticTargets.first {
        $0.path == .rootBoundary(lane: .regular, index: rootIndex + 1)
          && $0.frame.minY == header?.midY.rounded(.up)
      }
      #expect(bottom?.frame.height == 18)
    }
  }

  @Test
  func collapsedGroupHeaderRemainsAWholeGroupCandidate() throws {
    let targetChild = TerminalTabID()
    let sourceChild = TerminalTabID()
    let targetGroup = TerminalTabGroupID()
    let sourceGroup = TerminalTabGroupID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(targetGroup, .orange, .automatic, [targetChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .group(sourceGroup, .blue, .automatic, [sourceChild]),
          isPinned: false
        ),
      ],
      revision: 1,
      collapsedGroupIDs: [targetGroup]
    )
    let payload = try #require(outline.dragPayload(for: .group(sourceGroup)))
    let path = TerminalSidebarSemanticPath.rootItem(
      lane: .regular,
      index: 0,
      id: .group(targetGroup)
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.group(sourceGroup), .tab(sourceChild)]
    )
    let header = try #require(plan.items.first { $0.id == .group(targetGroup) }?.frame)

    #expect(plan.semanticTarget(at: header.minY + 8)?.path == path)
    #expect(TerminalSidebarDropPlanner.plan(payload: payload, path: path, outline: outline) != nil)
  }

  @Test
  func dragSourceGeometryCarriesTheCompositeGapHeight() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [first, second].map {
        TerminalSidebarOutline.Root(content: .tab($0), isPinned: false)
      },
      revision: 1
    )
    let payload = try #require(
      outline.dragPayload(
        for: .tab(first),
        selectedTabIDs: [first, second]
      )
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      preferredHeights: [.tab(first): 30, .tab(second): 50]
    )
    let geometry = try #require(
      TerminalSidebarDragSourceGeometry.resolve(
        payload: payload,
        liftedEntryIDs: [.tab(first), .tab(second)],
        anchorEntryID: .tab(first),
        plan: plan
      )
    )

    #expect(geometry.dropGapHeight == 82)
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
    let baseline = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)
    let sourceFrame = try #require(plan.items.first { $0.id == .tab(source) }?.frame)
    let divider = try #require(plan.items.first { $0.id == .pinDivider }?.frame)
    let naturalDivider = try #require(
      baseline.items.first { $0.id == .pinDivider }?.frame
    )
    let regularGroupFrame = try #require(plan.groups.first { $0.id == regularGroupID }?.frame)
    let trailingTarget = try #require(
      plan.semanticTargets.first {
        $0.path == .rootBoundary(lane: .regular, index: 1)
      }
    )

    #expect(sourceFrame.height == 37)
    #expect(
      divider.minY - childFrame.maxY
        == 3 + TerminalSidebarLayoutPlan.pinDividerTopSpacing
    )
    #expect(
      regularGroupFrame.minY - divider.maxY == TerminalSidebarLayout.tabRowSpacing
    )
    #expect(
      plan.semanticTarget(at: naturalDivider.midY)?.path
        == .rootBoundary(lane: .pinned, index: 2)
    )
    #expect(
      plan.semanticTarget(at: trailingTarget.frame.minY + 1)?.path
        == .rootBoundary(lane: .regular, index: 1)
    )
    #expect(
      !plan.semanticTargets.contains {
        $0.path == .rootBoundary(lane: .pinned, index: 1)
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
    let trailingPath = TerminalSidebarSemanticPath.rootBoundary(
      lane: .regular,
      index: tabs.count
    )
    let trailingTarget = try #require(
      plan.semanticTargets.first { $0.path == trailingPath }
    )
    let payload = try #require(outline.dragPayload(for: .tab(tabs[0])))
    let dropPlan = TerminalSidebarDropPlanner.plan(
      payload: payload,
      path: trailingPath,
      outline: outline
    )

    #expect(plan.contentSize.height > viewportHeight)
    #expect(plan.items.map(\.id) == tabs.map(TerminalSidebarEntryID.tab) + [.newTab])
    #expect(trailingTarget.frame.minY == lastFrame.maxY)
    #expect(newTabFrame.minY > trailingTarget.frame.minY)
    #expect(plan.semanticTarget(at: trailingTarget.frame.minY + 1)?.path == trailingPath)
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

    #expect(
      !plan.semanticTargets.contains {
        $0.path == .rootItem(lane: .regular, index: 1, id: .tab(source))
      }
    )
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
      path: .rootBoundary(lane: .regular, index: 0),
      frame: CGRect(x: 0, y: 0, width: 100, height: 10)
    )
    let second = TerminalSidebarSemanticTarget(
      path: .rootItem(lane: .regular, index: 0, id: .tab(TerminalTabID())),
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
