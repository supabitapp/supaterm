import AppKit
import Foundation
import SwiftUI
import Testing

@testable import supaterm

struct TerminalSidebarListViewTests {
  private let firstProjectID = TerminalProjectID(
    rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
  )
  private let secondProjectID = TerminalProjectID(
    rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!
  )
  private let firstTabID = TerminalTabID(
    rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!
  )
  private let lastTabID = TerminalTabID(
    rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000008")!
  )

  @Test @MainActor
  func resizingUpdatesTheEntireHostedHierarchyInOneLayoutPass() throws {
    let entries = [
      TerminalSidebarEntry(kind: .project(id: firstProjectID, isPinned: false)),
      TerminalSidebarEntry(
        kind: .tab(id: firstTabID, projectID: firstProjectID, isPinned: false)
      ),
      TerminalSidebarEntry(kind: .newProject),
    ]
    let itemByID = Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        (
          entry.id,
          AnyView(Color.clear.frame(height: TerminalSidebarLayout.tabRowMinHeight))
        )
      }
    )
    let list = TerminalSidebarListView()
    list.frame = CGRect(x: 0, y: 0, width: 180, height: 400)
    list.apply(
      model: TerminalSidebarPresentationModel(
        entries: entries,
        collapsedProjectIDs: []
      ),
      itemByID: itemByID,
      presentationKeyByID: presentationKeys(entries: entries, tabHeight: 36),
      selectedTabID: nil,
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    try expectWidths(in: list, listWidth: 180, rowWidth: 163)

    list.frame.size.width = 320

    try expectWidths(in: list, listWidth: 320, rowWidth: 303)
  }

  @Test @MainActor
  func presentationKeysControlVisibleContentHeightRefresh() throws {
    let entries = [
      TerminalSidebarEntry(kind: .project(id: firstProjectID, isPinned: false)),
      TerminalSidebarEntry(
        kind: .tab(id: firstTabID, projectID: firstProjectID, isPinned: false)
      ),
      TerminalSidebarEntry(kind: .newProject),
    ]
    let model = TerminalSidebarPresentationModel(
      entries: entries,
      collapsedProjectIDs: []
    )
    let list = TerminalSidebarListView()
    list.frame = CGRect(x: 0, y: 0, width: 240, height: 400)
    list.apply(
      model: model,
      itemByID: itemViews(entries: entries, tabHeight: 36),
      presentationKeyByID: presentationKeys(entries: entries, tabHeight: 36),
      selectedTabID: nil,
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    #expect(try tabHeight(in: list) == 36)

    list.apply(
      model: model,
      itemByID: itemViews(entries: entries, tabHeight: 72),
      presentationKeyByID: presentationKeys(entries: entries, tabHeight: 36),
      selectedTabID: nil,
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    #expect(try tabHeight(in: list) == 36)

    list.apply(
      model: model,
      itemByID: itemViews(entries: entries, tabHeight: 72),
      presentationKeyByID: presentationKeys(entries: entries, tabHeight: 72),
      selectedTabID: nil,
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    #expect(try tabHeight(in: list) == 72)
  }

  @Test @MainActor
  func selectedTabRevealsOnceAndUnrelatedUpdatesPreserveTheScrollPosition() throws {
    let tabIDs = (1...8).map { index in
      TerminalTabID(
        rawValue: UUID(
          uuidString: "10000000-0000-0000-0000-" + String(format: "%012d", index)
        )!
      )
    }
    let entries =
      [TerminalSidebarEntry(kind: .project(id: firstProjectID, isPinned: false))]
      + tabIDs.map { tabID in
        TerminalSidebarEntry(
          kind: .tab(id: tabID, projectID: firstProjectID, isPinned: false)
        )
      }
      + [TerminalSidebarEntry(kind: .newProject)]
    let model = TerminalSidebarPresentationModel(entries: entries, collapsedProjectIDs: [])
    let itemByID = Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        (
          entry.id,
          AnyView(Color.clear.frame(height: TerminalSidebarLayout.tabRowMinHeight))
        )
      }
    )
    let list = TerminalSidebarListView()
    list.frame = CGRect(x: 0, y: 0, width: 240, height: 140)
    list.apply(
      model: model,
      itemByID: itemByID,
      presentationKeyByID: presentationKeys(entries: entries, tabHeight: 36),
      selectedTabID: firstTabID,
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    list.apply(
      model: model,
      itemByID: itemByID,
      presentationKeyByID: presentationKeys(entries: entries, tabHeight: 36),
      selectedTabID: lastTabID,
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    let lastFrame = try #require(
      list.collectionLayout.targetPlan.items.first(where: { $0.id == .tab(lastTabID) })
    ).frame
    #expect(list.collectionView.visibleRect.intersects(lastFrame))

    let clipView = list.scrollView.contentView
    let topY = TerminalSidebarScrollGeometry.constrainedY(
      -.greatestFiniteMagnitude,
      in: clipView
    )
    clipView.scroll(to: CGPoint(x: clipView.bounds.origin.x, y: topY))
    list.scrollView.reflectScrolledClipView(clipView)
    let unrelatedUpdateOrigin = clipView.bounds.origin

    list.apply(
      model: model,
      itemByID: itemByID,
      presentationKeyByID: presentationKeys(entries: entries, tabHeight: 36),
      selectedTabID: lastTabID,
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    #expect(clipView.bounds.origin == unrelatedUpdateOrigin)
  }

  @Test
  func dragActivationUsesAnEightPointEuclideanThreshold() {
    let origin = CGPoint.zero

    #expect(TerminalSidebarDragActivation.threshold == 8)
    #expect(!TerminalSidebarDragActivation.shouldBegin(from: origin, to: CGPoint(x: 7.99, y: 0)))
    #expect(TerminalSidebarDragActivation.shouldBegin(from: origin, to: CGPoint(x: 8, y: 0)))
    #expect(!TerminalSidebarDragActivation.shouldBegin(from: origin, to: CGPoint(x: 5, y: 5)))
    #expect(TerminalSidebarDragActivation.shouldBegin(from: origin, to: CGPoint(x: 6, y: 6)))
  }

  @Test
  func presentationKeysCompareValuesAndTypes() {
    let first = TerminalSidebarRowPresentationKey(1)
    let sameValue = TerminalSidebarRowPresentationKey(1)
    let differentValue = TerminalSidebarRowPresentationKey(2)
    let differentType = TerminalSidebarRowPresentationKey("1")

    #expect(first == sameValue)
    #expect(first != differentValue)
    #expect(first != differentType)
  }

  @Test
  func rowRefreshesAreLimitedToChangedPresentationsAndSelection() {
    let secondTabID = TerminalTabID(
      rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000002")!
    )
    let entryIDs: Set<TerminalSidebarEntryID> = [
      .project(firstProjectID),
      .tab(firstTabID),
      .tab(secondTabID),
      .newProject,
    ]
    let original = Dictionary(
      uniqueKeysWithValues: entryIDs.map { entryID in
        (entryID, TerminalSidebarRowPresentationKey("\(entryID)"))
      }
    )

    #expect(
      TerminalSidebarRowRefresh.entryIDs(
        in: entryIDs,
        previousKeyByID: original,
        keyByID: original,
        previousSelectedTabID: firstTabID,
        selectedTabID: firstTabID
      ).isEmpty
    )

    var changed = original
    changed[.tab(firstTabID)] = TerminalSidebarRowPresentationKey("changed")
    #expect(
      TerminalSidebarRowRefresh.entryIDs(
        in: entryIDs,
        previousKeyByID: original,
        keyByID: changed,
        previousSelectedTabID: firstTabID,
        selectedTabID: firstTabID
      ) == [.tab(firstTabID)]
    )

    #expect(
      TerminalSidebarRowRefresh.entryIDs(
        in: entryIDs,
        previousKeyByID: original,
        keyByID: original,
        previousSelectedTabID: firstTabID,
        selectedTabID: secondTabID
      ) == [.tab(firstTabID), .tab(secondTabID)]
    )
  }

  @Test @MainActor
  func dragGestureTakesPrecedenceOverHostedControls() {
    let collectionView = TerminalSidebarCollectionView()
    let recognizer = TerminalSidebarDragGestureRecognizer(collectionView: collectionView)

    #expect(recognizer.shouldBeRequiredToFail(by: NSClickGestureRecognizer()))
  }

  @Test @MainActor
  func scrollConstraintPreservesTrafficLightInset() {
    let scrollView = NSScrollView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    let collectionView = TerminalSidebarCollectionView(
      frame: CGRect(x: 0, y: 0, width: 240, height: 800)
    )
    scrollView.contentInsets.top = TerminalSidebarLayout.firstVisibleSectionTopInset
    scrollView.documentView = collectionView
    scrollView.tile()
    scrollView.contentView.contentInsets.top = TerminalSidebarLayout.firstVisibleSectionTopInset

    let constrainedY = TerminalSidebarScrollGeometry.constrainedY(
      -.greatestFiniteMagnitude,
      in: scrollView.contentView
    )

    #expect(constrainedY == -TerminalSidebarLayout.firstVisibleSectionTopInset)
  }

  @Test @MainActor
  func folderDropKeepsUniqueDirectoriesOnly() throws {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let directory = root.appendingPathComponent("project", isDirectory: true)
    let file = root.appendingPathComponent("notes.txt")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data().write(to: file)
    defer { try? FileManager.default.removeItem(at: root) }

    let pasteboard = NSPasteboard.withUniqueName()
    pasteboard.clearContents()
    #expect(pasteboard.writeObjects([directory as NSURL, directory as NSURL, file as NSURL]))

    #expect(
      TerminalSidebarFolderDrop.directoryURLs(from: pasteboard)
        == [directory.standardizedFileURL]
    )
  }

  @Test @MainActor
  func folderDropAppendsAnUnpinnedProject() throws {
    let entries = [
      TerminalSidebarEntry(kind: .project(id: firstProjectID, isPinned: true)),
      TerminalSidebarEntry(kind: .project(id: secondProjectID, isPinned: false)),
      TerminalSidebarEntry(kind: .newProject),
    ]
    let target = try #require(TerminalSidebarFolderDrop.target(in: entries))

    #expect(target.destination == .project(isPinned: false, laneIndex: 1))
    #expect(target.insertionEntryIndex == 2)
  }

  @Test
  func hapticTargetsDeduplicateUntilTheSessionResets() {
    let first: TerminalSidebarDropTarget.Destination = .tab(
      projectID: firstProjectID,
      isPinned: false,
      laneIndex: 0
    )
    let second: TerminalSidebarDropTarget.Destination = .tab(
      projectID: secondProjectID,
      isPinned: false,
      laneIndex: 0
    )
    var tracker = TerminalSidebarHapticTargetTracker()

    let firstResult = tracker.shouldPerform(for: first)
    let repeatedResult = tracker.shouldPerform(for: first)
    let nilResult = tracker.shouldPerform(for: nil)
    let returnedResult = tracker.shouldPerform(for: first)
    let secondResult = tracker.shouldPerform(for: second)

    #expect(firstResult)
    #expect(!repeatedResult)
    #expect(!nilResult)
    #expect(!returnedResult)
    #expect(secondResult)

    tracker.reset()

    let resetResult = tracker.shouldPerform(for: first)
    #expect(resetResult)
  }

  @Test @MainActor
  func dropTargetsUseAlignmentHapticsOnlyWhenTheDestinationChanges() {
    let first = TerminalSidebarDropTarget(
      destination: .project(isPinned: false, laneIndex: 0),
      insertionEntryIndex: 0
    )
    let second = TerminalSidebarDropTarget(
      destination: .project(isPinned: false, laneIndex: 1),
      insertionEntryIndex: 0
    )
    var alignmentCount = 0
    var dropCount = 0
    let list = TerminalSidebarListView(
      performAlignmentHaptic: { alignmentCount += 1 },
      performDropHaptic: { dropCount += 1 }
    )

    list.setDropTarget(first, pointerY: nil)
    list.setDropTarget(first, pointerY: nil)
    list.setDropTarget(second, pointerY: nil)
    list.setDropTarget(nil, pointerY: nil)

    #expect(alignmentCount == 2)
    #expect(dropCount == 0)
  }

  @Test
  func externalDragSessionsResetOnlyWhenTheirMatchingSessionEnds() {
    var tracker = TerminalSidebarExternalDragTracker()

    let didBeginFirstSession = tracker.begin(sequenceNumber: 1)
    let didRepeatFirstSession = tracker.begin(sequenceNumber: 1)
    let didEndDifferentSession = tracker.end(sequenceNumber: 2)

    #expect(didBeginFirstSession)
    #expect(!didRepeatFirstSession)
    #expect(!didEndDifferentSession)
    #expect(tracker.sequenceNumber == 1)
    let didEndFirstSession = tracker.end(sequenceNumber: 1)

    #expect(didEndFirstSession)
    #expect(tracker.sequenceNumber == nil)
    let didBeginSecondSession = tracker.begin(sequenceNumber: 2)

    #expect(didBeginSecondSession)
  }

  @Test
  func collapseDelaysEaseFromFirstToLastInterval() {
    let delays = TerminalSidebarCollapseMotion.delays(rowCount: 4)

    #expect(delays.count == 4)
    expectApproximately(delays[0], 0)
    expectApproximately(delays[1], 0.024)
    expectApproximately(delays[2], 0.036)
    expectApproximately(delays[3], 0.044)
    expectApproximately(TerminalSidebarCollapseMotion.totalDuration(rowCount: 4), 0.224)
  }

  @Test
  func collapseVisibilityUsesCubicHeightAndFrontLoadedOpacity() {
    let delay: TimeInterval = 0.024
    let quarter = TerminalSidebarCollapseMotion.visibility(
      elapsed: delay + TerminalSidebarCollapseMotion.rowDuration * 0.25,
      delay: delay
    )
    let halfway = TerminalSidebarCollapseMotion.visibility(
      elapsed: delay + TerminalSidebarCollapseMotion.rowDuration * 0.5,
      delay: delay
    )
    let complete = TerminalSidebarCollapseMotion.visibility(
      elapsed: delay + TerminalSidebarCollapseMotion.rowDuration,
      delay: delay
    )

    expectApproximately(quarter.height, 0.9375)
    expectApproximately(quarter.alpha, 0.5)
    expectApproximately(halfway.height, 0.5)
    expectApproximately(halfway.alpha, 0)
    expectApproximately(complete.height, 0)
    expectApproximately(complete.alpha, 0)
  }

  @Test
  func autoscrollBehaviorUsesEdgeDelayHysteresisAndBoundedSteps() {
    #expect(TerminalSidebarAutoscrollBehavior.edgeSize == 60)
    #expect(TerminalSidebarAutoscrollBehavior.minimumViewportHeight == 240)
    #expect(TerminalSidebarAutoscrollBehavior.hysteresis == 20)
    #expect(TerminalSidebarAutoscrollBehavior.activationDelay == 0.25)
    #expect(TerminalSidebarAutoscrollBehavior.step(penetration: -1) == 1)
    #expect(TerminalSidebarAutoscrollBehavior.step(penetration: 0.5) == 4.5)
    #expect(TerminalSidebarAutoscrollBehavior.step(penetration: 2) == 8)
  }

  @MainActor
  private func expectWidths(
    in list: TerminalSidebarListView,
    listWidth: CGFloat,
    rowWidth: CGFloat
  ) throws {
    #expect(list.scrollView.frame.width == listWidth)
    #expect(list.scrollView.documentView === list.collectionView)
    #expect(list.collectionView.frame.width == listWidth)
    #expect(list.collectionLayout.targetPlan.contentSize.width == listWidth)
    #expect(list.collectionLayout.targetPlan.items.map(\.frame.width) == [rowWidth, rowWidth, rowWidth])

    let visibleItems = list.collectionView.visibleItems()
    #expect(visibleItems.count == 3)
    for item in visibleItems {
      #expect(item.view.frame.width == rowWidth)
      let hostedView = try #require(item.view.subviews.first)
      #expect(hostedView.frame.width == rowWidth)
    }
  }

  private func expectApproximately(
    _ actual: CGFloat,
    _ expected: CGFloat
  ) {
    #expect(abs(actual - expected) < 0.000_001)
  }

  private func expectApproximately(
    _ actual: TimeInterval,
    _ expected: TimeInterval
  ) {
    #expect(abs(actual - expected) < 0.000_001)
  }

  @MainActor
  private func itemViews(
    entries: [TerminalSidebarEntry],
    tabHeight: CGFloat
  ) -> [TerminalSidebarEntryID: AnyView] {
    Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        let height = entry.id == .tab(firstTabID) ? tabHeight : TerminalSidebarLayout.tabRowMinHeight
        return (entry.id, AnyView(Color.clear.frame(height: height)))
      }
    )
  }

  private func presentationKeys(
    entries: [TerminalSidebarEntry],
    tabHeight: CGFloat
  ) -> [TerminalSidebarEntryID: TerminalSidebarRowPresentationKey] {
    Dictionary(
      uniqueKeysWithValues: entries.map { entry in
        let height = entry.id == .tab(firstTabID) ? tabHeight : TerminalSidebarLayout.tabRowMinHeight
        return (
          entry.id,
          TerminalSidebarRowPresentationKey("\(entry.id)-\(height)")
        )
      }
    )
  }

  @MainActor
  private func tabHeight(in list: TerminalSidebarListView) throws -> CGFloat {
    try #require(
      list.collectionLayout.targetPlan.items.first(where: { $0.id == .tab(firstTabID) })
    ).frame.height
  }

}
