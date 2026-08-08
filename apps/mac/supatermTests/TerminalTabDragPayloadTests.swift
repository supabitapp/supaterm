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
    #expect(registry.performDetach(payload))
    #expect(detachedFrame == previewFrame)

    registry.finish(operationID: payload.moveOperationID, outcome: .moved)
    #expect(registry.activePayload == nil)
  }

}

@MainActor
private final class TerminalTabDragPreviewRecorder: TerminalTabDragPreviewPresenting {
  private(set) var requestedFrames: [CGRect] = []
  private(set) var imageWasPresent: [Bool] = []
  private(set) var hideCount = 0

  func show(image: NSImage?, frame: CGRect) -> CGRect {
    requestedFrames.append(frame)
    imageWasPresent.append(image?.isValid == true)
    return frame.integral
  }

  func hide() {
    hideCount += 1
  }
}
