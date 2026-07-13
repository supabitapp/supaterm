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
      reduceMotion: true
    )
    list.layoutSubtreeIfNeeded()

    try expectWidths(in: list, listWidth: 180, rowWidth: 163)

    list.frame.size.width = 320
    list.layoutSubtreeIfNeeded()

    try expectWidths(in: list, listWidth: 320, rowWidth: 303)
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

}
