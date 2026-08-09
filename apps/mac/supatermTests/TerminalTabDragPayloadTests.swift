import AppKit
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalTabDragPayloadTests {
  @Test
  func pasteboardRoundTripPreservesStableSourceIdentity() throws {
    let operationID = TerminalTabMoveOperationID()
    let windowID = UUID()
    let spaceID = TerminalSpaceID()
    let groupID = TerminalTabGroupID()
    let tabID = TerminalTabID()
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: operationID,
        sourceWindowID: windowID,
        sourceSpaceID: spaceID,
        sourceTopologyRevision: 42,
        itemIDs: [.group(groupID), .tab(tabID)]
      )
    )
    let pasteboard = NSPasteboard(name: NSPasteboard.Name(UUID().uuidString))
    let item = NSPasteboardItem()

    #expect(TerminalTabDragPasteboard.write(payload, to: item))
    pasteboard.clearContents()
    pasteboard.writeObjects([item])

    let decoded = try #require(TerminalTabDragPasteboard.read(from: pasteboard))
    #expect(decoded == payload)
    #expect(decoded.moveOperationID == operationID)
    #expect(decoded.itemIDs == [.group(groupID), .tab(tabID)])
  }

  @Test
  func payloadRejectsEmptyAndDuplicateSources() {
    let tabID = TerminalTabID()

    #expect(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: []
      ) == nil
    )
    #expect(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(tabID), .tab(tabID)]
      ) == nil
    )
  }

  @Test
  func previewTypeMorphKeepsStableSilhouetteTopologyAndExpandsItsContent() {
    let bounds = CGRect(x: 0, y: 0, width: 210, height: 120)
    let windowFrame = TerminalTabDragPreviewLayout.contentFrame(for: .window, in: bounds)
    let contentPaneFrame = TerminalTabDragPreviewLayout.contentFrame(for: .contentPane, in: bounds)
    let windowPath = TerminalTabDragPreviewLayout.silhouettePath(for: .window, in: bounds)
    let contentPanePath = TerminalTabDragPreviewLayout.silhouettePath(for: .contentPane, in: bounds)

    #expect(windowFrame == CGRect(x: 47, y: 2, width: 161, height: 116))
    #expect(contentPaneFrame == CGRect(x: 2, y: 2, width: 206, height: 116))
    #expect(
      TerminalTabDragPreviewLayout.windowControlsFrame(in: bounds)
        == CGRect(x: 6, y: 111, width: 16, height: 4)
    )
    #expect(silhouetteSubpathCount(windowPath) == 2)
    #expect(silhouetteSubpathCount(contentPanePath) == 2)
    #expect(windowPath.contains(CGPoint(x: 5, y: 18)))
    #expect(!windowPath.contains(CGPoint(x: 45, y: 18)))
    #expect(contentPanePath.contains(CGPoint(x: 45, y: 18)))
  }

  @Test
  func registryResolvesOnlyItsActivePasteboardPayload() throws {
    let previewPresenter = TerminalTabDragPreviewRecorder()
    let registry = TerminalTabDragRegistry(previewPresenter: previewPresenter)
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 7,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    let other = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 7,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    let pasteboard = NSPasteboard(name: NSPasteboard.Name(UUID().uuidString))
    let item = NSPasteboardItem()
    #expect(TerminalTabDragPasteboard.write(payload, to: item))
    pasteboard.clearContents()
    pasteboard.writeObjects([item])

    #expect(registry.resolve(pasteboard) == nil)
    let sourceSurfaceFrame = CGRect(x: 0, y: 0, width: 240, height: 700)
    #expect(registry.begin(payload, sourceSurfaceFrame: sourceSurfaceFrame))
    #expect(!registry.begin(other, sourceSurfaceFrame: sourceSurfaceFrame))
    #expect(registry.resolve(pasteboard) == payload)

    registry.finish(operationID: payload.moveOperationID, outcome: .moved)

    #expect(registry.activePayload == nil)
    #expect(registry.lastOutcome == .moved)
    #expect(registry.resolve(pasteboard) == nil)
    #expect(previewPresenter.hideCount == 1)
  }

  @Test
  func onlyOneTabCanBecomeASplitSource() throws {
    let tabID = TerminalTabID()
    let groupID = TerminalTabGroupID()
    let singleTab = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(tabID)]
      )
    )
    let group = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.group(groupID)]
      )
    )
    let tabs = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(tabID), .tab(TerminalTabID())]
      )
    )

    #expect(singleTab.singleTabID == tabID)
    #expect(group.singleTabID == nil)
    #expect(tabs.singleTabID == nil)

    let registry = TerminalTabDragRegistry(previewPresenter: TerminalTabDragPreviewRecorder())
    #expect(
      registry.begin(
        group,
        sourceSurfaceFrame: CGRect(x: 0, y: 0, width: 240, height: 700)
      )
    )
    _ = registry.move(to: CGPoint(x: 800, y: 500))
    #expect(!registry.transitionSharedPreview(group, to: .contentPane))
  }

  @Test
  func splitDestinationEntryConsumesItsHandoffOnce() throws {
    let registry = TerminalTabDragRegistry(previewPresenter: TerminalTabDragPreviewRecorder())
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    let other = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    var entryCount = 0

    #expect(
      registry.begin(
        payload,
        sourceSurfaceFrame: CGRect(x: 0, y: 0, width: 240, height: 700),
        splitDestinationEntryAction: { entryCount += 1 }
      )
    )
    _ = registry.move(to: CGPoint(x: 120, y: 350))
    _ = registry.move(to: CGPoint(x: 800, y: 500))
    #expect(entryCount == 0)

    registry.consumeSplitDestinationEntryAction(for: other)
    #expect(entryCount == 0)
    registry.consumeSplitDestinationEntryAction(for: payload)
    registry.consumeSplitDestinationEntryAction(for: payload)
    #expect(entryCount == 1)
  }

  @Test
  func registryHandsOffAtTheSourceSurfaceAndDetachesAtTheSharedPreviewFrame() throws {
    let previewPresenter = TerminalTabDragPreviewRecorder()
    let registry = TerminalTabDragRegistry(previewPresenter: previewPresenter)
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    let sourceSurfaceFrame = CGRect(x: 0, y: 0, width: 240, height: 700)
    let previewImage = NSImage(size: CGSize(width: 1_440, height: 900))
    let previewContentSize = CGSize(width: 1_440, height: 820)
    let outsidePoint = CGPoint(x: 800, y: 500)
    var detachedPayload: TerminalTabDragPayload?
    var detachedFrame: CGRect?
    registry.detach = { payload, frame in
      detachedPayload = payload
      detachedFrame = frame
      return true
    }

    #expect(
      registry.begin(
        payload,
        previewImage: previewImage,
        previewContentSize: previewContentSize,
        sourceSurfaceFrame: sourceSurfaceFrame
      )
    )
    #expect(registry.activePayload == payload)
    #expect(!registry.performDetach(payload))
    #expect(registry.move(to: CGPoint(x: 120, y: 350)) == .sourceSurface)
    #expect(!registry.performDetach(payload))
    #expect(previewPresenter.requestedFrames.isEmpty)
    let outsideState = try #require(registry.move(to: outsidePoint))
    guard case .sharedPreview(let previewFrame) = outsideState else {
      #expect(outsideState != .sourceSurface)
      return
    }
    let proposedPreviewFrame = TerminalTabDragPreviewLayout.frame(
      for: previewContentSize,
      at: outsidePoint
    )
    #expect(previewPresenter.requestedFrames == [proposedPreviewFrame])
    #expect(previewPresenter.imageWasPresent == [true])
    #expect(previewPresenter.typesDuringShows == [.window])
    #expect(previewFrame == proposedPreviewFrame.integral)
    #expect(registry.performDetach(payload))
    #expect(detachedPayload == payload)
    #expect(detachedFrame == previewFrame)

    registry.finish(operationID: payload.moveOperationID, outcome: .moved)
    #expect(registry.activePayload == nil)
  }

  @Test
  func registryKeepsTheSharedPreviewAvailableWithoutASnapshot() throws {
    let previewPresenter = TerminalTabDragPreviewRecorder()
    let registry = TerminalTabDragRegistry(previewPresenter: previewPresenter)
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    let sourceSurfaceFrame = CGRect(x: 0, y: 0, width: 240, height: 700)
    let previewContentSize = CGSize(width: 1_440, height: 820)
    let outsidePoint = CGPoint(x: 800, y: 500)
    var detachedFrame: CGRect?
    registry.detach = { _, frame in
      detachedFrame = frame
      return true
    }

    #expect(
      registry.begin(
        payload,
        previewImage: nil,
        previewContentSize: previewContentSize,
        sourceSurfaceFrame: sourceSurfaceFrame
      )
    )
    #expect(registry.activePayload == payload)
    #expect(!registry.performDetach(payload))
    let outsideState = try #require(registry.move(to: outsidePoint))
    guard case .sharedPreview(let previewFrame) = outsideState else {
      #expect(outsideState != .sourceSurface)
      return
    }
    #expect(previewPresenter.imageWasPresent == [false])
    #expect(previewPresenter.typesDuringShows == [.window])
    #expect(registry.performDetach(payload))
    #expect(detachedFrame == previewFrame)

    registry.finish(operationID: payload.moveOperationID, outcome: .moved)
    #expect(registry.activePayload == nil)
  }

  @Test
  func registryDelegatesSharedPreviewTypeAndPointerMovesRespectVisibility() throws {
    let previewPresenter = TerminalTabDragPreviewRecorder()
    let registry = TerminalTabDragRegistry(previewPresenter: previewPresenter)
    let payload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    let otherPayload = try #require(
      TerminalTabDragPayload(
        operationID: TerminalTabMoveOperationID(),
        sourceWindowID: UUID(),
        sourceSpaceID: TerminalSpaceID(),
        sourceTopologyRevision: 0,
        itemIDs: [.tab(TerminalTabID())]
      )
    )
    #expect(
      registry.begin(
        payload,
        previewContentSize: CGSize(width: 1_440, height: 820),
        sourceSurfaceFrame: CGRect(x: 0, y: 0, width: 240, height: 700)
      )
    )
    #expect(!registry.transitionSharedPreview(payload, to: .contentPane))
    _ = registry.move(to: CGPoint(x: 800, y: 500))

    #expect(!registry.transitionSharedPreview(otherPayload, to: .contentPane))
    #expect(registry.transitionSharedPreview(payload, to: .contentPane))
    #expect(!registry.transitionSharedPreview(payload, to: .contentPane))
    #expect(previewPresenter.transitions == [.contentPane])

    let movedState = try #require(registry.move(to: CGPoint(x: 900, y: 600)))
    guard case .sharedPreview = movedState else {
      #expect(movedState != .sourceSurface)
      return
    }
    #expect(previewPresenter.currentType == .contentPane)
    #expect(previewPresenter.typesDuringShows == [.window, .contentPane])

    #expect(registry.move(to: CGPoint(x: 120, y: 350)) == .sourceSurface)
    let reshownState = try #require(registry.move(to: CGPoint(x: 1_000, y: 600)))
    guard case .sharedPreview = reshownState else {
      #expect(reshownState != .sourceSurface)
      return
    }
    #expect(previewPresenter.currentType == .window)
    #expect(previewPresenter.typesDuringShows == [.window, .contentPane, .window])
  }
}

private func silhouetteSubpathCount(_ path: CGPath) -> Int {
  var count = 0
  path.applyWithBlock { element in
    if element.pointee.type == .moveToPoint {
      count += 1
    }
  }
  return count
}

@MainActor
private final class TerminalTabDragPreviewRecorder: TerminalTabDragPreviewPresenting {
  private(set) var requestedFrames: [CGRect] = []
  private(set) var imageWasPresent: [Bool] = []
  private(set) var typesDuringShows: [TerminalTabDragPreviewType] = []
  private(set) var transitions: [TerminalTabDragPreviewType] = []
  private(set) var hideCount = 0
  private(set) var currentType = TerminalTabDragPreviewType.window
  private var isVisible = false

  func show(image: NSImage?, frame: CGRect) -> CGRect {
    if !isVisible {
      currentType = .window
      isVisible = true
    }
    requestedFrames.append(frame)
    imageWasPresent.append(image?.isValid == true)
    typesDuringShows.append(currentType)
    return frame.integral
  }

  func transition(to type: TerminalTabDragPreviewType) -> Bool {
    guard type != currentType else { return false }
    currentType = type
    transitions.append(type)
    return true
  }

  func hide() {
    isVisible = false
    hideCount += 1
  }
}
