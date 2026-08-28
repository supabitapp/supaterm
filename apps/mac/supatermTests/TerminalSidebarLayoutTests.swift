import AppKit
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
    let realizedIdentifiers: [TerminalSidebarEntryID]
    let targetIdentifiers: [TerminalSidebarEntryID]
  }

  @Test
  func programmaticReorderInterpolatesRetainedRowGeometry() throws {
    let frames = try programmaticReorderFrames(reduceMotion: false)

    #expect(frames.source != frames.target)
    #expect(frames.transition == frames.source)
    #expect(frames.realizedIdentifiers == frames.targetIdentifiers)
  }

  @Test
  func programmaticReorderIsImmediateWithReduceMotion() throws {
    let frames = try programmaticReorderFrames(reduceMotion: true)

    #expect(frames.source != frames.target)
    #expect(frames.transition == frames.target)
    #expect(frames.realizedIdentifiers == frames.targetIdentifiers)
  }

  @Test
  func selectionGlowUsesLiveSelectionBeforeTheNextSnapshot() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let collection = terminal.spaceManager.tabCollection
    let firstID = collection.createTab(title: "First")
    let secondID = collection.createTab(title: "Second")
    collection.selectTab(secondID)
    let outline = TerminalSidebarOutline(
      snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot
    )
    var rows = Dictionary(
      uniqueKeysWithValues: terminal.tabs.map {
        (
          TerminalSidebarEntryID.tab($0.id),
          TerminalSidebarRowPresentation.tab(tabPresentation($0))
        )
      }
    )
    rows[.newTab] = .newTab(.inline)
    let harness = try #require(
      TerminalSidebarWindowHarness(size: CGSize(width: 280, height: 300))
    )
    defer { harness.close() }
    harness.apply(
      outline: outline,
      rows: rows,
      terminal: terminal,
      selectedTabID: secondID,
      reduceMotion: true
    )
    harness.layoutNow()

    terminal.selectTab(firstID)
    harness.controller.viewWillLayout()

    let glow = try #require(
      harness.collectionView.subviews.compactMap { $0 as? TerminalSidebarSelectionGlowView }.first
    )
    let firstFrame = try #require(
      harness.layout.plan.items.first { $0.id == .tab(firstID) }?.frame
    )
    #expect(!glow.isHidden)
    #expect(glow.frame.midY == firstFrame.midY)
  }

  @Test
  func programmaticReorderStopsWhenReduceMotionTurnsOn() throws {
    let frames = try programmaticReorderFrames(
      reduceMotion: false,
      stopWithReduceMotion: true
    )

    #expect(frames.source != frames.target)
    #expect(frames.transition == frames.target)
    #expect(frames.realizedIdentifiers == frames.targetIdentifiers)
  }

  @Test
  func windowBackedResizeAppliesCurrentItemGeometryInOneLayoutPass() throws {
    let (harness, _) = try tabHarness(
      size: CGSize(width: 280, height: 640),
      tabCount: 8
    )
    defer { harness.close() }
    let indexPath = IndexPath(item: 0, section: 0)
    let item = try #require(harness.collectionView.item(at: indexPath))
    let newTabIndexPath = IndexPath(
      item: harness.collectionView.numberOfItems(inSection: 0) - 1,
      section: 0
    )
    let inlineNewTabItem = try #require(harness.collectionView.item(at: newTabIndexPath))
    #expect(!inlineNewTabItem.view.isHidden)

    harness.resize(to: CGSize(width: 360, height: 220))

    let attributes = try #require(harness.layout.layoutAttributesForItem(at: indexPath))
    #expect(item.view.frame == attributes.frame)
    #expect(
      harness.collectionView.indexPathForItem(
        at: CGPoint(x: attributes.frame.midX, y: attributes.frame.midY)
      ) == indexPath
    )
    let pinnedNewTabView = try #require(
      harness.controller.view.subviews.compactMap { $0 as? TerminalSidebarPinnedControlView }.first
    )
    #expect(!pinnedNewTabView.isHidden)
    #expect(inlineNewTabItem.view.isHidden)
  }

  @Test
  func ordinaryScrollUsesOneFrameworkPreparationPass() throws {
    let (harness, _) = try tabHarness(
      size: CGSize(width: 360, height: 220),
      tabCount: 8
    )
    defer { harness.close() }
    var preferredHeightRequests = 0
    harness.layout.preferredHeight = { _, _ in
      preferredHeightRequests += 1
      return TerminalSidebarLayout.tabRowMinHeight
    }
    let contentView = harness.scrollView.contentView
    contentView.scroll(to: CGPoint(x: 0, y: contentView.bounds.minY + 1))
    harness.scrollView.reflectScrolledClipView(contentView)

    #expect(preferredHeightRequests == harness.collectionView.numberOfItems(inSection: 0))
  }

  @Test
  func tabMeasurementKeyChangesWhenGroupingChanges() {
    let tab = TerminalTabItem(title: "A long tab title")

    #expect(
      TerminalSidebarRowPresentation.tab(tabPresentation(tab)).measurementKey
        != TerminalSidebarRowPresentation.tab(
          tabPresentation(tab, groupID: TerminalTabGroupID())
        ).measurementKey
    )
  }

  @Test
  func reduceMotionReplacesAnActiveCollapseImmediately() throws {
    let groupID = TerminalTabGroupID()
    let tabs = [TerminalTabItem(title: "First"), TerminalTabItem(title: "Second")]
    let roots = [
      TerminalSidebarOutline.Root(
        content: .group(groupID, .blue, .automatic, tabs.map(\.id)),
        isPinned: false
      )
    ]
    let expanded = TerminalSidebarTestFixture.outline(roots: roots, revision: 1)
    let collapsed = TerminalSidebarTestFixture.outline(
      roots: roots,
      revision: 2,
      collapsedGroupIDs: [groupID]
    )
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let harness = try #require(
      TerminalSidebarWindowHarness(size: CGSize(width: 280, height: 300))
    )
    defer { harness.close() }

    func rows(isCollapsed: Bool) -> [TerminalSidebarEntryID: TerminalSidebarRowPresentation] {
      var rows = Dictionary(
        uniqueKeysWithValues: tabs.map {
          (TerminalSidebarEntryID.tab($0.id), TerminalSidebarRowPresentation.tab(tabPresentation($0)))
        }
      )
      rows[.group(groupID)] = .group(
        TerminalSidebarGroupRowPresentation(
          id: groupID,
          title: "Group",
          color: .blue,
          iconURL: nil,
          isPinned: false,
          isCollapsed: isCollapsed,
          tabCount: tabs.count,
          showsNewTabShortcutHint: false
        )
      )
      rows[.newTab] = .newTab(.inline)
      return rows
    }

    harness.apply(
      outline: expanded,
      rows: rows(isCollapsed: false),
      terminal: terminal,
      selectedTabID: tabs[0].id,
      reduceMotion: true
    )
    harness.layoutNow()

    harness.apply(
      outline: collapsed,
      rows: rows(isCollapsed: true),
      terminal: terminal,
      selectedTabID: tabs[0].id,
      reduceMotion: false
    )
    #expect(
      harness.collectionView.numberOfItems(inSection: 0) == expanded.visibleEntries.count
    )

    harness.apply(
      outline: collapsed,
      rows: rows(isCollapsed: true),
      terminal: terminal,
      selectedTabID: tabs[0].id,
      reduceMotion: true
    )

    #expect(
      harness.collectionView.numberOfItems(inSection: 0) == collapsed.visibleEntries.count
    )
  }

  @Test
  func collapseAtTheTopReleasesItsPinnedContentHeight() async throws {
    let groupID = TerminalTabGroupID()
    let tabs = (0..<6).map { TerminalTabItem(title: "Tab \($0)") }
    let roots = [
      TerminalSidebarOutline.Root(
        content: .group(groupID, .blue, .automatic, tabs.map(\.id)),
        isPinned: false
      )
    ]
    let expanded = TerminalSidebarTestFixture.outline(roots: roots, revision: 1)
    let collapsed = TerminalSidebarTestFixture.outline(
      roots: roots,
      revision: 2,
      collapsedGroupIDs: [groupID]
    )
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let harness = try #require(
      TerminalSidebarWindowHarness(size: CGSize(width: 280, height: 300))
    )
    defer {
      harness.close()
      harness.window.orderOut(nil)
    }
    harness.window.orderFront(nil)
    var rows = Dictionary(
      uniqueKeysWithValues: tabs.map {
        (
          TerminalSidebarEntryID.tab($0.id),
          TerminalSidebarRowPresentation.tab(tabPresentation($0, groupID: groupID))
        )
      }
    )
    rows[.group(groupID)] = .group(
      TerminalSidebarGroupRowPresentation(
        id: groupID,
        title: "Group",
        color: .blue,
        iconURL: nil,
        isPinned: false,
        isCollapsed: false,
        tabCount: tabs.count,
        showsNewTabShortcutHint: false
      )
    )
    rows[.newTab] = .newTab(.inline)
    harness.apply(
      outline: expanded,
      rows: rows,
      terminal: terminal,
      selectedTabID: tabs[0].id,
      reduceMotion: true
    )
    harness.layoutNow()
    harness.layout.prepare()
    let expandedHeight = harness.layout.collectionViewContentSize.height

    harness.apply(
      outline: collapsed,
      rows: rows,
      terminal: terminal,
      selectedTabID: tabs[0].id,
      reduceMotion: false
    )
    try await Task.sleep(for: .milliseconds(350))
    harness.layoutNow()
    harness.layout.prepare()

    #expect(harness.collectionView.visibleRect.minY == 0)
    #expect(harness.layout.collectionViewContentSize.height < expandedHeight)
    #expect(harness.layout.collectionViewContentSize.height == harness.layout.plan.contentSize.height)
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
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let harness = try #require(
      TerminalSidebarWindowHarness(size: CGSize(width: 280, height: 300))
    )
    defer { harness.close() }

    harness.apply(
      outline: source,
      rows: rows,
      terminal: terminal,
      selectedTabID: firstTab.id,
      reduceMotion: reduceMotion
    )
    harness.layoutNow()
    harness.layout.prepare()
    let sourceFrame = try #require(
      harness.layout.plan.items.first { $0.id == .tab(firstTab.id) }?.frame
    )

    harness.apply(
      outline: target,
      rows: rows,
      terminal: terminal,
      selectedTabID: firstTab.id,
      reduceMotion: reduceMotion
    )
    if stopWithReduceMotion {
      harness.apply(
        outline: target,
        rows: rows,
        terminal: terminal,
        selectedTabID: firstTab.id,
        reduceMotion: true
      )
    }
    harness.layout.prepare()
    harness.layoutNow()
    harness.collectionView.layoutSubtreeIfNeeded()
    let transitionFrame = try #require(
      harness.layout.plan.items.first { $0.id == .tab(firstTab.id) }?.frame
    )
    let targetFrame = try #require(
      harness.layout.targetPlan.items.first { $0.id == .tab(firstTab.id) }?.frame
    )

    return ReorderFrames(
      source: sourceFrame,
      transition: transitionFrame,
      target: targetFrame,
      realizedIdentifiers: harness.realizedIdentifiers,
      targetIdentifiers: target.visibleEntries.map(\.id)
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
  func hiddenPinnedControlKeepsItsLaidOutHeight() {
    let host = TerminalSidebarPinnedControlHost(
      draggingUpdated: { _ in [] },
      draggingExited: {},
      draggingEnded: {},
      prepareForDragOperation: { _ in false },
      performDragOperation: { _ in false }
    )
    let pinnedFrame = CGRect(x: 0, y: 0, width: 280, height: 40)
    let hiddenFrame = CGRect(x: 0, y: 0, width: 280, height: 0)

    #expect(host.setPinned(true))
    host.layout(in: pinnedFrame)
    #expect(host.setPinned(false))
    host.layout(in: hiddenFrame)

    #expect(host.view.frame == pinnedFrame)
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
  func collectionLayoutDropsPreparedAttributesWhenInvalidated() throws {
    let tabID = TerminalTabID()
    let outline = TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .tab(tabID), isPinned: false)],
      revision: 1
    )
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 220, height: 180))
    let layout = TerminalSidebarCollectionLayout()
    collectionView.collectionViewLayout = layout
    let dataSource = NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>(
      collectionView: collectionView
    ) { _, _, _ in NSCollectionViewItem() }
    var snapshot = NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>()
    snapshot.appendSections([0])
    snapshot.appendItems(outline.visibleEntries.map(\.id))
    dataSource.apply(snapshot, animatingDifferences: false)
    layout.itemIdentifiers = { dataSource.snapshot().itemIdentifiers }
    layout.setOutline(outline)
    layout.prepare()
    let indexPath = IndexPath(item: 0, section: 0)

    #expect(layout.layoutAttributesForItem(at: indexPath) != nil)

    layout.invalidateLayout()

    #expect(layout.layoutAttributesForItem(at: indexPath) == nil)
    #expect(layout.dropTargetMap.targets.isEmpty)
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
        palette: Palette(colorScheme: .dark),
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

  private func tabHarness(
    size: CGSize,
    tabCount: Int
  ) throws -> (TerminalSidebarWindowHarness, [TerminalTabItem]) {
    let tabs = (0..<tabCount).map { TerminalTabItem(title: "Tab \($0)") }
    let outline = TerminalSidebarTestFixture.outline(
      roots: tabs.map {
        TerminalSidebarOutline.Root(content: .tab($0.id), isPinned: false)
      },
      revision: 1
    )
    let rows = Dictionary(
      uniqueKeysWithValues: tabs.map {
        (TerminalSidebarEntryID.tab($0.id), TerminalSidebarRowPresentation.tab(tabPresentation($0)))
      }
    ).merging([.newTab: .newTab(.inline)]) { current, _ in current }
    let harness = try #require(TerminalSidebarWindowHarness(size: size))
    harness.apply(
      outline: outline,
      rows: rows,
      terminal: TerminalHostState.test(managesTerminalSurfaces: false),
      selectedTabID: tabs.first?.id,
      reduceMotion: true
    )
    harness.layoutNow()
    harness.layoutNow()
    return (harness, tabs)
  }

  private func tabPresentation(
    _ tab: TerminalTabItem,
    groupID: TerminalTabGroupID? = nil
  ) -> TerminalSidebarTabRowPresentation {
    TerminalSidebarTabRowPresentation(
      tab: tab,
      groupID: groupID,
      rootIsPinned: false,
      agentStatus: nil,
      details: [],
      unreadCount: 0,
      terminalProgress: nil,
      hasTerminalBell: false,
      shortcutHint: nil,
      showsShortcutHint: false
    )
  }

}
