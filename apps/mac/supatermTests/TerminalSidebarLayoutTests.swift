import AppKit
import ComposableArchitecture
import CoreGraphics
import SupaTheme
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarLayoutTests {
  private struct ReorderFrames {
    let source: CGRect
    let transition: CGRect
    let target: CGRect
  }

  @Test
  func programmaticReorderInterpolatesRetainedRowGeometry() throws {
    let frames = try programmaticReorderFrames(reduceMotion: false)

    #expect(frames.source != frames.target)
    #expect(frames.transition == frames.source)
  }

  @Test
  func programmaticReorderIsImmediateWithReduceMotion() throws {
    let frames = try programmaticReorderFrames(reduceMotion: true)

    #expect(frames.source != frames.target)
    #expect(frames.transition == frames.target)
  }

  @Test
  func programmaticReorderStopsWhenReduceMotionTurnsOn() throws {
    let frames = try programmaticReorderFrames(
      reduceMotion: false,
      stopWithReduceMotion: true
    )

    #expect(frames.source != frames.target)
    #expect(frames.transition == frames.target)
  }

  private func programmaticReorderFrames(
    reduceMotion: Bool,
    stopWithReduceMotion: Bool = false
  ) throws -> ReorderFrames {
    let firstTab = TerminalTabItem(title: "First")
    let secondTab = TerminalTabItem(title: "Second")
    let source = TerminalSidebarTestFixture.outline(
      roots: [firstTab, secondTab].map {
        TerminalSidebarOutline.Root(content: .tab($0.id), isPinned: false)
      },
      revision: 1
    )
    let target = TerminalSidebarTestFixture.outline(
      roots: [secondTab, firstTab].map {
        TerminalSidebarOutline.Root(content: .tab($0.id), isPinned: false)
      },
      revision: 2
    )
    let rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [
      .tab(firstTab.id): .tab(tabPresentation(firstTab)),
      .tab(secondTab.id): .tab(tabPresentation(secondTab)),
      .newTab: .newTab(.inline),
    ]
    let terminal = TerminalHostState(managesTerminalSurfaces: false)
    let store = Store(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }
    let controller = TerminalSidebarListController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry(),
      captureRequest: { nil }
    )
    controller.view.frame = CGRect(x: 0, y: 0, width: 280, height: 300)

    func context(for outline: TerminalSidebarOutline) -> TerminalSidebarRowContext {
      TerminalSidebarRowContext(
        store: store,
        terminal: terminal,
        palette: Palette(colorScheme: .dark, backgroundSeed: testBackgroundSeed(for: .dark)),
        renameState: controller.renameState,
        groupHeaderHoverState: controller.groupHeaderHoverState,
        tabSelectionState: controller.tabSelectionState,
        outline: outline,
        fixedHoveredGroupID: nil,
        actions: rowActions
      )
    }

    controller.apply(
      outline: source,
      rows: rows,
      context: context(for: source),
      selectedTabID: firstTab.id,
      reduceMotion: reduceMotion
    )
    controller.view.layoutSubtreeIfNeeded()
    let scrollView = try #require(
      controller.view.subviews.compactMap { $0 as? TerminalSidebarScrollView }.first
    )
    let collectionView = try #require(scrollView.documentView as? NSCollectionView)
    let layout = try #require(
      collectionView.collectionViewLayout as? TerminalSidebarCollectionLayout
    )
    layout.prepare()
    let sourceFrame = try #require(
      layout.plan.items.first { $0.id == .tab(firstTab.id) }?.frame
    )

    controller.apply(
      outline: target,
      rows: rows,
      context: context(for: target),
      selectedTabID: firstTab.id,
      reduceMotion: reduceMotion
    )
    if stopWithReduceMotion {
      controller.apply(
        outline: target,
        rows: rows,
        context: context(for: target),
        selectedTabID: firstTab.id,
        reduceMotion: true
      )
    }
    layout.prepare()
    let transitionFrame = try #require(
      layout.plan.items.first { $0.id == .tab(firstTab.id) }?.frame
    )
    let targetFrame = try #require(
      layout.targetPlan.items.first { $0.id == .tab(firstTab.id) }?.frame
    )

    return ReorderFrames(
      source: sourceFrame,
      transition: transitionFrame,
      target: targetFrame
    )
  }

  @Test
  func scrollViewportClearsTrafficLightsWithoutContentInsets() throws {
    let controller = TerminalSidebarListController(
      windowControllerID: UUID(),
      tabDragRegistry: TerminalTabDragRegistry(),
      captureRequest: { nil }
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
  func structuralUpdatesKeepIdentifiersAlignedWithTheCollectionCount() {
    let firstTabID = TerminalTabID()
    let secondTabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let ungrouped = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(content: .tab(firstTabID), isPinned: false),
        TerminalSidebarOutline.Root(content: .tab(secondTabID), isPinned: false),
      ],
      revision: 1
    )
    let grouped = TerminalSidebarTestFixture.outline(
      roots: [
        TerminalSidebarOutline.Root(
          content: .group(groupID, .blue, .automatic, [firstTabID, secondTabID]),
          isPinned: false
        )
      ],
      revision: 2
    )
    let sourceIdentifiers = ungrouped.visibleEntries.map(\.id)
    let targetIdentifiers = grouped.visibleEntries.map(\.id)
    let layout = TerminalSidebarCollectionLayout()

    layout.setOutline(ungrouped)
    layout.finishStructuralUpdate()
    layout.setOutline(grouped)

    #expect(
      layout.displayedIdentifiers(
        snapshotIdentifiers: targetIdentifiers,
        itemCount: sourceIdentifiers.count
      ) == sourceIdentifiers
    )
    #expect(
      layout.displayedIdentifiers(
        snapshotIdentifiers: targetIdentifiers,
        itemCount: targetIdentifiers.count
      ) == targetIdentifiers
    )

    layout.finishStructuralUpdate()
    layout.setOutline(ungrouped)

    #expect(
      layout.displayedIdentifiers(
        snapshotIdentifiers: sourceIdentifiers,
        itemCount: targetIdentifiers.count
      ) == targetIdentifiers
    )
    #expect(
      layout.displayedIdentifiers(
        snapshotIdentifiers: sourceIdentifiers,
        itemCount: sourceIdentifiers.count
      ) == sourceIdentifiers
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
  func spaceSwitcherAlignsWithTrafficLightCenters() {
    let trafficLightCenter =
      WindowTrafficLightMetrics.edgePadding + WindowTrafficLightMetrics.buttonSize / 2
    let switcherCenter =
      TerminalWindowHeaderMetrics.switcherTopPadding
      + TerminalWindowHeaderMetrics.switcherHeight / 2

    #expect(switcherCenter == trafficLightCenter)
  }

  @Test
  func spaceSwitcherResolvesSelectionAndDeleteState() throws {
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
    #expect(
      TerminalSpaceSwitcherPresentation(
        spaces: [first],
        selectedSpaceID: TerminalSpaceID()
      ) == nil
    )
  }

  @Test
  func spaceSwitcherUsesEffectiveSpaceShortcuts() {
    let bindings = (0..<4).map {
      TerminalSpaceShortcut.shortcutBinding(
        forSpaceAt: $0,
        overrides: [:]
      )?.display
    }

    #expect(bindings == ["⌃1", "⌃2", "⌃3", "⌃4"])
  }

  @Test
  func spaceSwitcherOmitsDisabledAndOutOfRangeShortcuts() {
    #expect(
      TerminalSpaceShortcut.shortcutBinding(
        forSpaceAt: 0,
        overrides: [.selectSpace(1): .disabled]
      ) == nil
    )
    #expect(
      TerminalSpaceShortcut.shortcutBinding(
        forSpaceAt: 10,
        overrides: [:]
      ) == nil
    )
  }

  @Test
  func spaceDotsKeepNativeControlsAcrossUpdates() {
    let first = TerminalSpaceItem(id: TerminalSpaceID(), name: "First")
    let second = TerminalSpaceItem(id: TerminalSpaceID(), name: "Second")
    let view = TerminalNativeSpaceDotsView()

    func configuration(
      spaces: [TerminalSpaceItem],
      selectedSpaceID: TerminalSpaceID
    ) -> TerminalNativeSpaceDotsConfiguration {
      TerminalNativeSpaceDotsConfiguration(
        palette: Palette(colorScheme: .dark, backgroundSeed: testBackgroundSeed(for: .dark)),
        spaces: spaces,
        selectionPosition: Double(spaces.firstIndex { $0.id == selectedSpaceID } ?? 0),
        select: { _ in },
        edit: { _ in },
        delete: { _ in },
        newTab: { _ in },
        reorder: { _, _ in },
        dropTab: { _, _ in false }
      )
    }

    view.apply(configuration(spaces: [first, second], selectedSpaceID: first.id))
    let originalSubviewIDs = Set(view.subviews.map(ObjectIdentifier.init))
    view.apply(configuration(spaces: [second, first], selectedSpaceID: second.id))

    #expect(Set(view.subviews.map(ObjectIdentifier.init)) == originalSubviewIDs)
  }

  private func tabPresentation(_ tab: TerminalTabItem) -> TerminalSidebarTabRowPresentation {
    TerminalSidebarTabRowPresentation(
      tab: tab,
      groupID: nil,
      rootIsPinned: false,
      notificationPresentation: nil,
      paneWorkingDirectories: [],
      unreadCount: 0,
      terminalProgress: nil,
      hasTerminalBell: false,
      showsAgentSpinner: false,
      shortcutHint: nil,
      showsShortcutHint: false
    )
  }

  private var rowActions: TerminalSidebarRowActions {
    TerminalSidebarRowActions(
      toggleGroupCollapsed: { _ in },
      createTabInGroup: { _ in },
      renameGroup: { _, _ in false },
      setGroupColor: { _, _ in },
      toggleGroupPinned: { _ in },
      ungroup: { _ in },
      closeGroup: { _ in },
      newTab: {}
    )
  }
}
