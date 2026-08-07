import AppKit
import CoreGraphics
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarLayoutTests {
  @Test
  func scrollViewportClearsTrafficLightsWithoutContentInsets() throws {
    let controller = TerminalSidebarListController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry()
    )
    controller.view.frame = CGRect(x: 0, y: 0, width: 280, height: 160)
    controller.view.layoutSubtreeIfNeeded()
    let scrollView = try #require(
      controller.view.subviews.compactMap { $0 as? TerminalSidebarScrollView }.first
    )
    let pinnedNewTabView = try #require(
      controller.view.subviews.compactMap { $0 as? TerminalSidebarPinnedControlView }.first
    )
    let viewportTopInset = controller.view.bounds.maxY - scrollView.frame.maxY
    let trafficLightBottom =
      WindowTrafficLightMetrics.edgePadding + WindowTrafficLightMetrics.buttonSize

    #expect(viewportTopInset - trafficLightBottom == TerminalSidebarLayout.trafficLightGap)
    #expect(!scrollView.automaticallyAdjustsContentInsets)
    #expect(scrollView.contentInsets.top == 0)
    #expect(scrollView.contentInsets.bottom == 0)
    #expect(pinnedNewTabView.isHidden)
    #expect(scrollView.frame.minY == controller.view.bounds.minY)
  }

  @Test
  func pinnedNewTabReservesTheViewportAndRecalculatesOnResize() throws {
    let controlHeight = TerminalSidebarLayout.pinnedControlHeight
    let initialBounds = CGRect(x: 0, y: 0, width: 280, height: 400)
    let initial = TerminalSidebarViewportLayout(
      bounds: initialBounds,
      pinnedControlHeight: controlHeight
    )
    let resized = TerminalSidebarViewportLayout(
      bounds: CGRect(x: 0, y: 0, width: 360, height: 480),
      pinnedControlHeight: controlHeight
    )
    let withoutPinnedControl = TerminalSidebarViewportLayout(
      bounds: initialBounds,
      pinnedControlHeight: 0
    )
    let shortTab = TerminalTabID()
    let shortList = TerminalSidebarTestFixture.layoutPlan(
      outline: TerminalSidebarTestFixture.outline(
        roots: [TerminalSidebarOutline.Root(content: .tab(shortTab), isPinned: false)],
        revision: 1
      ),
      viewportHeight: initial.scrollViewportFrame.height
    )
    let tabs = (0..<12).map { _ in TerminalTabID() }
    let longList = TerminalSidebarTestFixture.layoutPlan(
      outline: TerminalSidebarTestFixture.outline(
        roots: tabs.map { TerminalSidebarOutline.Root(content: .tab($0), isPinned: false) },
        revision: 1
      ),
      viewportHeight: initial.scrollViewportFrame.height
    )
    let lastFrame = try #require(longList.items.first { $0.id == .newTab }?.frame)
    let maximumScrollY = max(
      0,
      longList.contentSize.height - initial.scrollViewportFrame.height
    )
    let lastRowScrollY = min(
      max(0, lastFrame.maxY - initial.scrollViewportFrame.height),
      maximumScrollY
    )
    let lastRowViewport = CGRect(
      x: 0,
      y: lastRowScrollY,
      width: initial.scrollViewportFrame.width,
      height: initial.scrollViewportFrame.height
    )

    #expect(controlHeight == 40)
    #expect(initial.pinnedControlFrame.height == controlHeight)
    #expect(initial.scrollViewportFrame.minY == initial.pinnedControlFrame.maxY)
    #expect(!initial.scrollViewportFrame.intersects(initial.pinnedControlFrame))
    #expect(withoutPinnedControl.pinnedControlFrame.height == 0)
    #expect(withoutPinnedControl.scrollViewportFrame.minY == initialBounds.minY)
    #expect(resized.pinnedControlFrame.height == controlHeight)
    #expect(resized.scrollViewportFrame.width == 360)
    #expect(resized.scrollViewportFrame.height > initial.scrollViewportFrame.height)
    #expect(shortList.contentSize.height < initial.scrollViewportFrame.height)
    #expect(longList.contentSize.height > initial.scrollViewportFrame.height)
    #expect(lastRowViewport.contains(lastFrame))
  }

  @Test
  func newTabFlowsUntilItCrossesTheVisibleBottom() {
    let visibleRect = CGRect(x: 0, y: 0, width: 280, height: 180)
    let inlineFrame = CGRect(x: 0, y: 120, width: 280, height: 37)
    let overflowingFrame = CGRect(x: 0, y: 170, width: 280, height: 37)
    let pinnedVisibleRect = CGRect(x: 0, y: 0, width: 280, height: 140)
    let scrolledPinnedVisibleRect = CGRect(x: 0, y: 44, width: 280, height: 140)

    #expect(
      !TerminalSidebarNewTabPlacement.shouldPin(
        itemFrame: inlineFrame,
        visibleRect: visibleRect,
        pinnedHeight: TerminalSidebarLayout.pinnedControlHeight,
        isPinned: false
      )
    )
    #expect(
      TerminalSidebarNewTabPlacement.shouldPin(
        itemFrame: overflowingFrame,
        visibleRect: visibleRect,
        pinnedHeight: TerminalSidebarLayout.pinnedControlHeight,
        isPinned: false
      )
    )
    #expect(
      TerminalSidebarNewTabPlacement.shouldPin(
        itemFrame: overflowingFrame,
        visibleRect: pinnedVisibleRect,
        pinnedHeight: TerminalSidebarLayout.pinnedControlHeight,
        isPinned: true
      )
    )
    #expect(
      !TerminalSidebarNewTabPlacement.shouldPin(
        itemFrame: overflowingFrame,
        visibleRect: scrolledPinnedVisibleRect,
        pinnedHeight: TerminalSidebarLayout.pinnedControlHeight,
        isPinned: true
      )
    )
  }

  @Test
  func collectionLayoutInvalidatesForViewportResize() {
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 220, height: 180))
    let layout = TerminalSidebarCollectionLayout()
    collectionView.collectionViewLayout = layout
    layout.prepare()

    #expect(!layout.shouldInvalidateLayout(forBoundsChange: collectionView.bounds))
    #expect(
      layout.shouldInvalidateLayout(
        forBoundsChange: CGRect(x: 0, y: 0, width: 221, height: 180)
      )
    )
    #expect(
      layout.shouldInvalidateLayout(
        forBoundsChange: CGRect(x: 0, y: 0, width: 220, height: 181)
      )
    )
  }

  @Test
  func topEntriesKeepAFixedGapBelowTheDocumentTop() throws {
    let root = TerminalTabID()
    let child = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let rootFirst = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(root), isPinned: false),
        TerminalSidebarOutline.Root(
          content: .group(groupID, .yellow, .automatic, [child]),
          isPinned: false
        ),
      ],
      revision: 1
    )
    let groupFirst = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .yellow, .automatic, [child]),
          isPinned: false
        )
      ],
      revision: 1
    )
    let rootFirstPlan = TerminalSidebarTestFixture.layoutPlan(outline: rootFirst)
    let groupFirstPlan = TerminalSidebarTestFixture.layoutPlan(outline: groupFirst)
    let rootFrame = try #require(rootFirstPlan.items.first { $0.id == .tab(root) }?.frame)
    let groupFrame = try #require(groupFirstPlan.groups.first?.frame)

    #expect(rootFrame.minY == 12)
    #expect(groupFrame.minY == 10)
  }

  @Test
  func spaceSwitcherResolvesSelectedSpace() throws {
    let first = TerminalSpaceItem(id: TerminalSpaceID(), name: "First")
    let second = TerminalSpaceItem(id: TerminalSpaceID(), name: "Second")

    let presentation = try #require(
      TerminalSpaceSwitcherPresentation(
        spaces: [first, second],
        selectedSpaceID: second.id
      )
    )

    #expect(presentation.selectedSpace == second)
    #expect(presentation.canDelete)
  }

  @Test
  func spaceSwitcherAlignsWithTrafficLightCenters() {
    let trafficLightCenter =
      WindowTrafficLightMetrics.edgePadding + WindowTrafficLightMetrics.buttonSize / 2
    let switcherCenter =
      TerminalWindowHeaderMetrics.switcherTopPadding
      + TerminalWindowHeaderMetrics.switcherHeight / 2

    #expect(switcherCenter == trafficLightCenter)
  }

  @Test
  func spaceSwitcherUsesEffectiveSpaceShortcuts() {
    let bindings = (0..<4).map {
      TerminalSpaceSwitcherPresentation.shortcutBinding(
        forSpaceAt: $0,
        overrides: [:]
      )?.display
    }

    #expect(bindings == ["⌃1", "⌃2", "⌃3", "⌃4"])
  }

  @Test
  func spaceSwitcherOmitsDisabledAndOutOfRangeShortcuts() {
    #expect(
      TerminalSpaceSwitcherPresentation.shortcutBinding(
        forSpaceAt: 0,
        overrides: [.selectSpace(1): .disabled]
      ) == nil
    )
    #expect(
      TerminalSpaceSwitcherPresentation.shortcutBinding(
        forSpaceAt: 10,
        overrides: [:]
      ) == nil
    )
  }

  @Test
  func spaceSwitcherDisablesDeletingOnlySpace() throws {
    let space = TerminalSpaceItem(id: TerminalSpaceID(), name: "Only")

    let presentation = try #require(
      TerminalSpaceSwitcherPresentation(
        spaces: [space],
        selectedSpaceID: space.id
      )
    )

    #expect(!presentation.canDelete)
  }

  @Test
  func spaceSwitcherRejectsMissingSelection() {
    let space = TerminalSpaceItem(id: TerminalSpaceID(), name: "Only")

    #expect(
      TerminalSpaceSwitcherPresentation(
        spaces: [space],
        selectedSpaceID: TerminalSpaceID()
      ) == nil
    )
  }
}
