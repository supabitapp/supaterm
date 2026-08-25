import CoreGraphics
import SupaTheme
import Testing

@testable import supaterm

struct TerminalSidebarLayoutPlanTests {
  @Test
  func visibleEntriesPreserveDepthFirstOrderAndDurableEmptyProjects() {
    let pinned = TerminalTabID()
    let first = TerminalTabID()
    let second = TerminalTabID()
    let populatedProject = TerminalProjectID()
    let emptyProject = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(pinned), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .project(populatedProject, .blue, [first, second]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .project(emptyProject, .neutral, []),
          isPinned: false
        ),
      ],
      revision: 4
    )

    #expect(
      outline.visibleEntries.map(\.id) == [
        .tab(pinned),
        .pinDivider,
        .project(populatedProject),
        .tab(first),
        .tab(second),
        .project(emptyProject),
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
    let projectID = TerminalProjectID()
    let viewportHeight: CGFloat = 300
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [first, second]),
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
        .project(projectID, index: 0),
        .project(projectID, index: 1),
        .project(projectID, index: 2),
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
  func expandedProjectLastChildLowerHalfTargetsProjectEnd() throws {
    let first = TerminalTabID()
    let last = TerminalTabID()
    let source = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [first, last]),
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
      plan.semanticTargets.first { $0.path == .project(projectID, index: 2) }
    )

    #expect(plan.semanticTarget(at: lastFrame.midY - 1)?.path == .project(projectID, index: 1))
    #expect(plan.semanticTarget(at: lastFrame.midY + 1)?.path == .project(projectID, index: 2))
    #expect(endTarget.frame.maxY == lastFrame.maxY + TerminalSidebarLayoutPlan.expandedProjectTrailingSpacing)
  }

  @Test
  func projectEndDropProjectsPlaceholderIntoProjectSurface() throws {
    let first = TerminalTabID()
    let last = TerminalTabID()
    let source = TerminalTabID()
    let tail = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [first, last]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .unassigned([source, tail]), isPinned: false),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let target = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: .project(projectID, index: 2),
        outline: outline
      )
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      target: target
    )
    let placeholder = try #require(plan.dropPlaceholderFrame)
    let project = try #require(plan.projects.first { $0.id == projectID })
    let tailFrame = try #require(plan.items.first { $0.id == .tab(tail) }?.frame)

    #expect(project.frame.maxY == placeholder.maxY + TerminalSidebarLayout.projectSurfaceOverflow)
    #expect(project.frame.contains(CGPoint(x: placeholder.midX, y: placeholder.midY)))
    #expect(tailFrame.minY > project.frame.maxY)
  }

  @Test
  func upwardRootDropKeepsItsProjectedGapTargetable() throws {
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
        path: .rootBoundary(index: 0, affinity: .before),
        outline: outline
      )
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)],
      target: target
    )
    let placeholder = try #require(plan.dropPlaceholderFrame)
    let rawMap = TerminalSidebarDropTargetMap(targets: plan.semanticTargets)
    let projectedMap = TerminalSidebarDropTargetMap(plan: plan, activePath: target.path)

    #expect(rawMap.semanticTarget(at: placeholder.midY) == nil)
    #expect(projectedMap.semanticTarget(at: placeholder.midY)?.path == target.path)
  }

  @Test
  func boundaryBetweenAdjacentProjectsOwnsItsProjectedGap() throws {
    let firstChild = TerminalTabID()
    let secondChild = TerminalTabID()
    let source = TerminalTabID()
    let firstProject = TerminalProjectID()
    let secondProject = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(firstProject, .blue, [firstChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .project(secondProject, .green, [secondChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 3
    )
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let path = TerminalSidebarSemanticPath.rootBoundary(index: 0, affinity: .after)
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
    let staleMap = TerminalSidebarDropTargetMap(targets: baseline.semanticTargets)
    let projectedMap = TerminalSidebarDropTargetMap(plan: projected, activePath: path)

    #expect(target.destination == .root(isPinned: false, index: 1))
    #expect(staleMap.semanticTarget(at: placeholder.midY)?.path == .rootItem(index: 1))
    #expect(projectedMap.semanticTarget(at: placeholder.midY)?.path == path)
  }

  @Test
  func variableRowsDriveTargetsWithoutFrozenIndices() throws {
    let root = TerminalTabID()
    let child = TerminalTabID()
    let source = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .project(projectID, .purple, [child]),
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
      plan.semanticTargets.first { $0.path == .project(projectID, index: 0) }
    )
    let childEndTarget = try #require(
      plan.semanticTargets.first { $0.path == .project(projectID, index: 1) }
    )

    #expect(rootTarget.frame.minY == rootFrame.minY)
    #expect(rootTarget.frame.height == rootFrame.height)
    #expect(childTarget.frame == CGRect(x: 0, y: childFrame.minY, width: 220, height: 36.5))
    #expect(childEndTarget.frame.minY == childFrame.midY)
    #expect(childEndTarget.frame.maxY == childFrame.maxY + TerminalSidebarLayoutPlan.expandedProjectTrailingSpacing)
  }

  @Test
  func compactProjectHeaderKeepsTargetsWithinItsFrame() throws {
    let child = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      preferredHeights: [.project(projectID): TerminalSidebarLayout.tabRowMinHeight]
    )
    let header = try #require(plan.items.first { $0.id == .project(projectID) }?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)
    let target = try #require(plan.semanticTargets.first { $0.path == .rootItem(index: 0) })

    #expect(header.height == TerminalSidebarLayout.tabRowMinHeight)
    #expect(childFrame.minY - header.maxY == TerminalSidebarLayout.tabRowSpacing)
    #expect(target.frame.maxY <= header.maxY)
  }

  @Test
  func projectedTabRevealIncludesItsProjectSurface() throws {
    let child = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .yellow, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let childEntry = try #require(outline.visibleEntries.first { $0.id == .tab(child) })
    let projectFrame = try #require(plan.projects.first?.frame)

    #expect(plan.revealFrame(for: childEntry) == projectFrame)
  }

  @Test
  func collapsedProjectSurfaceKeepsCompactOverflow() throws {
    let child = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .yellow, [child]),
          isPinned: false
        )
      ],
      revision: 1,
      collapsedProjectIDs: [projectID]
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let headerFrame = try #require(plan.items.first { $0.id == .project(projectID) }?.frame)
    let projectFrame = try #require(plan.projects.first?.frame)

    #expect(projectFrame.maxY - headerFrame.maxY == TerminalSidebarLayout.projectSurfaceOverflow)
  }

  @Test
  func collapsedAndEmptyProjectsSplitOneHeaderIntoTopAndBottomTargets() {
    let collapsedChild = TerminalTabID()
    let source = TerminalTabID()
    let collapsedProject = TerminalProjectID()
    let emptyProject = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(collapsedProject, .orange, [collapsedChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(
          content: .project(emptyProject, .neutral, []),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
      ],
      revision: 8,
      collapsedProjectIDs: [collapsedProject]
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )

    for (projectID, insertionIndex) in [(collapsedProject, 1), (emptyProject, 0)] {
      let targets = plan.semanticTargets.filter {
        switch $0.path {
        case .rootBoundary, .project(projectID, _): true
        case .rootItem, .project, .unassigned, .unassignedHeader, .pinnedEnd, .trailingRoot:
          false
        }
      }
      let projectTarget = targets.first {
        guard case .project(projectID, insertionIndex) = $0.path else { return false }
        return true
      }
      #expect(projectTarget?.frame.height == 19)
      let bottom = plan.semanticTargets.first {
        guard case .rootBoundary(let index, .after) = $0.path else { return false }
        return outline.roots[index].id == .project(projectID)
      }
      #expect(bottom?.frame.height == 18)
    }
  }

  @Test
  func pinDividerWinsBeforeExpandedExitAndTrailingOwnsTheSpaceAboveThePinnedControl() throws {
    let child = TerminalTabID()
    let source = TerminalTabID()
    let regularChild = TerminalTabID()
    let projectID = TerminalProjectID()
    let regularProjectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [child]),
          isPinned: true
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: true),
        TerminalSidebarOutline.Root(
          content: .project(regularProjectID, .green, [regularChild]),
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
    let regularProjectFrame = try #require(plan.projects.first { $0.id == regularProjectID }?.frame)
    let trailingTarget = try #require(
      plan.semanticTargets.first { $0.path == .trailingRoot }
    )

    #expect(
      divider.minY - childFrame.maxY == TerminalSidebarLayoutPlan.pinDividerTopSpacing
    )
    #expect(
      regularProjectFrame.minY - divider.maxY == TerminalSidebarLayout.tabRowSpacing
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
  func sourceTargetsAreExcludedAndProjectSurfacesDoNotOverlap() throws {
    let firstChild = TerminalTabID()
    let source = TerminalTabID()
    let secondChild = TerminalTabID()
    let firstProject = TerminalProjectID()
    let secondProject = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(firstProject, .blue, [firstChild]),
          isPinned: false
        ),
        TerminalSidebarOutline.Root(content: .tab(source), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .project(secondProject, .green, [secondChild]),
          isPinned: false
        ),
      ],
      revision: 2
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(
      outline: outline,
      draggingItemIDs: [.tab(source)]
    )
    let firstFrame = try #require(plan.projects.first { $0.id == firstProject }?.frame)
    let secondFrame = try #require(plan.projects.first { $0.id == secondProject }?.frame)

    #expect(!plan.semanticTargets.contains { $0.path == .rootItem(index: 1) })
    #expect(secondFrame.minY > firstFrame.maxY)
  }

  @Test
  func projectHoverFrameContainsHeaderAndChildren() throws {
    let child = TerminalTabID()
    let projectID = TerminalProjectID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline)
    let projectFrame = try #require(plan.projects.first?.frame)
    let headerFrame = try #require(plan.items.first { $0.id == .project(projectID) }?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)

    #expect(plan.projectID(at: CGPoint(x: projectFrame.midX, y: headerFrame.midY)) == projectID)
    #expect(plan.projectID(at: CGPoint(x: projectFrame.midX, y: childFrame.midY)) == projectID)
    #expect(plan.projectID(at: CGPoint(x: projectFrame.maxX + 1, y: childFrame.midY)) == nil)
  }

  @Test
  func projectedTabsIndentTheirContentWithoutShiftingTrailingAccessories() throws {
    let root = TerminalTabID()
    let child = TerminalTabID()
    let projectID = TerminalProjectID()
    let width: CGFloat = 220
    let outline = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .project(projectID, .blue, [child]),
          isPinned: false
        ),
      ],
      revision: 1
    )
    let plan = TerminalSidebarTestFixture.layoutPlan(outline: outline, width: width)
    let rootFrame = try #require(plan.items.first { $0.id == .tab(root) }?.frame)
    let projectFrame = try #require(plan.projects.first?.frame)
    let childFrame = try #require(plan.items.first { $0.id == .tab(child) }?.frame)

    #expect(rootFrame.minX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(width - rootFrame.maxX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(projectFrame.minX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(width - projectFrame.maxX == TerminalSidebarLayout.visibleHorizontalInset)
    #expect(childFrame.minX == rootFrame.minX)
    #expect(childFrame.maxX == rootFrame.maxX)
    #expect(childFrame.minX == width - childFrame.maxX)

    let rootContentInsets = TerminalSidebarLayout.tabContentHorizontalInsets(isProjected: false)
    let childContentInsets = TerminalSidebarLayout.tabContentHorizontalInsets(isProjected: true)
    #expect(
      childContentInsets.leading - rootContentInsets.leading
        == TerminalSidebarLayout.projectedTabIndent
    )
    #expect(childContentInsets.trailing == rootContentInsets.trailing)

    let childSurfaceFrame = TerminalSidebarLayout.tabSurfaceFrame(
      in: childFrame,
      isProjected: true
    )
    #expect(childSurfaceFrame.minX - projectFrame.minX == TerminalSidebarLayout.projectedTabIndent)
    #expect(projectFrame.maxX - childSurfaceFrame.maxX == TerminalSidebarLayout.projectSurfaceOverflow)
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
