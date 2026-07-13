import AppKit
import Foundation
import Testing

@testable import supaterm

struct TerminalSidebarCollectionLayoutTests {
  private let firstProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!)
  private let secondProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000002")!)
  private let thirdProjectID = TerminalProjectID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000003")!)
  private let firstTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000001")!)
  private let secondTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000002")!)
  private let thirdTabID = TerminalTabID(rawValue: UUID(uuidString: "10000000-0000-0000-0000-000000000003")!)

  @Test
  func widthChangesRecomputeEveryFrameImmediately() {
    let entries = singleProjectEntries
    let narrow = plan(entries: entries, width: 180)
    let wide = plan(entries: entries, width: 320)

    #expect(narrow.items.map(\.frame.width) == [163, 163, 163])
    #expect(wide.items.map(\.frame.width) == [303, 303, 303])
    #expect(wide.contentSize.width == 320)
  }

  @Test @MainActor
  func layoutInvalidatesWhenPreparedWidthChanges() {
    let layout = TerminalSidebarCollectionLayout()
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 180, height: 400))
    collectionView.collectionViewLayout = layout
    layout.setEntries(singleProjectEntries)
    layout.prepare()

    #expect(layout.shouldInvalidateLayout(forBoundsChange: CGRect(x: 0, y: 0, width: 180, height: 400)) == false)
    #expect(layout.shouldInvalidateLayout(forBoundsChange: CGRect(x: 0, y: 0, width: 320, height: 400)))
  }

  @Test @MainActor
  func removedItemsKeepTheirOriginalIndexUntilTheSnapshotSettles() {
    let original = singleProjectEntries
    let target = [original[0], original[2]]
    let layout = TerminalSidebarCollectionLayout()
    let collectionView = NSCollectionView(frame: CGRect(x: 0, y: 0, width: 240, height: 400))
    collectionView.collectionViewLayout = layout
    layout.setEntries(original)
    layout.prepare()
    layout.setEntries(target)
    layout.prepare()

    let displayed = layout.displayedItems(
      identifiers: original.map(\.id),
      itemCount: original.count
    )

    #expect(displayed.map(\.0.item) == [0, 1, 2])
    #expect(displayed.map(\.1.id) == original.map(\.id))
  }

  @Test
  func expansionProgressConsumesHeightAndMovesFollowingRows() {
    let entries = singleProjectEntries
    let expanded = plan(entries: entries, width: 240, progress: 1)
    let halfway = plan(entries: entries, width: 240, progress: 0.5)
    let collapsed = plan(entries: entries, width: 240, progress: 0)

    #expect(expanded.items[1].frame.height == 36)
    #expect(halfway.items[1].frame.height == 18)
    #expect(collapsed.items[1].frame.height == 0)
    #expect(expanded.items[1].alpha == 1)
    #expect(halfway.items[1].alpha == 0.5)
    #expect(collapsed.items[1].alpha == 0)
    #expect(expanded.items[2].frame.minY > halfway.items[2].frame.minY)
    #expect(halfway.items[2].frame.minY > collapsed.items[2].frame.minY)
  }

  @Test
  func draggingProjectReservesItsWholeBlockAtTheDestination() {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      tab(secondTabID, projectID: firstProjectID),
      project(secondProjectID),
      newProjectEntry,
    ]
    let dragged: Set<TerminalSidebarEntryID> = [
      .project(firstProjectID),
      .tab(firstTabID),
      .tab(secondTabID),
    ]
    let original = plan(entries: entries, width: 240)
    let result = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: [firstProjectID: 1, secondProjectID: 1],
      draggedEntryIDs: dragged,
      dropTarget: TerminalSidebarDropTarget(
        destination: .project(isPinned: false, laneIndex: 0),
        insertionEntryIndex: 0
      ),
      width: 240
    )

    #expect(result.items[0].frame.height == 0)
    #expect(result.items[1].frame.height == 0)
    #expect(result.items[2].frame.height == 0)
    #expect(result.items[3].frame == original.items[3].frame)
  }

  @Test
  func draggingFirstProjectDoesNotLeaveLeadingSpacing() {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      project(secondProjectID),
      newProjectEntry,
    ]
    let original = plan(entries: entries, width: 240)
    let dragging = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: [firstProjectID: 1, secondProjectID: 1],
      draggedEntryIDs: [.project(firstProjectID), .tab(firstTabID)],
      dropTarget: TerminalSidebarDropTarget(
        destination: .project(isPinned: false, laneIndex: 1),
        insertionEntryIndex: 3
      ),
      width: 240
    )

    #expect(dragging.items[2].frame.minY == 0)
    #expect(dragging.contentSize.height == original.contentSize.height)
  }

  @Test
  func firstTabValidationKeepsItsSourceProjectUnderThePointer() throws {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      project(secondProjectID),
      newProjectEntry,
    ]
    let layout = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: [firstProjectID: 1, secondProjectID: 1],
      draggedEntryIDs: [.tab(firstTabID)],
      dropTarget: nil,
      width: 240
    )
    let frames = Dictionary(uniqueKeysWithValues: layout.items.map { ($0.id, $0.frame) })
    let target = try #require(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .tab(firstTabID),
        pointerY: frames[.tab(firstTabID)]!.midY,
        entries: entries,
        frames: frames
      )
    )

    #expect(target.destination == .tab(projectID: firstProjectID, isPinned: false, laneIndex: 0))
  }

  @Test
  func sourceSizedDropGapKeepsFollowingProjectStable() throws {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      project(secondProjectID),
      newProjectEntry,
    ]
    let original = plan(entries: entries, width: 240)
    let originalFrames = Dictionary(uniqueKeysWithValues: original.items.map { ($0.id, $0.frame) })
    let target = try #require(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .tab(firstTabID),
        pointerY: originalFrames[.tab(firstTabID)]!.midY,
        entries: entries,
        frames: originalFrames
      )
    )
    let dragging = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: [firstProjectID: 1, secondProjectID: 1],
      draggedEntryIDs: [.tab(firstTabID)],
      dropTarget: target,
      width: 240
    )

    #expect(dragging.items[2].frame == original.items[2].frame)
  }

  @Test
  func tabDropDownwardUsesPostRemovalLaneIndex() throws {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      tab(secondTabID, projectID: firstProjectID),
      tab(thirdTabID, projectID: firstProjectID),
      newProjectEntry,
    ]
    let layout = plan(entries: entries, width: 240)
    let frames = Dictionary(uniqueKeysWithValues: layout.items.map { ($0.id, $0.frame) })
    let target = try #require(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .tab(firstTabID),
        pointerY: frames[.tab(thirdTabID)]!.maxY + 1,
        entries: entries,
        frames: frames
      )
    )

    #expect(target.destination == .tab(projectID: firstProjectID, isPinned: false, laneIndex: 2))
  }

  @Test
  func projectDropDownwardUsesPostRemovalLaneIndex() throws {
    let entries = [
      project(firstProjectID),
      project(secondProjectID),
      project(thirdProjectID),
      newProjectEntry,
    ]
    let layout = plan(entries: entries, width: 240)
    let frames = Dictionary(uniqueKeysWithValues: layout.items.map { ($0.id, $0.frame) })
    let target = try #require(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .project(firstProjectID),
        pointerY: frames[.project(thirdProjectID)]!.maxY + 1,
        entries: entries,
        frames: frames
      )
    )

    #expect(target.destination == .project(isPinned: false, laneIndex: 2))
  }

  @Test
  func tabDropOnCollapsedProjectHeaderPreservesLaneAndAppends() throws {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID, isPinned: true),
      project(secondProjectID),
      tab(secondTabID, projectID: secondProjectID, isPinned: true),
      newProjectEntry,
    ]
    let layout = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: [firstProjectID: 1, secondProjectID: 0],
      draggedEntryIDs: [],
      dropTarget: nil,
      width: 240
    )
    let frames = Dictionary(uniqueKeysWithValues: layout.items.map { ($0.id, $0.frame) })
    let target = try #require(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .tab(firstTabID),
        pointerY: frames[.project(secondProjectID)]!.midY,
        entries: entries,
        frames: frames
      )
    )

    #expect(target.destination == .tab(projectID: secondProjectID, isPinned: true, laneIndex: 1))
  }

  @Test
  func tabDropBelowCollapsedProjectHeaderAlsoAppends() throws {
    let entries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID, isPinned: true),
      project(secondProjectID),
      tab(secondTabID, projectID: secondProjectID, isPinned: true),
      newProjectEntry,
    ]
    let layout = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: [firstProjectID: 1, secondProjectID: 0],
      draggedEntryIDs: [],
      dropTarget: nil,
      width: 240
    )
    let frames = Dictionary(uniqueKeysWithValues: layout.items.map { ($0.id, $0.frame) })
    let target = try #require(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .tab(firstTabID),
        pointerY: frames[.project(secondProjectID)]!.maxY + 1,
        entries: entries,
        frames: frames
      )
    )

    #expect(target.destination == .tab(projectID: secondProjectID, isPinned: true, laneIndex: 1))
  }

  @Test
  func tabDropOverNewProjectIsRejected() {
    let entries = singleProjectEntries
    let layout = plan(entries: entries, width: 240)
    let frames = Dictionary(uniqueKeysWithValues: layout.items.map { ($0.id, $0.frame) })

    #expect(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .tab(firstTabID),
        pointerY: frames[.newProject]!.midY,
        entries: entries,
        frames: frames
      ) == nil
    )
  }

  @Test
  func projectDropInPinBoundaryGapUsesTheAdjacentLane() throws {
    let entries = [
      project(firstProjectID, isPinned: true),
      project(secondProjectID),
      project(thirdProjectID),
      newProjectEntry,
    ]
    let layout = plan(entries: entries, width: 240)
    let frames = Dictionary(uniqueKeysWithValues: layout.items.map { ($0.id, $0.frame) })
    let target = try #require(
      TerminalSidebarDropTargetResolver.resolve(
        drag: .project(thirdProjectID),
        pointerY: frames[.project(secondProjectID)]!.minY - 1,
        entries: entries,
        frames: frames
      )
    )

    #expect(target.destination == .project(isPinned: true, laneIndex: 1))
  }

  @Test
  func pasteboardValuesRejectUnknownKinds() {
    let id = UUID().uuidString

    #expect(TerminalSidebarDragValue(pasteboardValue: "folder:\(id)") == nil)
    #expect(TerminalSidebarDragValue(pasteboardValue: "tab:not-a-uuid") == nil)
  }

  @Test
  func animationCurveReachesExactEndpoints() {
    #expect(TerminalSidebarAnimationCurve.standard(from: 0, to: 1, elapsed: 0, duration: 0.2) == 0)
    #expect(TerminalSidebarAnimationCurve.standard(from: 0, to: 1, elapsed: 0.1, duration: 0.2) > 0.5)
    #expect(TerminalSidebarAnimationCurve.standard(from: 0, to: 1, elapsed: 0.2, duration: 0.2) == 1)
  }

  @Test
  func dragLayoutTransitionInterpolatesFramesAndAlpha() {
    let entries = singleProjectEntries
    let origin = plan(entries: entries, width: 240)
    let target = TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: [firstProjectID: 1],
      draggedEntryIDs: [.tab(firstTabID)],
      dropTarget: TerminalSidebarDropTarget(
        destination: .tab(projectID: firstProjectID, isPinned: false, laneIndex: 0),
        insertionEntryIndex: 1
      ),
      width: 240
    )
    let halfway = target.interpolated(from: origin, progress: 0.5)

    #expect(halfway.items[1].frame.height == origin.items[1].frame.height / 2)
    #expect(halfway.items[1].alpha == 0.5)
    #expect(halfway.contentSize.height == (origin.contentSize.height + target.contentSize.height) / 2)
  }

  @Test
  func acceptedTabDropSettlesOnlyAtItsExpectedDestination() {
    let sourceEntries = [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      project(secondProjectID),
      newProjectEntry,
    ]
    let destination: TerminalSidebarDropTarget.Destination = .tab(
      projectID: secondProjectID,
      isPinned: true,
      laneIndex: 0
    )

    #expect(
      TerminalSidebarDropCommit.isApplied(
        drag: .tab(firstTabID),
        destination: destination,
        entries: sourceEntries
      ) == false
    )

    let appliedEntries = [
      project(firstProjectID),
      project(secondProjectID),
      tab(firstTabID, projectID: secondProjectID, isPinned: true),
      newProjectEntry,
    ]
    #expect(
      TerminalSidebarDropCommit.isApplied(
        drag: .tab(firstTabID),
        destination: destination,
        entries: appliedEntries
      )
    )
  }

  @Test
  func acceptedProjectDropSettlesOnlyAtItsExpectedLane() {
    let destination: TerminalSidebarDropTarget.Destination = .project(
      isPinned: false,
      laneIndex: 1
    )

    #expect(
      TerminalSidebarDropCommit.isApplied(
        drag: .project(firstProjectID),
        destination: destination,
        entries: [project(firstProjectID), project(secondProjectID), newProjectEntry]
      ) == false
    )
    #expect(
      TerminalSidebarDropCommit.isApplied(
        drag: .project(firstProjectID),
        destination: destination,
        entries: [project(secondProjectID), project(firstProjectID), newProjectEntry]
      )
    )
  }

  private var singleProjectEntries: [TerminalSidebarEntry] {
    [
      project(firstProjectID),
      tab(firstTabID, projectID: firstProjectID),
      newProjectEntry,
    ]
  }

  private var newProjectEntry: TerminalSidebarEntry {
    TerminalSidebarEntry(kind: .newProject)
  }

  private func project(_ id: TerminalProjectID, isPinned: Bool = false) -> TerminalSidebarEntry {
    TerminalSidebarEntry(kind: .project(id: id, isPinned: isPinned))
  }

  private func tab(
    _ id: TerminalTabID,
    projectID: TerminalProjectID,
    isPinned: Bool = false
  ) -> TerminalSidebarEntry {
    TerminalSidebarEntry(
      kind: .tab(id: id, projectID: projectID, isPinned: isPinned)
    )
  }

  private func plan(
    entries: [TerminalSidebarEntry],
    width: CGFloat,
    progress: CGFloat = 1
  ) -> TerminalSidebarLayoutPlan {
    TerminalSidebarLayoutPlan(
      entries: entries,
      preferredHeights: heights(for: entries),
      expansionProgress: Dictionary(
        uniqueKeysWithValues: entries.compactMap { entry in
          guard case .project(let projectID, _) = entry.kind else { return nil }
          return (projectID, progress)
        }),
      draggedEntryIDs: [],
      dropTarget: nil,
      width: width
    )
  }

  private func heights(
    for entries: [TerminalSidebarEntry]
  ) -> [TerminalSidebarEntryID: CGFloat] {
    Dictionary(uniqueKeysWithValues: entries.map { ($0.id, 36) })
  }
}
