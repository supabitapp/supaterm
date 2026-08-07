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
    let registry = TerminalTabDragRegistry()
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
    #expect(registry.begin(payload))
    #expect(!registry.begin(other))
    #expect(registry.resolve(pasteboard) == payload)

    registry.finish(operationID: payload.moveOperationID, outcome: .moved)

    #expect(registry.activePayload == nil)
    #expect(registry.lastOutcome == .moved)
    #expect(registry.resolve(pasteboard) == nil)
  }
}
