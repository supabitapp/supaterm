import AppKit
import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarCollectionHarnessTests {
  @Test
  func preparedPlanDrivesRealizedRowsAndDropTargetsTogether() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let source = TerminalTabID()
    let outline = outline([first, second, source])
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let path = TerminalSidebarSemanticPath.unassignedItem(
      index: 1,
      id: second
    )
    let target = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: path,
        outline: outline
      )
    )
    let harness = CollectionHarness(size: CGSize(width: 220, height: 300))
    defer { harness.close() }

    harness.apply(
      outline: outline,
      dragDropState: TerminalSidebarDragDropState(
        source: payload.source,
        draggingItemIDs: [.tab(source)],
        target: target
      )
    )

    let planItem = try #require(harness.layout.plan.items.first { $0.id == .tab(second) })
    let indexPath = try #require(harness.dataSource.indexPath(for: .tab(second)))
    let attributes = try #require(harness.layout.layoutAttributesForItem(at: indexPath))
    let item = try #require(harness.collectionView.item(at: indexPath))
    let semanticTarget = try #require(
      harness.layout.plan.semanticTargets.first { $0.path == path }
    )
    let mappedTarget = try #require(
      harness.layout.dropTargetMap.targets.first { $0.path == path }
    )

    #expect(item.view.frame == planItem.frame)
    #expect(attributes.frame == planItem.frame)
    #expect(harness.layout.dropTargetMap.targets == harness.layout.plan.semanticTargets)
    #expect(mappedTarget.frame == semanticTarget.frame)
  }

  @Test
  func dropTargetMapKeepsNaturalGeometryWhileProjectedFramesInterpolate() throws {
    let tabs = (0..<6).map { _ in TerminalTabID() }
    let source = TerminalTabID()
    let outline = outline(tabs + [source])
    let payload = try #require(outline.dragPayload(for: .tab(source)))
    let sourcePath = TerminalSidebarSemanticPath.unassignedItem(
      index: 0,
      id: tabs[0]
    )
    let destinationPath = TerminalSidebarSemanticPath.unassignedItem(
      index: 4,
      id: tabs[4]
    )
    let sourceTarget = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: sourcePath,
        outline: outline
      )
    )
    let destinationTarget = try #require(
      TerminalSidebarDropPlanner.plan(
        payload: payload,
        path: destinationPath,
        outline: outline
      )
    )
    let dragState = { (target: TerminalSidebarDropPlan) in
      TerminalSidebarDragDropState(
        source: payload.source,
        draggingItemIDs: [.tab(source)],
        target: target
      )
    }
    let harness = CollectionHarness(size: CGSize(width: 220, height: 300))
    defer { harness.close() }
    harness.apply(outline: outline, dragDropState: dragState(sourceTarget))

    let origin = harness.layout.plan
    let originPlaceholder = try #require(origin.dropPlaceholderFrame)
    let movingID = TerminalSidebarEntryID.tab(tabs[0])
    let originItemFrame = try #require(origin.items.first { $0.id == movingID }?.frame)

    harness.transition(to: dragState(destinationTarget), progress: 0.5)

    let current = harness.layout.plan
    let destination = harness.layout.targetPlan
    let currentPlaceholder = try #require(current.dropPlaceholderFrame)
    let destinationPlaceholder = try #require(destination.dropPlaceholderFrame)
    let currentItemFrame = try #require(current.items.first { $0.id == movingID }?.frame)
    let destinationItemFrame = try #require(
      destination.items.first { $0.id == movingID }?.frame
    )
    let expectedPlaceholder = CGRect(
      x: (originPlaceholder.minX + destinationPlaceholder.minX) / 2,
      y: (originPlaceholder.minY + destinationPlaceholder.minY) / 2,
      width: (originPlaceholder.width + destinationPlaceholder.width) / 2,
      height: (originPlaceholder.height + destinationPlaceholder.height) / 2
    )
    let expectedItemFrame = CGRect(
      x: (originItemFrame.minX + destinationItemFrame.minX) / 2,
      y: (originItemFrame.minY + destinationItemFrame.minY) / 2,
      width: (originItemFrame.width + destinationItemFrame.width) / 2,
      height: (originItemFrame.height + destinationItemFrame.height) / 2
    )
    let currentTarget = try #require(
      current.semanticTargets.first { $0.path == destinationPath }
    )
    let mappedTarget = try #require(
      harness.layout.dropTargetMap.targets.first { $0.path == destinationPath }
    )
    let destinationTargetFrame = try #require(
      destination.semanticTargets.first { $0.path == destinationPath }
    ).frame
    let movingIndexPath = try #require(harness.dataSource.indexPath(for: movingID))
    let movingAttributes = try #require(
      harness.layout.layoutAttributesForItem(at: movingIndexPath)
    )
    let movingItem = try #require(harness.collectionView.item(at: movingIndexPath))

    #expect(originPlaceholder.minY != destinationPlaceholder.minY)
    #expect(currentPlaceholder == expectedPlaceholder)
    #expect(originItemFrame != destinationItemFrame)
    #expect(currentItemFrame == expectedItemFrame)
    #expect(movingAttributes.frame == currentItemFrame)
    #expect(movingItem.view.frame == currentItemFrame)
    #expect(origin.semanticTargets == destination.semanticTargets)
    #expect(current.semanticTargets == destination.semanticTargets)
    #expect(harness.layout.dropTargetMap.targets == current.semanticTargets)
    #expect(mappedTarget.frame == currentTarget.frame)
    #expect(mappedTarget.frame == destinationTargetFrame)
  }

  @Test
  func structuralHandoffKeepsSnapshotIndexPathsAndRealizedItemsAligned() throws {
    let first = TerminalTabID()
    let second = TerminalTabID()
    let third = TerminalTabID()
    let replacement = TerminalTabID()
    let source = outline([first, second, third], revision: 1)
    let reordered = outline([third, first, second], revision: 2)
    let replaced = outline([replacement, first, second], revision: 3)
    let harness = CollectionHarness(size: CGSize(width: 220, height: 300))
    defer { harness.close() }

    harness.apply(outline: source)
    for expectedOutline in [reordered, replaced] {
      harness.apply(outline: expectedOutline, finishStructuralUpdate: false)
      let expectedIDs = expectedOutline.visibleEntries.map(\.id)

      try expectIdentityAlignment(in: harness, expectedIDs: expectedIDs)

      harness.finishStructuralUpdate()
      harness.relayout()

      try expectIdentityAlignment(in: harness, expectedIDs: expectedIDs)
    }
  }

  private func expectIdentityAlignment(
    in harness: CollectionHarness,
    expectedIDs: [TerminalSidebarEntryID]
  ) throws {
    #expect(harness.dataSource.snapshot().itemIdentifiers == expectedIDs)
    #expect(harness.realizedIdentifiers == expectedIDs)
    #expect(harness.collectionView.numberOfItems(inSection: 0) == expectedIDs.count)

    for (index, expectedID) in expectedIDs.enumerated() {
      let indexPath = IndexPath(item: index, section: 0)
      let snapshotID = try #require(harness.dataSource.itemIdentifier(for: indexPath))
      let item = try #require(harness.collectionView.item(at: indexPath) as? TaggedItem)
      let planItem = try #require(harness.layout.plan.items.first { $0.id == expectedID })
      let attributes = try #require(harness.layout.layoutAttributesForItem(at: indexPath))

      #expect(snapshotID == expectedID)
      #expect(item.entryID == expectedID)
      #expect(attributes.frame == planItem.frame)
    }
  }

  private func outline(
    _ tabIDs: [TerminalTabID],
    revision: UInt64 = 1
  ) -> TerminalSidebarOutline {
    TerminalSidebarTestFixture.outline(
      roots: [TerminalSidebarOutline.Root(content: .unassigned(tabIDs), isPinned: false)],
      revision: revision
    )
  }

  @MainActor
  private final class CollectionHarness {
    private static let itemIdentifier = NSUserInterfaceItemIdentifier(
      "TerminalSidebarCollectionIntegrationItem"
    )

    let window: NSWindow
    let collectionView: TerminalSidebarCollectionView
    let layout: TerminalSidebarCollectionLayout
    let dataSource: NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>

    init(size: CGSize) {
      let collectionView = TerminalSidebarCollectionView(
        frame: CGRect(origin: .zero, size: size)
      )
      let layout = TerminalSidebarCollectionLayout()
      collectionView.collectionViewLayout = layout
      collectionView.register(TaggedItem.self, forItemWithIdentifier: Self.itemIdentifier)
      let dataSource = NSCollectionViewDiffableDataSource<Int, TerminalSidebarEntryID>(
        collectionView: collectionView
      ) { collectionView, indexPath, entryID in
        let item = collectionView.makeItem(
          withIdentifier: Self.itemIdentifier,
          for: indexPath
        )
        guard let item = item as? TaggedItem else { return nil }
        item.entryID = entryID
        return item
      }
      let window = NSWindow(
        contentRect: CGRect(origin: .zero, size: size),
        styleMask: .borderless,
        backing: .buffered,
        defer: false
      )
      window.contentView = collectionView

      self.window = window
      self.collectionView = collectionView
      self.layout = layout
      self.dataSource = dataSource
      layout.itemIdentifiers = { dataSource.snapshot().itemIdentifiers }
    }

    var realizedIdentifiers: [TerminalSidebarEntryID] {
      (0..<collectionView.numberOfItems(inSection: 0)).compactMap { index in
        let indexPath = IndexPath(item: index, section: 0)
        return (collectionView.item(at: indexPath) as? TaggedItem)?.entryID
      }
    }

    func apply(
      outline: TerminalSidebarOutline,
      dragDropState: TerminalSidebarDragDropState? = nil,
      finishStructuralUpdate: Bool = true
    ) {
      layout.dragDropState = dragDropState
      layout.setOutline(outline)

      var snapshot = NSDiffableDataSourceSnapshot<Int, TerminalSidebarEntryID>()
      snapshot.appendSections([0])
      snapshot.appendItems(outline.visibleEntries.map(\.id))
      dataSource.apply(snapshot, animatingDifferences: false)

      relayout()
      if finishStructuralUpdate {
        self.finishStructuralUpdate()
        relayout()
      }
    }

    func finishStructuralUpdate() {
      layout.finishStructuralUpdate()
    }

    func relayout() {
      layout.invalidateLayout()
      collectionView.needsLayout = true
      layout.prepare()
      collectionView.layoutSubtreeIfNeeded()
    }

    func transition(
      to dragDropState: TerminalSidebarDragDropState,
      progress: CGFloat
    ) {
      layout.beginTransition()
      layout.dragDropState = dragDropState
      layout.updateTransition(progress: progress)
      layout.invalidateLayout()
      layout.prepare()
      collectionView.layoutSubtreeIfNeeded()
    }

    func close() {
      window.contentView = nil
    }
  }

  @MainActor
  private final class TaggedItem: NSCollectionViewItem {
    var entryID: TerminalSidebarEntryID?

    override func loadView() {
      view = NSView()
    }
  }
}
